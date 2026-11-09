// SPDX-License-Identifier: GPL-3.0-only
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const rules = require("../src/rules.js");

const backgroundSource = fs.readFileSync(
  path.resolve(__dirname, "../src/background.js"),
  "utf8"
);

function eventTarget() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    emit(...args) { return listeners.map((listener) => listener(...args)); }
  };
}

async function flushTasks() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function startBackground(local = { enabled: true, rules: [] }) {
  const localData = { ...local };
  const sessionData = {};
  const storageChanged = eventTarget();
  const nativeMessages = eventTarget();
  const nativeDisconnect = eventTarget();
  const posted = [];
  const port = {
    onMessage: nativeMessages,
    onDisconnect: nativeDisconnect,
    postMessage(message) { posted.push(message); }
  };
  const makeStorage = (data, area) => ({
    async get(defaults) { return { ...defaults, ...data }; },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      storageChanged.emit(changes, area);
    }
  });
  const api = {
    runtime: {
      connectNative() { return port; },
      onInstalled: eventTarget(),
      onStartup: eventTarget(),
      onMessage: eventTarget(),
      lastError: null
    },
    storage: {
      local: makeStorage(localData, "local"),
      session: makeStorage(sessionData, "session"),
      onChanged: storageChanged
    },
    windows: {
      async getLastFocused() {
        return {
          focused: true,
          tabs: [{ active: true, url: "https://example.com/editor" }]
        };
      },
      onFocusChanged: eventTarget()
    },
    tabs: {
      onActivated: eventTarget(),
      onUpdated: eventTarget()
    }
  };
  vm.runInNewContext(backgroundSource, {
    browser: api,
    VKeyRules: rules,
    navigator: { userAgent: "Mozilla/5.0 Chrome/140.0" },
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval() {},
    console
  }, { filename: "background.js" });
  await flushTasks();
  return { nativeMessages, posted, sessionData };
}

test("native hotkey result is remembered in session storage and republished", async () => {
  const background = await startBackground();
  assert.equal(background.posted.at(-1).protocol, 2);
  assert.equal(background.posted.at(-1).mode, "default");

  background.nativeMessages.emit({
    protocol: 2,
    event: "mode-changed",
    hostname: "example.com",
    mode: "english"
  });
  await flushTasks();

  assert.deepEqual({ ...background.sessionData.domainModes }, { "example.com": "english" });
  assert.equal(background.posted.at(-1).mode, "english");
});

test("disabled routing clears the native browser context", async () => {
  const background = await startBackground({
    enabled: false,
    rules: [{ hostname: "example.com", route: "english" }]
  });

  assert.equal(background.posted.at(-1).focused, false);
  assert.equal(background.posted.at(-1).route, "default");
  assert.equal(background.posted.at(-1).mode, "default");
});

test("hard English rule ignores native hotkey results", async () => {
  const background = await startBackground({
    enabled: true,
    rules: [{ hostname: "example.com", route: "english" }]
  });
  background.nativeMessages.emit({
    protocol: 2,
    event: "mode-changed",
    hostname: "example.com",
    mode: "vietnamese"
  });
  await flushTasks();

  assert.equal(background.sessionData.domainModes, undefined);
  assert.equal(background.posted.at(-1).route, "english");
  assert.equal(background.posted.at(-1).mode, "default");
});

test("hotkey event keeps the hostname captured by the native host", async () => {
  const background = await startBackground();
  background.nativeMessages.emit({
    protocol: 2,
    event: "mode-changed",
    hostname: "other.example.com",
    mode: "vietnamese"
  });
  await flushTasks();

  assert.deepEqual(
    { ...background.sessionData.domainModes },
    { "other.example.com": "vietnamese" }
  );
  // The active tab is still example.com, so republishing does not leak the
  // remembered mode from other.example.com into its context.
  assert.equal(background.posted.at(-1).hostname, "example.com");
  assert.equal(background.posted.at(-1).mode, "default");
});
