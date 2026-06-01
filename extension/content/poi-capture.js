/**
 * Captures Wayfarer POI data in the page MAIN world (fetch/XHR + Angular markers).
 */
(function () {
  "use strict";

  const POI_MESSAGE_TYPE = "WAYFARER_S2_POIS";

  function isMapViewPage() {
    return /mapview/i.test(location.pathname + location.hash);
  }

  function shouldCaptureMapUrl(url) {
    const value = String(url);
    return value.includes("cellLevel") || /GCS/i.test(value) || /mapview/i.test(value);
  }

  function normalizeMarker(marker) {
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
    const gmo = marker.gmo ?? marker.properties?.gmo;
    return { lat, lng, gmo };
  }

  function extractPoisFromPayload(data) {
    const pois = [];
    if (!data) {
      return pois;
    }

    function addFromList(list) {
      if (!Array.isArray(list)) {
        return;
      }
      for (const poi of list) {
        const normalized = normalizeMarker(poi);
        if (normalized) {
          pois.push(normalized);
        }
      }
    }

    addFromList(data.pois);

    const cellLists = [data.cells, data.data];
    for (const list of cellLists) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const cell of list) {
        addFromList(cell?.pois);
      }
    }

    if (Array.isArray(data)) {
      for (const entry of data) {
        addFromList(entry?.pois);
      }
    }

    return pois;
  }

  function broadcastPois(pois, replace) {
    if (!pois.length || !isMapViewPage()) {
      return;
    }
    window.postMessage({ type: POI_MESSAGE_TYPE, pois, replace: Boolean(replace) }, "*");
  }

  function broadcastMarkers(markers, replace) {
    if (!Array.isArray(markers) || !markers.length) {
      return;
    }
    const pois = [];
    for (const marker of markers) {
      const normalized = normalizeMarker(marker);
      if (normalized) {
        pois.push(normalized);
      }
    }
    broadcastPois(pois, replace);
  }

  function capturePoisFromJson(jsonText, replace) {
    try {
      const data = JSON.parse(jsonText);
      const pois = extractPoisFromPayload(data);
      broadcastPois(pois, replace);
    } catch {
      // ignore non-json responses
    }
  }

  function setupNetworkCapture() {
    if (window.__wfs2NetworkCapture) {
      return;
    }
    window.__wfs2NetworkCapture = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && shouldCaptureMapUrl(url)) {
        response
          .clone()
          .text()
          .then((text) => capturePoisFromJson(text, false))
          .catch(() => {});
      }
      return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__wfs2Url = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", function () {
        if (!this.__wfs2Url || !shouldCaptureMapUrl(this.__wfs2Url)) {
          return;
        }
        if (typeof this.responseText === "string") {
          capturePoisFromJson(this.responseText, false);
        }
      });
      return originalSend.apply(this, arguments);
    };
  }

  function hookMapService(service) {
    if (!service || service.__wfs2MarkersHooked) {
      return;
    }
    if (typeof service.updateMarkers !== "function") {
      return;
    }

    const original = service.updateMarkers.bind(service);
    service.updateMarkers = function (markers, cellLevel) {
      broadcastMarkers(markers, false);
      return original(markers, cellLevel);
    };
    service.__wfs2MarkersHooked = true;

    if (Array.isArray(service._rawMarkers) && service._rawMarkers.length) {
      broadcastMarkers(service._rawMarkers, false);
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

  function findMapService(root) {
    const queue = [root];
    const seen = new WeakSet();

    while (queue.length) {
      const obj = queue.shift();
      if (!obj || typeof obj !== "object" || seen.has(obj)) {
        continue;
      }
      seen.add(obj);

      if (typeof obj.updateMarkers === "function" && Array.isArray(obj._rawMarkers)) {
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
  }

  function harvestFromAngular() {
    const selectors = ["app-wf-base-map", "app-mapview", "app-mapview-map", "nia-map"];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        try {
          const cmp = getAngularComponent(el);
          if (!cmp) {
            continue;
          }

          if (Array.isArray(cmp.markers) && cmp.markers.length) {
            broadcastMarkers(cmp.markers, false);
          }

          if (cmp._mapService) {
            hookMapService(cmp._mapService);
          }

          const service = findMapService(cmp);
          if (service) {
            hookMapService(service);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  function startAngularHarvest() {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (!isMapViewPage()) {
        if (ticks > 5) {
          clearInterval(timer);
        }
        return;
      }
      harvestFromAngular();
      if (ticks >= 120) {
        clearInterval(timer);
      }
    }, 1000);
  }

  setupNetworkCapture();
  startAngularHarvest();
})();
