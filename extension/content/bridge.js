/**
 * Bridges chrome.storage settings to the MAIN-world overlay script.
 */
(function () {
  "use strict";

  const MESSAGE_TYPE = "WAYFARER_S2_SETTINGS";
  const DEFAULT_SETTINGS = {
    enabled: true,
    highlightOccupiedL17: true,
    grids: [
      { level: 14, enabled: true, color: "#2196F3", opacity: 0.85, weight: 2 },
      { level: 17, enabled: true, color: "#FF9800", opacity: 0.95, weight: 2 },
    ],
  };

  function normalizeSettings(settings) {
    if (!settings || typeof settings !== "object") {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }

    const normalized = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (typeof settings.enabled === "boolean") {
      normalized.enabled = settings.enabled;
    }
    if (typeof settings.highlightOccupiedL17 === "boolean") {
      normalized.highlightOccupiedL17 = settings.highlightOccupiedL17;
    }
    if (Array.isArray(settings.grids)) {
      normalized.grids = normalized.grids.map((defaultGrid) => {
        const override = settings.grids.find((g) => g && g.level === defaultGrid.level);
        return override ? { ...defaultGrid, ...override } : defaultGrid;
      });
    }
    return normalized;
  }

  function broadcast(settings) {
    window.postMessage(
      { type: MESSAGE_TYPE, settings: normalizeSettings(settings) },
      "*"
    );
  }

  function injectStyles() {
    if (document.getElementById("wayfarer-s2-styles")) {
      return;
    }
    const link = document.createElement("link");
    link.id = "wayfarer-s2-styles";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content/overlay.css");
    document.documentElement.appendChild(link);
  }

  function loadAndBroadcast() {
    chrome.storage.sync.get({ settings: DEFAULT_SETTINGS }, (result) => {
      broadcast(result.settings);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== MESSAGE_TYPE) {
      return;
    }

    if (event.data.request) {
      loadAndBroadcast();
      return;
    }

    if (event.data.fromPage && event.data.settings) {
      chrome.storage.sync.set({ settings: event.data.settings });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      broadcast(changes.settings.newValue ?? DEFAULT_SETTINGS);
    }
  });

  injectStyles();
  loadAndBroadcast();
})();
