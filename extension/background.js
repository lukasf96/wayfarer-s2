chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ settings: null }, (result) => {
    if (result.settings) {
      return;
    }
    chrome.storage.sync.set({
      settings: {
        enabled: true,
        highlightOccupiedL17: true,
        grids: [
          {
            level: 14,
            enabled: true,
            color: "#2196F3",
            opacity: 0.85,
            weight: 2,
          },
          {
            level: 17,
            enabled: true,
            color: "#FF9800",
            opacity: 0.95,
            weight: 2,
          },
        ],
      },
    });
  });
});
