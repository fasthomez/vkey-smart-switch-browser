// SPDX-License-Identifier: GPL-3.0-only
// Chromium MV3 runs this as a service worker; Firefox MV3 runs it as an event
// page and loads rules.js first through background.scripts.
if (typeof importScripts === "function" && typeof VKeyRules === "undefined") {
  importScripts("rules.js");
}

const api = globalThis.browser || globalThis.chrome;
const HOST_NAME = "io.github.phatmt97.vkey";
const SESSION_MODES_KEY = "domainModes";
const TAB_MODES_KEY = "tabModes";
let port = null;
let reconnectTimer = null;
let nativeMessageQueue = Promise.resolve();
let rules = [];
let domainModes = {};
let tabModes = {};
let lastPublishedTab = null;
let enabled = true;
let nativeState = { status: "connecting", error: "" };

function browserExe() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) return "msedge.exe";
  if (navigator.brave || ua.includes("brave/")) return "brave.exe";
  if (ua.includes("vivaldi/")) return "vivaldi.exe";
  if (ua.includes("opr/")) return "opera.exe";
  if (ua.includes("firefox/")) return "firefox.exe";
  return "chrome.exe";
}

function connect() {
  if (port) return;
  nativeState = { status: "connecting", error: "" };
  try {
    const nativePort = api.runtime.connectNative(HOST_NAME);
    port = nativePort;
    nativePort.onMessage.addListener((message) => {
      if (message && message.ok === false) {
        nativeState = { status: "error", error: message.error || "Native host rejected context" };
        return;
      }
      nativeState = { status: "connected", error: "" };
      nativeMessageQueue = nativeMessageQueue
        .then(() => rememberNativeMode(message))
        .catch(() => {});
    });
    nativePort.onDisconnect.addListener(() => {
      if (port !== nativePort) return;
      const error = api.runtime.lastError;
      nativeState = {
        status: "error",
        error: error && error.message ? error.message : "Native host disconnected"
      };
      port = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    });
    publishActiveContext();
  } catch (error) {
    nativeState = {
      status: "error",
      error: error && error.message ? error.message : String(error)
    };
    port = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 5000);
  }
}

function send(message) {
  connect();
  if (!port) return;
  try {
    port.postMessage(message);
  } catch (_) {
    port = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  }
}

async function getActiveContext() {
  const windows = await api.windows.getLastFocused({ populate: true });
  const tab = windows && windows.tabs && windows.tabs.find((item) => item.active);
  const hostname = tab ? VKeyRules.hostnameFromUrl(tab.url) : "";
  return { hostname, tabId: tab && tab.id, focused: Boolean(windows && windows.focused && hostname) };
}

function nativeContext(hostname, focused, tabId) {
  const contextActive = enabled && focused;
  const resolved = contextActive
    ? VKeyRules.contextForTab(enabled, hostname, tabId, rules, domainModes, tabModes)
    : { route: "default", mode: "default" };
  return {
    protocol: VKeyRules.NATIVE_PROTOCOL,
    browser: browserExe(),
    hostname,
    route: resolved.route,
    mode: resolved.mode,
    focused: contextActive
  };
}

async function publishActiveContext() {
  try {
    const context = await getActiveContext();
    // Capture the tab identity associated with the most recently reported
    // foreground hostname. Never attribute a delayed hotkey to a new tab.
    lastPublishedTab = context.focused && Number.isSafeInteger(context.tabId)
      ? { id: context.tabId, hostname: context.hostname } : null;
    send(nativeContext(context.hostname, context.focused, context.tabId));
  } catch (_) {
    lastPublishedTab = null;
    send(nativeContext("", false));
  }
}

async function rememberNativeMode(message) {
  const mode = VKeyRules.modeFromNativeMessage(message);
  if (!mode || !enabled) return;

  const eventHostname = VKeyRules.normalizeHostname(message.hostname);
  if (!eventHostname || !/^[a-z0-9.-]+$/.test(eventHostname)) return;

  // Configured English is a hard rule, equivalent to a hard app exclusion:
  // hotkeys must not overwrite the remembered soft state for this hostname.
  // The host includes the hostname captured with the hotkey so a quick tab
  // switch after the key press cannot attribute the event to the next tab.
  if (VKeyRules.routeForHostname(eventHostname, rules) === "english") return;
  // Native protocol 2 carries hostname but no tab ID. Only remember a
  // tab-specific result when the most recently published active tab matches
  // the captured hostname. Otherwise retain the hostname-level fallback.
  if (lastPublishedTab && lastPublishedTab.hostname === eventHostname) {
    tabModes = { ...tabModes, [String(lastPublishedTab.id)]: mode };
    await api.storage.session.set({ [TAB_MODES_KEY]: tabModes });
    await publishActiveContext();
    return;
  }
  if (VKeyRules.modeForHostname(eventHostname, domainModes) === mode) return;

  domainModes = {
    ...VKeyRules.normalizeDomainModes(domainModes),
    [eventHostname]: mode
  };
  await api.storage.session.set({ [SESSION_MODES_KEY]: domainModes });
  await publishActiveContext();
}

async function loadState() {
  const [stored, session] = await Promise.all([
    api.storage.local.get({ enabled: true, rules: [] }),
    api.storage.session.get({ [SESSION_MODES_KEY]: {}, [TAB_MODES_KEY]: {} })
  ]);
  enabled = stored.enabled !== false;
  rules = VKeyRules.normalizeRules(stored.rules);
  domainModes = VKeyRules.normalizeDomainModes(session[SESSION_MODES_KEY]);
  tabModes = session[TAB_MODES_KEY] && typeof session[TAB_MODES_KEY] === "object"
    ? session[TAB_MODES_KEY] : {};
}

api.runtime.onInstalled.addListener(async () => { await loadState(); connect(); });
api.runtime.onStartup.addListener(async () => { await loadState(); connect(); });
api.tabs.onActivated.addListener(publishActiveContext);
api.tabs.onRemoved.addListener(async (tabId) => {
  if (Object.prototype.hasOwnProperty.call(tabModes, String(tabId))) {
    const { [String(tabId)]: _removed, ...remaining } = tabModes;
    tabModes = remaining;
    await api.storage.session.set({ [TAB_MODES_KEY]: tabModes });
  }
});
api.tabs.onUpdated.addListener((_tabId, change) => {
  if (change.url || change.status === "complete") publishActiveContext();
});
api.windows.onFocusChanged.addListener(publishActiveContext);
api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "get-native-status") {
    sendResponse(nativeState);
  }
});
api.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes.enabled || changes.rules)) {
    const stored = await api.storage.local.get({ enabled: true, rules: [] });
    enabled = stored.enabled !== false;
    rules = VKeyRules.normalizeRules(stored.rules);
    await publishActiveContext();
  }
  if (area === "session" && changes[TAB_MODES_KEY]) {
    tabModes = changes[TAB_MODES_KEY].newValue || {};
    await publishActiveContext();
  }
  if (area === "session" && changes[SESSION_MODES_KEY]) {
    domainModes = VKeyRules.normalizeDomainModes(changes[SESSION_MODES_KEY].newValue);
    await publishActiveContext();
  }
});

loadState().then(connect);
setInterval(publishActiveContext, 2000);
