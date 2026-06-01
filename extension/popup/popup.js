const DEFAULT_SETTINGS = {
  enabled: true,
  highlightOccupiedL17: true,
  grids: [
    { level: 14, enabled: true, color: "#2196F3", opacity: 0.85, weight: 2 },
    { level: 17, enabled: true, color: "#FF9800", opacity: 0.95, weight: 2 },
  ],
};

function getGrid(settings, level) {
  return settings.grids.find((g) => g.level === level);
}

function setGridEnabled(settings, level, enabled) {
  const grid = getGrid(settings, level);
  if (grid) {
    grid.enabled = enabled;
  }
}

function loadUi(settings) {
  document.getElementById("enabled").checked = settings.enabled;
  document.getElementById("highlightOccupiedL17").checked =
    settings.highlightOccupiedL17 ?? true;
    document.getElementById("level14").checked =
    getGrid(settings, 14)?.enabled ?? true;
  document.getElementById("level17").checked =
    getGrid(settings, 17)?.enabled ?? true;
}

function save(settings) {
  chrome.storage.sync.set({ settings });
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get({ settings: DEFAULT_SETTINGS }, (result) => {
    const settings = JSON.parse(JSON.stringify(result.settings));
    loadUi(settings);

    document.getElementById("enabled").addEventListener("change", (e) => {
      settings.enabled = e.target.checked;
      save(settings);
    });

    document.getElementById("highlightOccupiedL17").addEventListener("change", (e) => {
      settings.highlightOccupiedL17 = e.target.checked;
      save(settings);
    });

    document.getElementById("level14").addEventListener("change", (e) => {
      setGridEnabled(settings, 14, e.target.checked);
      save(settings);
    });

    document.getElementById("level17").addEventListener("change", (e) => {
      setGridEnabled(settings, 17, e.target.checked);
      save(settings);
    });
  });
});
