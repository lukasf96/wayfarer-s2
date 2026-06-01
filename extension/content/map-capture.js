/**
 * Installs passive Google Maps hooks at document_start (before Wayfarer inits the map).
 */
(function () {
  "use strict";

  const W = window.WayfarerS2;
  if (!W?.installEarlyMapHooks) {
    console.error("[Wayfarer S2] core library failed to load");
    return;
  }

  const timer = setInterval(() => {
    if (W.installEarlyMapHooks() && window[W.PENDING_MAP_KEY]) {
      clearInterval(timer);
    }
  }, 50);

  setTimeout(() => clearInterval(timer), 120000);
})();
