// SPDX-License-Identifier: GPL-3.0-only
(function (root) {
  "use strict";

  const ROUTES = Object.freeze(["default", "english", "tsf"]);
  const MODES = Object.freeze(["default", "vietnamese", "english"]);
  const NATIVE_PROTOCOL = 2;

  function normalizeHostname(value) {
    return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }

  function normalizeRules(value) {
    if (!Array.isArray(value)) return [];
    const unique = new Map();
    for (const item of value) {
      const hostname = normalizeHostname(item && item.hostname);
      const route = item && ROUTES.includes(item.route) ? item.route : "default";
      if (hostname && /^[a-z0-9.-]+$/.test(hostname) && route !== "default") {
        unique.set(hostname, { hostname, route });
      }
    }
    return [...unique.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  function normalizeDomainModes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const normalized = {};
    for (const [rawHostname, rawMode] of Object.entries(value)) {
      const hostname = normalizeHostname(rawHostname);
      const mode = typeof rawMode === "boolean"
        ? (rawMode ? "vietnamese" : "english")
        : String(rawMode || "").toLowerCase();
      if (hostname && /^[a-z0-9.-]+$/.test(hostname)
          && MODES.includes(mode) && mode !== "default") {
        normalized[hostname] = mode;
      }
    }
    return normalized;
  }

  function routeForHostname(hostname, rules) {
    const host = normalizeHostname(hostname);
    let best = null;
    for (const rule of normalizeRules(rules)) {
      if (host === rule.hostname || host.endsWith(`.${rule.hostname}`)) {
        if (!best || rule.hostname.length > best.hostname.length) best = rule;
      }
    }
    return best ? best.route : "default";
  }

  function routeForContext(enabled, hostname, rules) {
    return enabled ? routeForHostname(hostname, rules) : "default";
  }

  function modeForHostname(hostname, domainModes) {
    const host = normalizeHostname(hostname);
    const normalized = normalizeDomainModes(domainModes);
    return Object.prototype.hasOwnProperty.call(normalized, host)
      ? normalized[host]
      : "default";
  }

  function contextForHostname(enabled, hostname, rules, domainModes) {
    if (!enabled) return { route: "default", mode: "default" };
    const route = routeForHostname(hostname, rules);
    // A configured English rule is a hard lock. Do not let a remembered
    // session mode compete with it; the native side also blocks the hotkey.
    const mode = route === "english"
      ? "default"
      : modeForHostname(hostname, domainModes);
    return { route, mode };
  }

  function modeFromNativeMessage(message) {
    if (!message || typeof message !== "object") return null;
    if (message.protocol !== undefined && message.protocol !== NATIVE_PROTOCOL) return null;
    const event = message.event || message.type;
    if (event !== "mode-changed" && event !== "hotkey") return null;
    if (typeof message.vietnamese === "boolean") {
      return message.vietnamese ? "vietnamese" : "english";
    }
    const mode = String(message.mode || "").toLowerCase();
    return mode === "vietnamese" || mode === "english" ? mode : null;
  }

  function hostnameFromUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:"
        ? normalizeHostname(url.hostname)
        : "";
    } catch (_) {
      return "";
    }
  }

  const api = {
    ROUTES,
    MODES,
    NATIVE_PROTOCOL,
    normalizeHostname,
    normalizeRules,
    normalizeDomainModes,
    routeForHostname,
    routeForContext,
    modeForHostname,
    contextForHostname,
    modeFromNativeMessage,
    hostnameFromUrl
  };
  root.VKeyRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
