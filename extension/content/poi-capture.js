/**
 * Captures Wayfarer POI data in the page MAIN world (fetch/XHR + Angular markers).
 */
(function () {
  "use strict";

  const W = window.WayfarerS2;
  if (!W?.normalizePoiMarker) {
    console.error("[Wayfarer S2] core library failed to load");
    return;
  }

  function shouldCaptureMapUrl(url) {
    const value = String(url);
    return value.includes("cellLevel") || /GCS/i.test(value) || /mapview/i.test(value);
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
        const normalized = W.normalizePoiMarker(poi);
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
    if (!pois.length || !W.isMapViewPage()) {
      return;
    }
    window.postMessage({ type: W.MESSAGE_POIS, pois, replace: Boolean(replace) }, "*");
  }

  function broadcastMarkers(markers, replace) {
    if (!Array.isArray(markers) || !markers.length) {
      return;
    }
    const pois = [];
    for (const marker of markers) {
      const normalized = W.normalizePoiMarker(marker);
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

  function harvestFromAngular() {
    for (const el of document.querySelectorAll(W.MAP_HOST_SELECTORS)) {
      try {
        const cmp = W.getAngularComponent(el);
        if (!cmp) {
          continue;
        }

        if (Array.isArray(cmp.markers) && cmp.markers.length) {
          broadcastMarkers(cmp.markers, false);
        }

        if (cmp._mapService) {
          hookMapService(cmp._mapService);
        }

        const service = W.findMapService(cmp);
        if (service) {
          hookMapService(service);
        }
      } catch {
        // ignore
      }
    }
  }

  function startAngularHarvest() {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (!W.isMapViewPage()) {
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
