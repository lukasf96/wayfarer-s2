importScripts("lib/core.js");

chrome.runtime.onInstalled.addListener(() => {
  const defaults = WayfarerS2.DEFAULT_SETTINGS;
  chrome.storage.sync.get({ settings: null }, (result) => {
    if (result.settings) {
      return;
    }
    chrome.storage.sync.set({ settings: defaults });
  });
});
