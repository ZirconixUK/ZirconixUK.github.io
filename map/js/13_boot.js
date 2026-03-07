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
    // Restore Phase 1 RoundState v1 + recent pano anti-repeat memory
    try {
      if (saved && Array.isArray(saved.recentPanoKeys)) recentPanoKeys = saved.recentPanoKeys;
      if (saved && saved.roundStateV1 && typeof saved.roundStateV1 === 'object') {
        // Backward-compatible merge: keep defaults for newly-added fields.
        const d = (typeof window.__defaultRoundStateV1 === 'function') ? window.__defaultRoundStateV1() : {};
        roundStateV1 = Object.assign({}, d, saved.roundStateV1);
        // Ensure nested objects exist
        if (!Array.isArray(roundStateV1.photos)) roundStateV1.photos = [];
      }
    } catch(e) {}
    // Prefer restoring custom (non-POI) targets first.
    if (saved && saved.targetCustom && typeof saved.targetCustom.lat === 'number' && typeof saved.targetCustom.lon === 'number') {
      targetIdx = null;
      target = {
        kind: saved.targetCustom.kind || 'pano',
        id: saved.targetCustom.id || null,
        name: saved.targetCustom.name || 'Hidden Node',
        lat: saved.targetCustom.lat,
        lon: saved.targetCustom.lon,
        pano_id: saved.targetCustom.pano_id || null,
        debug_label: saved.targetCustom.debug_label || null,
        snapshot_heading: (saved.targetCustom.snapshot_heading !== undefined) ? saved.targetCustom.snapshot_heading : null,
        snapshot_params: (saved.targetCustom.snapshot_params !== undefined) ? saved.targetCustom.snapshot_params : null,
      };

      // For pano targets, re-compute the nearest known POI for debug display.
      try {
        if (target.kind === 'pano' && typeof __nearestPoiTo === 'function') {
          const near = __nearestPoiTo(target.lat, target.lon);
          if (near && near.poi) {
            target.debug_poi = { name: near.poi.name || 'Unnamed', lat: near.poi.lat, lon: near.poi.lon, dist_m: near.dist_m };
            if (!target.debug_label) target.debug_label = target.debug_poi.name;
          }
        }
      } catch (e) {}

      roundStartMs = (typeof saved.roundStartMs === "number") ? saved.roundStartMs : Date.now();
      penaltyMs = (typeof saved.penaltyMs === "number") ? saved.penaltyMs : 0;
      // Heat: prefer continuous heatValue (new model), fallback to old heatLevel float.
      const restoredHeatValue = (typeof saved.heatValue === "number" && isFinite(saved.heatValue))
        ? saved.heatValue
        : ((typeof saved.heatLevel === "number" && isFinite(saved.heatLevel)) ? saved.heatLevel : 0);
      try {
        if (typeof setHeatValue === "function") {
          setHeatValue(restoredHeatValue, 'restore');
        } else {
          // legacy fallback
          heatLevel = restoredHeatValue;
        }
      } catch (e) {
        // ignore
      }
      heatLastMs = (typeof saved.heatLastMs === "number") ? saved.heatLastMs : Date.now();
      thermoRun = (saved.thermoRun && typeof saved.thermoRun.startMs === "number") ? saved.thermoRun : null;

      // Restore active curses (if present)
      try { if (typeof window.__restoreCursesFromSave === 'function') window.__restoreCursesFromSave(saved.activeCurses); } catch (e) {}


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

      // Restore coins (Phase 3)
      try {
        if (window.__coins && typeof window.__coins.__restoreState === 'function') {
          window.__coins.__restoreState(saved.coinsState || null);
        }
      } catch(e) {}
    } else if (saved && typeof saved.targetIdx === "number" && POIS && POIS[saved.targetIdx]) {
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
          setHeatValue(restoredHeatValue, 'restore');
        } else {
          // legacy fallback
          heatLevel = restoredHeatValue;
        }
      } catch (e) {
        // ignore
      }
      heatLastMs = (typeof saved.heatLastMs === "number") ? saved.heatLastMs : Date.now();
      thermoRun = (saved.thermoRun && typeof saved.thermoRun.startMs === "number") ? saved.thermoRun : null;

      // Restore active curses (if present)
      try { if (typeof window.__restoreCursesFromSave === 'function') window.__restoreCursesFromSave(saved.activeCurses); } catch (e) {}


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

      // Restore coins (Phase 3)
      try {
        if (window.__coins && typeof window.__coins.__restoreState === 'function') {
          window.__coins.__restoreState(saved.coinsState || null);
        }
      } catch(e) {}
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

// Keep Gameplay panel sizing responsive when switching menus or resizing.
try {
  if (typeof updateGameplayPanelWidth === "function") updateGameplayPanelWidth();
  window.addEventListener("resize", () => {
    try { if (typeof updateGameplayPanelWidth === "function") updateGameplayPanelWidth(); } catch (e) {}
  }, { passive: true });
} catch (e) {}