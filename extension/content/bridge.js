/**
 * Bridges chrome.storage settings to the MAIN-world overlay script.
 */
(function () {
  "use strict";

  const W = window.WayfarerS2;
  if (!W?.normalizeSettings) {
    console.error("[Wayfarer S2] core library failed to load");
    return;
  }

  function broadcast(settings) {
    window.postMessage(
      { type: W.MESSAGE_SETTINGS, settings: W.normalizeSettings(settings) },
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
    chrome.storage.sync.get({ settings: W.DEFAULT_SETTINGS }, (result) => {
      broadcast(result.settings);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== W.MESSAGE_SETTINGS) {
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
      broadcast(changes.settings.newValue ?? W.DEFAULT_SETTINGS);
    }
  });

  injectStyles();
  loadAndBroadcast();
})();
