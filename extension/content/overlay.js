/**
 * Draws S2 cell grids on the Wayfarer Google Map (MAIN world).
 * Does NOT patch google.maps.Map — that breaks Wayfarer initialization.
 */
(function () {
  "use strict";

  const W = window.WayfarerS2;
  const POI_CELL_LEVEL = 17;
  const POGO_ENTITIES = new Set(["POKESTOP", "GYM"]);

  if (!W?.S2Cell || !W.normalizeSettings) {
    console.error("[Wayfarer S2] extension libraries failed to load");
    return;
  }

  const { S2Cell } = W;

  let settings = W.cloneSettings(W.DEFAULT_SETTINGS);
  let map = null;
  let mapListeners = [];
  let polygons = [];
  let panelEl = null;
  let redrawTimer = null;
  let findMapTimer = null;
  let occupiedL17Cells = new Set();
  let poiCache = new Map();

  function whenDomReady(callback) {
    const run = () => {
      const root = document.body;
      if (root instanceof Node) {
        callback(root);
        return;
      }
      requestAnimationFrame(run);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  }

  let lastRouteKey = null;

  function getRouteKey() {
    return location.pathname + location.search + location.hash;
  }

  function checkRouteChange() {
    const key = getRouteKey();
    if (key === lastRouteKey) {
      return;
    }
    lastRouteKey = key;
    onNavigation();
  }

  function installRouteWatch() {
    if (window.__wfs2RouteWatch) {
      return;
    }
    window.__wfs2RouteWatch = true;
    lastRouteKey = getRouteKey();

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      checkRouteChange();
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      checkRouteChange();
      return result;
    };

    window.addEventListener("popstate", checkRouteChange);
    window.addEventListener("hashchange", checkRouteChange);
  }

  function readMapFromHost(host) {
    if (!host) {
      return null;
    }

    const directKeys = [
      "map",
      "innerMap",
      "cO",
      "googleMap",
      "mapInstance",
      "niaMap",
      "_map",
    ];
    for (const key of directKeys) {
      try {
        const found = W.unwrapMap(host[key]);
        if (found) {
          return found;
        }
      } catch {
        // ignore
      }
    }

    for (const key of Object.keys(host)) {
      if (!key.startsWith("__") && !key.startsWith("ng")) {
        continue;
      }
      try {
        const found = W.unwrapMap(host[key]);
        if (found) {
          return found;
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  function walkParentChainForMap(startEl) {
    let el = startEl;
    for (let depth = 0; el && depth < 25; depth += 1) {
      const found = readMapFromHost(el);
      if (found) {
        return found;
      }
      el = el.parentElement;
    }
    return null;
  }

  function tryAngularMap() {
    for (const el of document.querySelectorAll(W.MAP_HOST_SELECTORS)) {
      try {
        const cmp = W.getAngularComponent(el);
        if (!cmp || typeof cmp !== "object") {
          continue;
        }

        for (const key of Object.keys(cmp)) {
          const found = W.unwrapMap(cmp[key]);
          if (found) {
            return found;
          }
        }
      } catch {
        // not a component host
      }
    }

    return null;
  }

  function latLngFromGoogle(latLng) {
    return { lat: latLng.lat(), lng: latLng.lng() };
  }

  function boundsFromGoogle(bounds) {
    return {
      north: bounds.getNorthEast().lat(),
      south: bounds.getSouthWest().lat(),
      east: bounds.getNorthEast().lng(),
      west: bounds.getSouthWest().lng(),
    };
  }

  function isCellInBounds(cell, bounds) {
    const corners = cell.getCornerLatLngs();
    const latMin = Math.min(...corners.map((c) => c.lat));
    const latMax = Math.max(...corners.map((c) => c.lat));
    const lngMin = Math.min(...corners.map((c) => c.lng));
    const lngMax = Math.max(...corners.map((c) => c.lng));
    return !(
      latMax < bounds.south ||
      latMin > bounds.north ||
      lngMax < bounds.west ||
      lngMin > bounds.east
    );
  }

  function shouldDrawLevel(level, zoom) {
    if (level < 6) {
      return false;
    }
    return level <= zoom + 2;
  }

  function cellKeyAt(lat, lng, level) {
    return S2Cell.fromLatLng({ lat, lng }, level).toString();
  }

  function getGmo(poi) {
    const gmo = poi?.gmo ?? poi?.properties?.gmo;
    return Array.isArray(gmo) ? gmo : [];
  }

  function isInGamePoi(poi) {
    if (!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) {
      return false;
    }
    const gmo = getGmo(poi);
    if (gmo.length === 0) {
      return false;
    }
    return gmo.some((entry) => {
      if (!entry || String(entry.status).toUpperCase() !== "ACTIVE") {
        return false;
      }
      if (!entry.entity) {
        return true;
      }
      return POGO_ENTITIES.has(entry.entity);
    });
  }

  function cachePoi(poi) {
    const key = `${poi.lat.toFixed(6)},${poi.lng.toFixed(6)}`;
    poiCache.set(key, poi);
  }

  function mergePois(pois) {
    for (const poi of pois) {
      if (Number.isFinite(poi.lat) && Number.isFinite(poi.lng)) {
        cachePoi(poi);
      }
    }
  }

  function pushMarkersFromList(markers, list) {
    if (!Array.isArray(list)) {
      return;
    }
    for (const marker of list) {
      const normalized = W.normalizePoiMarker(marker);
      if (normalized) {
        markers.push(normalized);
      }
    }
  }

  function harvestRawMarkers() {
    const markers = [];

    for (const el of document.querySelectorAll(W.MAP_HOST_SELECTORS)) {
      try {
        const cmp = W.getAngularComponent(el);
        if (!cmp) {
          continue;
        }

        pushMarkersFromList(markers, cmp.markers);

        if (cmp._mapService?._rawMarkers) {
          pushMarkersFromList(markers, cmp._mapService._rawMarkers);
        }

        const raw = W.findRawMarkersArray(cmp);
        pushMarkersFromList(markers, raw);
      } catch {
        // ignore
      }
    }

    return markers;
  }

  function rebuildOccupiedL17Cells() {
    occupiedL17Cells = new Set();

    const sources = [...poiCache.values()];
    for (const marker of harvestRawMarkers()) {
      sources.push(marker);
    }

    for (const poi of sources) {
      if (!isInGamePoi(poi)) {
        continue;
      }
      occupiedL17Cells.add(cellKeyAt(poi.lat, poi.lng, POI_CELL_LEVEL));
    }
  }

  function clearOverlays() {
    polygons.forEach((p) => p.setMap(null));
    polygons = [];
  }

  function drawCellOutline(cell, grid) {
    const corners = cell.getCornerLatLngs();
    const path = corners.map((c) => ({ lat: c.lat, lng: c.lng }));
    const cellId = cell.toString();
    const isOccupiedL17 =
      grid.level === POI_CELL_LEVEL &&
      settings.highlightOccupiedL17 &&
      occupiedL17Cells.has(cellId);

    const polygon = new google.maps.Polygon({
      paths: path,
      strokeColor: isOccupiedL17 ? "#C62828" : grid.color,
      strokeOpacity: isOccupiedL17 ? 0.95 : grid.opacity,
      strokeWeight: isOccupiedL17 ? grid.weight + 1 : grid.weight,
      fillColor: isOccupiedL17 ? "#E53935" : undefined,
      fillOpacity: isOccupiedL17 ? 0.32 : 0,
      geodesic: true,
      clickable: false,
      map,
      zIndex: isOccupiedL17 ? 150 : 100 + grid.level,
    });
    polygons.push(polygon);
  }

  function drawGridLevel(grid, bounds, zoom) {
    if (!grid.enabled || !shouldDrawLevel(grid.level, zoom)) {
      return { cells: 0, occupied: 0 };
    }

    const center = latLngFromGoogle(map.getCenter());
    const startCell = S2Cell.fromLatLng(center, grid.level);
    const seen = {};
    let count = 0;
    let occupied = 0;

    function visit(cell) {
      const key = cell.toString();
      if (seen[key]) {
        return;
      }
      seen[key] = true;

      if (!isCellInBounds(cell, bounds)) {
        return;
      }

      if (
        grid.level === POI_CELL_LEVEL &&
        settings.highlightOccupiedL17 &&
        occupiedL17Cells.has(key)
      ) {
        occupied += 1;
      }

      drawCellOutline(cell, grid);
      count += 1;

      const neighbors = cell.getNeighbors();
      for (let i = 0; i < neighbors.length; i++) {
        visit(neighbors[i]);
      }
    }

    visit(startCell);
    return { cells: count, occupied };
  }

  function redrawGrid() {
    if (!map || !settings.enabled || !W.isMapViewPage()) {
      clearOverlays();
      return;
    }

    if (!window.google?.maps?.Polygon) {
      return;
    }

    clearOverlays();

    rebuildOccupiedL17Cells();

    const bounds = boundsFromGoogle(map.getBounds());
    const zoom = map.getZoom();

    const sortedGrids = [...settings.grids].sort((a, b) => a.level - b.level);
    for (const grid of sortedGrids) {
      drawGridLevel(grid, bounds, zoom);
    }

    updateDebugState();
  }

  function scheduleRedraw() {
    if (redrawTimer) {
      clearTimeout(redrawTimer);
    }
    redrawTimer = setTimeout(redrawGrid, 80);
  }

  function detachMap() {
    if (map && mapListeners.length) {
      mapListeners.forEach((listener) => {
        google.maps.event.removeListener(listener);
      });
    }
    mapListeners = [];
    map = null;
    clearOverlays();
  }

  function consumePendingMap() {
    const pending = window[W.PENDING_MAP_KEY];
    if (pending) {
      attachMap(pending);
    }
  }

  function attachMap(instance) {
    const resolved = W.unwrapMap(instance);
    if (!resolved || map === resolved) {
      return Boolean(resolved);
    }

    detachMap();
    map = resolved;

    mapListeners.push(google.maps.event.addListener(map, "idle", () => {
      scheduleRedraw();
      if (W.isMapViewPage()) {
        positionPanel();
      } else {
        hidePanel();
      }
    }));
    mapListeners.push(
      google.maps.event.addListener(map, "zoom_changed", scheduleRedraw)
    );

    scheduleRedraw();
    updatePanel();
    return true;
  }

  function tryFindExistingMap() {
    if (!window.google?.maps) {
      return false;
    }

    consumePendingMap();
    if (map) {
      return true;
    }

    const fromAngular = tryAngularMap();
    if (fromAngular && attachMap(fromAngular)) {
      return true;
    }

    const gmStyle = document.querySelector(".mapview-container .gm-style");
    if (gmStyle) {
      const fromChain = walkParentChainForMap(gmStyle);
      if (fromChain && attachMap(fromChain)) {
        return true;
      }
    }

    const hosts = [];
    const mapView = document.querySelector(".mapview-container");
    if (mapView) {
      hosts.push(mapView);
    }

    document
      .querySelectorAll("gmp-map, nia-map, .agm-map-container-inner, [role='region'][aria-label*='arte' i], [role='region'][aria-label*='map' i]")
      .forEach((el) => {
        hosts.push(el);
      });

    for (const host of hosts) {
      const found = readMapFromHost(host) || walkParentChainForMap(host);
      if (found && attachMap(found)) {
        return true;
      }
    }

    return false;
  }

  function waitForGoogleMapsApi() {
    if (window.google?.maps) {
      consumePendingMap();
      tryFindExistingMap();
      return;
    }

    const timer = setInterval(() => {
      if (!window.google?.maps) {
        return;
      }
      clearInterval(timer);
      consumePendingMap();
      tryFindExistingMap();
    }, 200);
  }

  function startMapDiscovery() {
    if (findMapTimer) {
      return;
    }

    let attempts = 0;
    const maxAttempts = 120;

    findMapTimer = setInterval(() => {
      attempts += 1;

      if (!W.isMapViewPage()) {
        if (map) {
          detachMap();
        }
        if (attempts > 5) {
          clearInterval(findMapTimer);
          findMapTimer = null;
        }
        return;
      }

      if (map) {
        clearInterval(findMapTimer);
        findMapTimer = null;
        return;
      }

      consumePendingMap();
      tryFindExistingMap();

      if (!map && attempts >= maxAttempts) {
        clearInterval(findMapTimer);
        findMapTimer = null;
      }
    }, 1000);
  }

  function getMapContainer() {
    return (
      document.querySelector(".mapview-container") ||
      document.querySelector("app-wf-base-map") ||
      document.querySelector("app-mapview")
    );
  }

  function getMapLegend() {
    return (
      document.querySelector("app-map-legend .map-legend-container") ||
      document.querySelector(".map-legend-container")
    );
  }

  function hidePanel() {
    if (!panelEl) {
      return;
    }
    panelEl.remove();
    panelEl = null;
  }

  function positionPanel() {
    if (!W.isMapViewPage() || !panelEl) {
      return;
    }

    const gap = 8;
    const offset = 10;
    const legend = getMapLegend();
    const container = getMapContainer();

    panelEl.style.top = "auto";
    panelEl.style.right = "auto";

    if (legend) {
      const legendRect = legend.getBoundingClientRect();
      panelEl.style.left = `${Math.max(0, legendRect.left)}px`;
      panelEl.style.bottom = `${Math.max(0, window.innerHeight - legendRect.top + gap)}px`;
      return;
    }

    if (container) {
      const rect = container.getBoundingClientRect();
      panelEl.style.left = `${Math.max(0, rect.left + offset)}px`;
      panelEl.style.bottom = `${Math.max(0, window.innerHeight - rect.bottom + offset + 96)}px`;
      return;
    }

    panelEl.style.left = `${offset}px`;
    panelEl.style.bottom = `${96 + offset}px`;
  }

  function injectInlineStyles() {
    if (document.getElementById("wayfarer-s2-inline-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "wayfarer-s2-inline-styles";
    style.textContent = `
      #wayfarer-s2-panel {
        position: fixed; bottom: 96px; left: 10px; z-index: 2147483646;
        min-width: 168px; max-width: 210px; padding: 8px 10px; border-radius: 6px;
        background: rgba(255,255,255,0.97); box-shadow: 0 1px 8px rgba(0,0,0,0.22);
        font: 12px/1.3 Roboto, "Helvetica Neue", Arial, sans-serif; color: #212121;
        pointer-events: auto;
      }
      #wayfarer-s2-panel .wfs2-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      #wayfarer-s2-panel .wfs2-title { font-weight: 600; font-size: 13px; }
      #wayfarer-s2-panel .wfs2-toggle-master {
        border: none; border-radius: 3px; padding: 2px 8px; font-size: 11px; font-weight: 600;
        cursor: pointer; background: #4caf50; color: #fff;
      }
      #wayfarer-s2-panel .wfs2-toggle-master.wfs2-off { background: #9e9e9e; }
      #wayfarer-s2-panel .wfs2-level-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; cursor: pointer; font-size: 12px; }
      #wayfarer-s2-panel .wfs2-swatch { width: 12px; height: 12px; border-radius: 2px; border: 1px solid rgba(0,0,0,0.2); flex-shrink: 0; }
      #wayfarer-s2-panel .wfs2-option { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e0e0e0; font-size: 11px; cursor: pointer; }
      #wayfarer-s2-panel .wfs2-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; font-size: 10px; }
      #wayfarer-s2-panel .wfs2-legend-item { display: flex; align-items: center; gap: 4px; }
      #wayfarer-s2-panel .wfs2-swatch--free { background: transparent; border: 2px solid #FF9800; }
      #wayfarer-s2-panel .wfs2-swatch--blocked { background: rgba(229, 57, 53, 0.45); border: 2px solid #C62828; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensurePanel() {
    if (panelEl) {
      return;
    }

    injectInlineStyles();

    panelEl = document.createElement("div");
    panelEl.id = "wayfarer-s2-panel";
    panelEl.innerHTML = `
      <div class="wfs2-header">
        <span class="wfs2-title">S2 Grid</span>
        <button type="button" class="wfs2-toggle-master" title="Toggle grid">ON</button>
      </div>
      <div class="wfs2-levels"></div>
      <label class="wfs2-option">
        <input type="checkbox" class="wfs2-blocked-cb" />
        Shade blocked L17 cells
      </label>
      <div class="wfs2-legend">
        <span class="wfs2-legend-item"><span class="wfs2-swatch wfs2-swatch--free"></span>Free L17</span>
        <span class="wfs2-legend-item"><span class="wfs2-swatch wfs2-swatch--blocked"></span>Blocked L17</span>
      </div>
    `;

    panelEl.querySelector(".wfs2-toggle-master").addEventListener("click", () => {
      settings.enabled = !settings.enabled;
      syncSettingsToExtension();
      updatePanel();
      scheduleRedraw();
    });

    panelEl.querySelector(".wfs2-blocked-cb").addEventListener("change", (e) => {
      settings.highlightOccupiedL17 = e.target.checked;
      syncSettingsToExtension();
      scheduleRedraw();
    });
  }

  function syncSettingsToExtension() {
    window.postMessage({ type: W.MESSAGE_SETTINGS, settings, fromPage: true }, "*");
  }

  function renderLevelToggles() {
    const container = panelEl.querySelector(".wfs2-levels");
    container.innerHTML = "";

    settings.grids.forEach((grid, index) => {
      const row = document.createElement("label");
      row.className = "wfs2-level-row";
      row.innerHTML = `
        <input type="checkbox" data-index="${index}" ${grid.enabled ? "checked" : ""} />
        <span class="wfs2-swatch" style="background:${grid.color}"></span>
        <span>Level ${grid.level}</span>
      `;
      row.querySelector("input").addEventListener("change", (e) => {
        settings.grids[index].enabled = e.target.checked;
        syncSettingsToExtension();
        scheduleRedraw();
      });
      container.appendChild(row);
    });
  }

  function updatePanel() {
    if (!W.isMapViewPage()) {
      hidePanel();
      return;
    }

    ensurePanel();

    if (!panelEl.isConnected) {
      (document.body || document.documentElement).appendChild(panelEl);
    }

    panelEl.style.display = "block";
    positionPanel();

    const masterBtn = panelEl.querySelector(".wfs2-toggle-master");
    masterBtn.textContent = settings.enabled ? "ON" : "OFF";
    masterBtn.classList.toggle("wfs2-off", !settings.enabled);

    panelEl.querySelector(".wfs2-blocked-cb").checked = settings.highlightOccupiedL17;
    renderLevelToggles();
  }

  function applySettings(next) {
    settings = W.normalizeSettings(next);
    updatePanel();
    scheduleRedraw();
  }

  function onSettingsMessage(event) {
    if (event.source !== window || event.data?.type !== W.MESSAGE_SETTINGS) {
      return;
    }
    if (event.data.fromPage || event.data.request) {
      return;
    }
    applySettings(event.data.settings);
  }

  function onPoisMessage(event) {
    if (event.source !== window || event.data?.type !== W.MESSAGE_POIS) {
      return;
    }
    if (!Array.isArray(event.data.pois)) {
      return;
    }
    if (event.data.replace) {
      poiCache = new Map();
    }
    mergePois(event.data.pois);
    scheduleRedraw();
  }

  function updateDebugState() {
    const harvested = harvestRawMarkers();
    let inGameCount = 0;
    for (const poi of [...poiCache.values(), ...harvested]) {
      if (isInGamePoi(poi)) {
        inGameCount += 1;
      }
    }
    window.__wayfarerS2Debug = {
      poiCacheSize: poiCache.size,
      harvestedCount: harvested.length,
      inGameCount,
      occupiedL17: occupiedL17Cells.size,
    };
  }

  function onNavigation() {
    if (!W.isMapViewPage()) {
      detachMap();
      poiCache = new Map();
      occupiedL17Cells = new Set();
      updatePanel();
      return;
    }

    updatePanel();

    consumePendingMap();

    if (!map) {
      tryFindExistingMap();
      if (!findMapTimer) {
        startMapDiscovery();
      }
    }
  }

  function watchMapLegend() {
    if (window.__wfs2LegendWatch) {
      return;
    }
    window.__wfs2LegendWatch = true;

    const observer = new MutationObserver(() => {
      if (W.isMapViewPage() && getMapLegend()) {
        positionPanel();
      }
    });

    const root =
      document.querySelector(".mapview-container") ||
      document.querySelector("app-mapview") ||
      document.body;
    observer.observe(root, { childList: true, subtree: true });
  }

  function init() {
    window.addEventListener("message", onSettingsMessage);
    window.addEventListener("message", onPoisMessage);
    window.addEventListener(W.MAP_FOUND_EVENT, consumePendingMap);
    window.postMessage({ type: W.MESSAGE_SETTINGS, request: true }, "*");
    consumePendingMap();

    whenDomReady(() => {
      updatePanel();
      onNavigation();
      waitForGoogleMapsApi();
      startMapDiscovery();
      watchMapLegend();
      installRouteWatch();

      window.addEventListener("resize", positionPanel);
      window.addEventListener("scroll", positionPanel, true);
    });
  }

  init();
})();
