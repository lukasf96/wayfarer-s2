/**
 * Shared settings, Wayfarer page helpers, POI normalization, and Angular/map utilities.
 */
(function (global) {
  "use strict";

  const W = (global.WayfarerS2 = global.WayfarerS2 || {});

  W.MESSAGE_SETTINGS = "WAYFARER_S2_SETTINGS";
  W.MESSAGE_POIS = "WAYFARER_S2_POIS";
  W.MAP_FOUND_EVENT = "wayfarer-s2-map-found";
  W.NAVIGATION_EVENT = "wayfarer-s2-navigation";
  W.PENDING_MAP_KEY = "__wayfarerS2PendingMap";

  W.clearPendingMap = function clearPendingMap() {
    delete global[W.PENDING_MAP_KEY];
  };

  W.notifyNavigation = function notifyNavigation() {
    global.dispatchEvent(
      new CustomEvent(W.NAVIGATION_EVENT, {
        detail: { onMapView: W.isMapViewPage() },
      })
    );
  };

  W.isLiveMap = function isLiveMap(mapInstance) {
    if (!mapInstance || typeof mapInstance.getDiv !== "function") {
      return false;
    }
    try {
      const div = mapInstance.getDiv();
      return Boolean(div && div.isConnected);
    } catch {
      return false;
    }
  };

  W.DEFAULT_SETTINGS = {
    enabled: true,
    highlightOccupiedL17: true,
    grids: [
      { level: 14, enabled: true, color: "#2196F3", opacity: 0.85, weight: 2 },
      { level: 17, enabled: true, color: "#FF9800", opacity: 0.95, weight: 2 },
    ],
  };

  W.MAP_HOST_SELECTORS =
    "app-wf-base-map, nia-map, app-mapview, app-mapview-map, .map-container, .mapview-container";

  W.MAP_OVERLAY_TYPES = [
    "Marker",
    "Polygon",
    "Polyline",
    "Circle",
    "Rectangle",
    "OverlayView",
    "GroundOverlay",
    "InfoWindow",
  ];

  function cloneSettings(settings) {
    return JSON.parse(JSON.stringify(settings ?? W.DEFAULT_SETTINGS));
  }

  W.cloneSettings = cloneSettings;

  W.normalizeSettings = function normalizeSettings(settings) {
    const normalized = cloneSettings(W.DEFAULT_SETTINGS);

    if (!settings || typeof settings !== "object") {
      return normalized;
    }

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
  };

  W.isMapViewPage = function isMapViewPage() {
    return /mapview/i.test(location.pathname + location.hash);
  };

  W.isMapLike = function isMapLike(obj) {
    return (
      obj &&
      typeof obj.getCenter === "function" &&
      typeof obj.getBounds === "function" &&
      typeof obj.getZoom === "function"
    );
  };

  W.unwrapMap = function unwrapMap(candidate) {
    if (!candidate) {
      return null;
    }
    if (W.isMapLike(candidate)) {
      return candidate;
    }
    if (candidate.cO && W.isMapLike(candidate.cO)) {
      return candidate.cO;
    }
    if (candidate.map && W.isMapLike(candidate.map)) {
      return candidate.map;
    }
    if (candidate.innerMap && W.isMapLike(candidate.innerMap)) {
      return candidate.innerMap;
    }
    return null;
  };

  const POGO_ENTITY_STOP = "POKESTOP";
  const POGO_ENTITY_GYM = "GYM";
  const POGO_ENTITIES = new Set([POGO_ENTITY_STOP, POGO_ENTITY_GYM]);

  W.POGO_ENTITY_STOP = POGO_ENTITY_STOP;
  W.POGO_ENTITY_GYM = POGO_ENTITY_GYM;

  function getGmoFromPoi(poi) {
    const gmo = poi?.gmo ?? poi?.properties?.gmo;
    return Array.isArray(gmo) ? gmo : [];
  }

  W.getActivePogoEntity = function getActivePogoEntity(poi) {
    let hasStop = false;
    let hasUnknown = false;

    for (const entry of getGmoFromPoi(poi)) {
      if (!entry || String(entry.status).toUpperCase() !== "ACTIVE") {
        continue;
      }
      const entity = entry.entity ? String(entry.entity).toUpperCase() : null;
      if (entity === POGO_ENTITY_GYM) {
        return POGO_ENTITY_GYM;
      }
      if (entity === POGO_ENTITY_STOP) {
        hasStop = true;
      } else if (!entity || POGO_ENTITIES.has(entity)) {
        hasUnknown = true;
      }
    }

    if (hasStop) {
      return POGO_ENTITY_STOP;
    }
    if (hasUnknown) {
      return "UNKNOWN";
    }
    return null;
  };

  W.isInGamePoi = function isInGamePoi(poi) {
    if (!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) {
      return false;
    }
    return W.getActivePogoEntity(poi) !== null;
  };

  W.normalizePoiMarker = function normalizePoiMarker(marker) {
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
  };

  W.looksLikeMapComponent = function looksLikeMapComponent(obj) {
    return (
      obj &&
      typeof obj === "object" &&
      (Array.isArray(obj.markers) || obj._mapService)
    );
  };

  W.findInObjectGraph = function findInObjectGraph(root, predicate) {
    const queue = [root];
    const seen = new WeakSet();

    while (queue.length) {
      const obj = queue.shift();
      if (!obj || typeof obj !== "object" || seen.has(obj)) {
        continue;
      }
      seen.add(obj);

      if (predicate(obj)) {
        return obj;
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
  };

  W.getAngularComponent = function getAngularComponent(el) {
    if (!el) {
      return null;
    }

    if (global.ng?.getComponent) {
      try {
        const cmp = global.ng.getComponent(el);
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

      if (W.looksLikeMapComponent(value)) {
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
  };

  W.findMapService = function findMapService(root) {
    return W.findInObjectGraph(
      root,
      (obj) => typeof obj.updateMarkers === "function" && Array.isArray(obj._rawMarkers)
    );
  };

  W.findRawMarkersArray = function findRawMarkersArray(root) {
    const found = W.findInObjectGraph(root, (obj) => Array.isArray(obj._rawMarkers));
    return found ? found._rawMarkers : null;
  };

  W.storePendingMap = function storePendingMap(candidate) {
    const map = W.unwrapMap(candidate);
    if (!map || !W.isMapViewPage()) {
      return null;
    }
    global[W.PENDING_MAP_KEY] = map;
    global.dispatchEvent(
      new CustomEvent(W.MAP_FOUND_EVENT, { detail: { map } })
    );
    return map;
  };

  W.installEarlyMapHooks = function installEarlyMapHooks() {
    if (!global.google?.maps || global.__wfs2EarlyMapHooks) {
      return Boolean(global.__wfs2EarlyMapHooks);
    }

    function wrapSetMap(proto) {
      if (!proto?.setMap || proto.__wfs2EarlySetMapHooked) {
        return;
      }
      const original = proto.setMap;
      proto.setMap = function (mapArg) {
        W.storePendingMap(mapArg);
        return original.apply(this, arguments);
      };
      proto.__wfs2EarlySetMapHooked = true;
    }

    for (const typeName of W.MAP_OVERLAY_TYPES) {
      wrapSetMap(global.google.maps[typeName]?.prototype);
    }
    wrapSetMap(global.google.maps.marker?.AdvancedMarkerElement?.prototype);

    if (!global.google.maps.event.__wfs2EarlyListenerHooked) {
      const originalAddListener = global.google.maps.event.addListener;
      global.google.maps.event.addListener = function (instance, eventName, handler) {
        W.storePendingMap(instance);
        return originalAddListener.apply(this, arguments);
      };
      global.google.maps.event.__wfs2EarlyListenerHooked = true;
    }

    global.__wfs2EarlyMapHooks = true;
    return true;
  };
})(typeof window !== "undefined" ? window : globalThis);
