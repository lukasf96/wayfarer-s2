/**
 * Draws S2 cell grids on the Wayfarer Google Map (MAIN world).
 * Does NOT patch google.maps.Map — that breaks Wayfarer initialization.
 */
(function () {
  "use strict";

  const MESSAGE_TYPE = "WAYFARER_S2_SETTINGS";
  const POI_MESSAGE_TYPE = "WAYFARER_S2_POIS";
  const POI_CELL_LEVEL = 17;
  const POGO_ENTITIES = new Set(["POKESTOP", "GYM"]);

  const DEFAULT_SETTINGS = {
    enabled: true,
    highlightOccupiedL17: true,
    grids: [
      { level: 14, enabled: true, color: "#2196F3", opacity: 0.85, weight: 2 },
      { level: 17, enabled: true, color: "#FF9800", opacity: 0.95, weight: 2 },
    ],
  };

  if (!window.WayfarerS2?.S2Cell) {
    console.error("[Wayfarer S2] S2 geometry library failed to load");
    return;
  }

  const { S2Cell } = window.WayfarerS2;

  let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  let map = null;
  let mapListeners = [];
  let polygons = [];
  let panelEl = null;
  let redrawTimer = null;
  let findMapTimer = null;
  let passiveHookInstalled = false;
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

  function isMapViewPage() {
    const path = location.pathname + location.hash;
    return /mapview/i.test(path);
  }

  function isMapLike(obj) {
    return (
      obj &&
      typeof obj.getCenter === "function" &&
      typeof obj.getBounds === "function" &&
      typeof obj.getZoom === "function" &&
      typeof obj.addListener === "function"
    );
  }

  function unwrapMap(candidate) {
    if (!candidate) {
      return null;
    }
    if (isMapLike(candidate)) {
      return candidate;
    }
    if (candidate.cO && isMapLike(candidate.cO)) {
      return candidate.cO;
    }
    if (candidate.map && isMapLike(candidate.map)) {
      return candidate.map;
    }
    if (candidate.innerMap && isMapLike(candidate.innerMap)) {
      return candidate.innerMap;
    }
    return null;
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
        const found = unwrapMap(host[key]);
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
        const found = unwrapMap(host[key]);
        if (found) {
          return found;
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  function installPassiveMapCapture() {
    if (passiveHookInstalled || !window.google?.maps) {
      return passiveHookInstalled;
    }

    function capture(mapArg) {
      if (!mapArg || !isMapViewPage()) {
        return;
      }
      attachMap(mapArg);
    }

    function wrapSetMap(proto) {
      if (!proto?.setMap || proto.__wfs2SetMapHooked) {
        return;
      }
      const original = proto.setMap;
      proto.setMap = function (mapArg) {
        capture(mapArg);
        return original.apply(this, arguments);
      };
      proto.__wfs2SetMapHooked = true;
    }

    const typeNames = [
      "Marker",
      "Polygon",
      "Polyline",
      "Circle",
      "Rectangle",
      "OverlayView",
      "GroundOverlay",
      "InfoWindow",
    ];
    for (const typeName of typeNames) {
      wrapSetMap(google.maps[typeName]?.prototype);
    }
    wrapSetMap(google.maps.marker?.AdvancedMarkerElement?.prototype);

    if (!google.maps.event.__wfs2AddListenerHooked) {
      const originalAddListener = google.maps.event.addListener;
      google.maps.event.addListener = function (instance, eventName, handler) {
        const found =
          unwrapMap(instance) || (isMapLike(instance) ? instance : null);
        if (found) {
          attachMap(found);
        }
        return originalAddListener.apply(this, arguments);
      };
      google.maps.event.__wfs2AddListenerHooked = true;
    }

    passiveHookInstalled = true;
    return true;
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
    const candidates = document.querySelectorAll(
      "app-wf-base-map, nia-map, app-mapview, app-mapview-map, .map-container, .mapview-container"
    );

    for (const el of candidates) {
      try {
        const cmp = getAngularComponent(el);
        if (!cmp || typeof cmp !== "object") {
          continue;
        }

        for (const key of Object.keys(cmp)) {
          const found = unwrapMap(cmp[key]);
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

  function normalizeHarvestedMarker(marker) {
    if (!marker) {
      return null;
    }
    let lat = marker.lat;
    let lng = marker.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (typeof marker.latE6 === "number" && typeof marker.lngE6 === "number") {
        lat = marker.latE6 / 1e6;
        lng = marker.lngE6 / 1e6;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return {
      lat,
      lng,
      gmo: marker.gmo ?? marker.properties?.gmo,
    };
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

  function looksLikeMapComponent(obj) {
    return (
      obj &&
      typeof obj === "object" &&
      (Array.isArray(obj.markers) || obj._mapService)
    );
  }

  function getAngularComponent(el) {
    if (!el) {
      return null;
    }

    if (window.ng?.getComponent) {
      try {
        const cmp = window.ng.getComponent(el);
        if (cmp) {
          return cmp;
        }
      } catch {
        // fall through
      }
    }

    const ctx = el.__ngContext__;
    if (!ctx) {
      return null;
    }

    const queue = [ctx];
    const seen = new WeakSet();

    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) {
        continue;
      }
      seen.add(value);

      if (looksLikeMapComponent(value)) {
        return value;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          queue.push(item);
        }
      } else {
        for (const key of Object.keys(value)) {
          try {
            queue.push(value[key]);
          } catch {
            // ignore
          }
        }
      }
    }

    return null;
  }

  function findRawMarkersArray(root) {
    const queue = [root];
    const seen = new WeakSet();

    while (queue.length) {
      const obj = queue.shift();
      if (!obj || typeof obj !== "object" || seen.has(obj)) {
        continue;
      }
      seen.add(obj);

      if (Array.isArray(obj._rawMarkers)) {
        return obj._rawMarkers;
      }

      for (const key of Object.keys(obj)) {
        try {
          const value = obj[key];
          if (value && typeof value === "object") {
            queue.push(value);
          }
        } catch {
          // ignore
        }
      }
    }

    return null;
  }

  function pushMarkersFromList(markers, list) {
    if (!Array.isArray(list)) {
      return;
    }
    for (const marker of list) {
      const normalized = normalizeHarvestedMarker(marker);
      if (normalized) {
        markers.push(normalized);
      }
    }
  }

  function harvestRawMarkers() {
    const markers = [];
    const hosts = document.querySelectorAll(
      "app-wf-base-map, app-mapview, app-mapview-map, .mapview-container, nia-map"
    );

    for (const el of hosts) {
      try {
        const cmp = getAngularComponent(el);
        if (!cmp) {
          continue;
        }

        pushMarkersFromList(markers, cmp.markers);

        if (cmp._mapService?._rawMarkers) {
          pushMarkersFromList(markers, cmp._mapService._rawMarkers);
        }

        const raw = findRawMarkersArray(cmp);
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
    if (!map || !settings.enabled || !isMapViewPage()) {
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
    const pending = window.__wayfarerS2PendingMap;
    if (pending) {
      attachMap(pending);
    }
  }

  function attachMap(instance) {
    const resolved = unwrapMap(instance);
    if (!resolved || map === resolved) {
      return Boolean(resolved);
    }

    detachMap();
    map = resolved;

    mapListeners.push(google.maps.event.addListener(map, "idle", () => {
      scheduleRedraw();
      positionPanel();
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

    installPassiveMapCapture();

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
      installPassiveMapCapture();
      consumePendingMap();
      tryFindExistingMap();
      return;
    }

    const timer = setInterval(() => {
      if (!window.google?.maps) {
        return;
      }
      clearInterval(timer);
      installPassiveMapCapture();
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

      if (!isMapViewPage()) {
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

      installPassiveMapCapture();
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

  function positionPanel() {
    if (!panelEl || panelEl.style.display === "none") {
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
    window.postMessage({ type: MESSAGE_TYPE, settings, fromPage: true }, "*");
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
    if (!isMapViewPage()) {
      if (panelEl) {
        panelEl.style.display = "none";
      }
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

  function normalizeSettings(next) {
    const normalized = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    if (!next || typeof next !== "object") {
      return normalized;
    }

    if (typeof next.enabled === "boolean") {
      normalized.enabled = next.enabled;
    }
    if (typeof next.highlightOccupiedL17 === "boolean") {
      normalized.highlightOccupiedL17 = next.highlightOccupiedL17;
    }

    if (Array.isArray(next.grids)) {
      normalized.grids = normalized.grids.map((defaultGrid) => {
        const override = next.grids.find((g) => g && g.level === defaultGrid.level);
        return override ? { ...defaultGrid, ...override } : defaultGrid;
      });
    }

    return normalized;
  }

  function applySettings(next) {
    settings = normalizeSettings(next);
    updatePanel();
    scheduleRedraw();
  }

  function onSettingsMessage(event) {
    if (event.source !== window || event.data?.type !== MESSAGE_TYPE) {
      return;
    }
    if (event.data.fromPage || event.data.request) {
      return;
    }
    applySettings(event.data.settings);
  }

  function onPoisMessage(event) {
    if (event.source !== window || event.data?.type !== POI_MESSAGE_TYPE) {
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
    if (!isMapViewPage()) {
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
      if (getMapLegend()) {
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
    window.addEventListener("wayfarer-s2-map-found", consumePendingMap);
    window.postMessage({ type: MESSAGE_TYPE, request: true }, "*");
    consumePendingMap();

    whenDomReady(() => {
      updatePanel();
      onNavigation();
      waitForGoogleMapsApi();
      startMapDiscovery();
      watchMapLegend();

      window.addEventListener("popstate", onNavigation);
      window.addEventListener("hashchange", onNavigation);
      window.addEventListener("resize", positionPanel);
      window.addEventListener("scroll", positionPanel, true);
    });
  }

  init();
})();
