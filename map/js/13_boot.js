// ---- Boot ----

// Allow map image loader to notify us when it finishes (including cached loads).
window.__onMapLoaded = function () {
  try {
    if (!mapReady) return;
    // Fit view once map dimensions are known
    if (typeof fitViewToMap === "function") fitViewToMap();
    if (typeof updateUI === "function") updateUI();
    if (typeof draw === "function") draw();
    // Leaflet refactor: attach debug click handler once the map exists
    try { if (typeof setupMobileGestures === 'function') setupMobileGestures(); } catch(e) {}
  } catch (e) {
    console.error("onMapLoaded error", e);
  }
};

window.addEventListener("resize", () => {
  if (!mapReady) return;
  if (typeof fitViewToMap === "function") fitViewToMap();
  if (typeof draw === "function") draw();
});


let __didRestoreOverlays = false;

function __tryRestoreFog(saved) {
  try {
    const fogActions = saved && saved.fogActions ? saved.fogActions : null;
    if (!fogActions) return false;
    if (!window.leafletMap || !window.martinez) return false;
    if (typeof rebuildFogFromActions !== "function") return false;
    rebuildFogFromActions(fogActions);
    if (!__didRestoreOverlays) {
      __didRestoreOverlays = true;
      try { if (typeof log === 'function') log('🔄 Restored existing overlays.'); } catch(e) {}
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

(async function init() {
  updateFogUI();
  await loadPois();
  // Restore persisted round (target + timer) if possible.
  let __saved = null;
  try {
    __saved = loadRoundState();
    const saved = __saved;
    if (saved && typeof saved.targetIdx === "number" && POIS && POIS[saved.targetIdx]) {
      targetIdx = saved.targetIdx;
      target = POIS[targetIdx];
      roundStartMs = (typeof saved.roundStartMs === "number") ? saved.roundStartMs : Date.now();
      penaltyMs = (typeof saved.penaltyMs === "number") ? saved.penaltyMs : 0;
      // Heat: prefer continuous heatValue (new model), fallback to old heatLevel float.
      const restoredHeatValue = (typeof saved.heatValue === "number" && isFinite(saved.heatValue))
        ? saved.heatValue
        : ((typeof saved.heatLevel === "number" && isFinite(saved.heatLevel)) ? saved.heatLevel : 0);
      try {
        if (typeof setHeatValue === "function") {
          setHeatValue(restoredHeatValue);
        } else {
          // legacy fallback
          heatLevel = restoredHeatValue;
        }
      } catch (e) {
        // ignore
      }
      heatLastMs = (typeof saved.heatLastMs === "number") ? saved.heatLastMs : Date.now();
      thermoRun = (saved.thermoRun && typeof saved.thermoRun.startMs === "number") ? saved.thermoRun : null;

      // Restore debug mode + manual player location (only if it was manually overridden)
      if (typeof saved.debugMode === "boolean") {
        debugMode = saved.debugMode;
        try {
          const cb = document.getElementById("dbgMode");
          if (cb) cb.checked = !!debugMode;
        } catch (e) {}
      }
      if (saved.playerSaved && typeof saved.playerSaved.lat === "number" && typeof saved.playerSaved.lon === "number") {
        try {
          if (typeof setPlayerLatLng === "function") {
            setPlayerLatLng(saved.playerSaved.lat, saved.playerSaved.lon, { source: "restore", manual: true, force: true });
          } else {
            player = { lat: saved.playerSaved.lat, lon: saved.playerSaved.lon, manualOverride: true };
          }
        } catch (e) {}
      }
    } else {
      pickNewTarget(false);
    }
  } catch (e) {
    pickNewTarget(false);
  }

  try { startHUDTicker(); } catch (e) {}
  try { updateHUD(); } catch (e) {}
  try { if (typeof scheduleThermoCompletion === "function") scheduleThermoCompletion(); } catch (e) {}
  // Restore fog overlay from saved tool usage (requires Leaflet + martinez ready)
  (function(){
    const saved = (typeof __saved !== "undefined") ? __saved : null;
    if (!saved || !saved.fogActions) return;
    let tries = 0;
    const maxTries = 200; // ~10s
    const t = setInterval(() => {
      tries++;
      if (__tryRestoreFog(saved) || tries >= maxTries) clearInterval(t);
    }, 50);
  })();
  updateUI();
  try { if (typeof refreshLeafletMarkersVisibility === 'function') refreshLeafletMarkersVisibility(); } catch(e) {}
  try { if (typeof syncLeafletTargetMarker === 'function') syncLeafletTargetMarker(); } catch(e) {}

  log("Ready. Tip: on mobile, use HTTPS or localhost for geolocation.");
  // Always render once so we show either map, loading, or errors.
  if (typeof draw === "function") draw();
})();

// After all scripts loaded, bind UI handlers.
if (typeof window.bindUI === "function") {
  window.bindUI();
}