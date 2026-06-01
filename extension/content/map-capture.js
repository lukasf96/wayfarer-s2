/**
 * Installs passive Google Maps hooks at document_start (before Wayfarer inits the map).
 */
(function () {
  "use strict";

  const globalScope = window;
  let hooksInstalled = false;

  function isMapLike(obj) {
    return (
      obj &&
      typeof obj.getCenter === "function" &&
      typeof obj.getBounds === "function" &&
      typeof obj.getZoom === "function"
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

  function isMapViewPage() {
    return /mapview/i.test(location.pathname + location.hash);
  }

  function storeMap(candidate) {
    const map = unwrapMap(candidate);
    if (!map || !isMapViewPage()) {
      return;
    }
    globalScope.__wayfarerS2PendingMap = map;
    globalScope.dispatchEvent(
      new CustomEvent("wayfarer-s2-map-found", { detail: { map } })
    );
  }

  function installHooks() {
    if (hooksInstalled || !globalScope.google?.maps) {
      return hooksInstalled;
    }

    function wrapSetMap(proto) {
      if (!proto?.setMap || proto.__wfs2EarlySetMapHooked) {
        return;
      }
      const original = proto.setMap;
      proto.setMap = function (mapArg) {
        storeMap(mapArg);
        return original.apply(this, arguments);
      };
      proto.__wfs2EarlySetMapHooked = true;
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
      wrapSetMap(globalScope.google.maps[typeName]?.prototype);
    }
    wrapSetMap(globalScope.google.maps.marker?.AdvancedMarkerElement?.prototype);

    if (!globalScope.google.maps.event.__wfs2EarlyListenerHooked) {
      const originalAddListener = globalScope.google.maps.event.addListener;
      globalScope.google.maps.event.addListener = function (instance, eventName, handler) {
        storeMap(instance);
        return originalAddListener.apply(this, arguments);
      };
      globalScope.google.maps.event.__wfs2EarlyListenerHooked = true;
    }

    hooksInstalled = true;
    return true;
  }

  const timer = setInterval(() => {
    if (installHooks() && globalScope.__wayfarerS2PendingMap) {
      clearInterval(timer);
    }
  }, 50);

  setTimeout(() => clearInterval(timer), 120000);
})();
