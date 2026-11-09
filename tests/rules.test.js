// SPDX-License-Identifier: GPL-3.0-only
const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../src/rules.js");

test("longest matching parent domain wins", () => {
  const configured = [
    { hostname: "example.com", route: "english" },
    { hostname: "forum.example.com", route: "tsf" }
  ];
  assert.equal(rules.routeForHostname("www.example.com", configured), "english");
  assert.equal(rules.routeForHostname("x.forum.example.com", configured), "tsf");
});

test("unrelated suffix does not match", () => {
  assert.equal(rules.routeForHostname("notexample.com", [
    { hostname: "example.com", route: "english" }
  ]), "default");
});

test("global pause resolves every hostname to default without deleting rules", () => {
  const configured = [{ hostname: "voz.vn", route: "english" }];
  assert.equal(rules.routeForContext(true, "voz.vn", configured), "english");
  assert.equal(rules.routeForContext(false, "voz.vn", configured), "default");
  assert.deepEqual(configured, [{ hostname: "voz.vn", route: "english" }]);
});

test("only http and https URLs expose a hostname", () => {
  assert.equal(rules.hostnameFromUrl("https://Sub.Example.com/path?q=secret"), "sub.example.com");
  assert.equal(rules.hostnameFromUrl("chrome://settings"), "");
});

test("session modes are normalized and scoped to an exact hostname", () => {
  const modes = rules.normalizeDomainModes({
    "WWW.Example.com.": true,
    "forum.example.com": "english",
    "bad host": "vietnamese",
    "ignored.example.com": "default"
  });
  assert.deepEqual(modes, {
    "www.example.com": "vietnamese",
    "forum.example.com": "english"
  });
  assert.equal(rules.modeForHostname("www.example.com", modes), "vietnamese");
  assert.equal(rules.modeForHostname("child.www.example.com", modes), "default");
  assert.equal(rules.modeForHostname("toString", {}), "default");
});

test("hard English wins over a remembered session mode", () => {
  assert.deepEqual(rules.contextForHostname(true, "chat.example.com", [
    { hostname: "example.com", route: "english" }
  ], {
    "chat.example.com": "vietnamese"
  }), { route: "english", mode: "default" });
});

test("TSF hard routing can retain the learned V/E mode", () => {
  assert.deepEqual(rules.contextForHostname(true, "editor.example.com", [
    { hostname: "editor.example.com", route: "tsf" }
  ], {
    "editor.example.com": "english"
  }), { route: "tsf", mode: "english" });
  assert.deepEqual(rules.contextForHostname(false, "editor.example.com", [], {
    "editor.example.com": "english"
  }), { route: "default", mode: "default" });
});

test("native hotkey events expose only a valid V/E result", () => {
  assert.equal(rules.modeFromNativeMessage({
    protocol: 2,
    event: "mode-changed",
    mode: "vietnamese"
  }), "vietnamese");
  assert.equal(rules.modeFromNativeMessage({
    protocol: 2,
    type: "hotkey",
    vietnamese: false
  }), "english");
  assert.equal(rules.modeFromNativeMessage({ ok: true }), null);
  assert.equal(rules.modeFromNativeMessage({
    protocol: 1,
    event: "mode-changed",
    mode: "english"
  }), null);
});
