// ---- Gestures ----
// Leaflet handles all pan/zoom gestures now.
// We keep ONLY the debug click-to-set-player behaviour.
//
// Bug fix: previously we attempted to attach the Leaflet click handler too early (before leafletMap existed),
// so clicks did nothing. We now wait until the map is ready and then attach exactly once.

let __debugClickAttached = false;

function __attachDebugClickHandler() {
  if (__debugClickAttached) return true;
  if (!window.leafletMap || typeof window.leafletMap.on !== "function") return false;

  window.leafletMap.on("click", (e) => {
    // Only in debug mode
    if (!debugMode) return;

    // Manual override: stop GPS watch so it doesn't overwrite.
    try { if (typeof stopGeolocationWatch === "function") stopGeolocationWatch(); } catch (_) {}

    // Set player location from click
    if (typeof setPlayerLatLng === "function") {
      setPlayerLatLng(e.latlng.lat, e.latlng.lng, { source: "manual-click", manual: true });
      log(`🧪 Debug: set player to ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} (manual override)`);
    } else {
      log("❌ Debug click: setPlayerLatLng() not found.");
    }

    try { if (typeof syncLeafletPlayerMarker === "function") syncLeafletPlayerMarker(); } catch (_) {}
    drawThrottled();
  });

  __debugClickAttached = true;
  try { console.info('[MapGame] Debug click handler attached to Leaflet map'); } catch(e) {}
  return true;
}

function setupMobileGestures() {
  // Keep trying briefly until Leaflet is initialised.
  let tries = 0;
  const maxTries = 200; // ~10s at 50ms
  const timer = setInterval(() => {
    tries++;
    if (__attachDebugClickHandler() || tries >= maxTries) clearInterval(timer);
  }, 50);
}


// AUTO-INIT: ensure the debug click handler is actually wired up.
try { setupMobileGestures(); } catch(e) { /* ignore */ }
