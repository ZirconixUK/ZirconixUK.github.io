// ---- Clues / Questions ----
let __isPickingTarget = false;

function __randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function __randomPointInBbox() {
  const nw = (typeof BBOX !== 'undefined' && BBOX && BBOX.nw) ? BBOX.nw : null;
  const se = (typeof BBOX !== 'undefined' && BBOX && BBOX.se) ? BBOX.se : null;
  if (!nw || !se) return null;
  const lat = __randBetween(se.lat, nw.lat);
  const lon = __randBetween(nw.lon, se.lon);
  return { lat, lon };
}

function __insideBbox(lat, lon) {
  const nw = (typeof BBOX !== 'undefined' && BBOX && BBOX.nw) ? BBOX.nw : null;
  const se = (typeof BBOX !== 'undefined' && BBOX && BBOX.se) ? BBOX.se : null;
  if (!nw || !se) return true;
  return lat <= nw.lat && lat >= se.lat && lon >= nw.lon && lon <= se.lon;
}

async function __streetViewMetadata(lat, lon, radiusM) {
  const key = (typeof GOOGLE_STREETVIEW_API_KEY !== 'undefined') ? GOOGLE_STREETVIEW_API_KEY : '';
  if (!key) return { ok: false, status: 'NO_KEY' };
  const params = new URLSearchParams();
  params.set('location', `${lat},${lon}`);
  if (typeof radiusM === 'number' && isFinite(radiusM) && radiusM > 0) params.set('radius', String(Math.round(radiusM)));
  // Prefer outdoor panoramas (avoids indoor/venue collections when possible).
  // If no outdoor pano exists nearby, metadata may return ZERO_RESULTS and we'll re-roll.
  try { params.set('source', 'outdoor'); } catch(e) {}
  params.set('key', String(key));
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  if (!data || data.status !== 'OK' || !data.location) {
    return { ok: false, status: (data && data.status) ? data.status : 'ERR' };
  }
  return {
    ok: true,
    pano_id: data.pano_id || null,
    location: { lat: data.location.lat, lon: data.location.lng },
    date: data.date || null,
    status: data.status,
  };
}

function __nearestPoiTo(lat, lon) {
  // Pick the nearest POI for debugging / landmark tools.
  // Linear scan is fine at "new target" time.
  if (!Array.isArray(POIS) || POIS.length === 0) return null;

  // This file loads before js/12_geo_helpers.js in index.html, so we cannot
  // assume haversineMeters() exists yet. Provide a tiny local fallback.
  const hav = (typeof haversineMeters === 'function')
    ? haversineMeters
    : function(a, b) {
        const R = 6371000;
        const toRad = (deg) => deg * Math.PI / 180;
        const dLat = toRad(b.lat - a.lat);
        const dLon = toRad(b.lon - a.lon);
        const lat1 = toRad(a.lat);
        const lat2 = toRad(b.lat);
        const s1 = Math.sin(dLat/2);
        const s2 = Math.sin(dLon/2);
        const h = s1*s1 + Math.cos(lat1)*Math.cos(lat2)*s2*s2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
      };
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < POIS.length; i++) {
    const p = POIS[i];
    if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    const d = hav({ lat, lon }, { lat: p.lat, lon: p.lon });
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return null;
  return { poi: best, dist_m: bestD };
}

function __rollTargetDistanceBand() {
  // Defaults if config is missing.
  const pFar = (typeof TARGET_BAND_PROB_FAR_GT_2KM !== 'undefined') ? TARGET_BAND_PROB_FAR_GT_2KM : 0.10;
  const pClose = (typeof TARGET_BAND_PROB_CLOSE_LE_1KM !== 'undefined') ? TARGET_BAND_PROB_CLOSE_LE_1KM : 0.60;
  const pMid = (typeof TARGET_BAND_PROB_MID_1_TO_2KM !== 'undefined') ? TARGET_BAND_PROB_MID_1_TO_2KM : 0.30;

  const closeMax = (typeof TARGET_BAND_CLOSE_MAX_M !== 'undefined') ? TARGET_BAND_CLOSE_MAX_M : 1000;
  const midMin = (typeof TARGET_BAND_MID_MIN_M !== 'undefined') ? TARGET_BAND_MID_MIN_M : 1000;
  const midMax = (typeof TARGET_BAND_MID_MAX_M !== 'undefined') ? TARGET_BAND_MID_MAX_M : 2000;
  const farMin = (typeof TARGET_BAND_FAR_MIN_M !== 'undefined') ? TARGET_BAND_FAR_MIN_M : 2000;

  const r = Math.random();
  // Normalize in case probabilities don't sum to 1.
  const sum = (pFar + pClose + pMid) || 1;
  const rf = r * sum;

  if (rf < pFar) return { label: `> ${Math.round(farMin/1000)}km`, min: farMin, max: Infinity };
  if (rf < pFar + pClose) return { label: `≤ ${Math.round(closeMax/1000)}km`, min: 0, max: closeMax };
  return { label: `${Math.round(midMin/1000)}–${Math.round(midMax/1000)}km`, min: midMin, max: midMax };
}

async function __pickStreetViewPanoTarget(startLatLng) {
  const maxAttempts = (typeof STREETVIEW_TARGET_MAX_ATTEMPTS !== 'undefined') ? STREETVIEW_TARGET_MAX_ATTEMPTS : 25;
  const radiusM = (typeof STREETVIEW_METADATA_RADIUS_M !== 'undefined') ? STREETVIEW_METADATA_RADIUS_M : 200;

  // Phase 6: pick a hidden distance band from the round start (if we have one).
  const hasStart = !!(startLatLng && typeof startLatLng.lat === 'number' && typeof startLatLng.lon === 'number');
  const band = hasStart ? __rollTargetDistanceBand() : null;
  if (debugMode && band) {
    try { log(`🧭 Target band rolled: ${band.label}`); } catch(e) {}
  }

  for (let i = 0; i < maxAttempts; i++) {
    const p = __randomPointInBbox();
    if (!p) break;
    let meta = null;
    try {
      meta = await __streetViewMetadata(p.lat, p.lon, radiusM);
    } catch (e) {
      continue;
    }
    if (!meta || !meta.ok || !meta.location) continue;
    if (!__insideBbox(meta.location.lat, meta.location.lon)) continue;

    // Phase 6: enforce band distance from start (if present).
    let distFromStartM = null;
    if (band && hasStart && typeof haversineMeters === 'function') {
      try {
        distFromStartM = haversineMeters(startLatLng.lat, startLatLng.lon, meta.location.lat, meta.location.lon);
      } catch (e) {
        distFromStartM = null;
      }
      if (!(typeof distFromStartM === 'number' && isFinite(distFromStartM))) distFromStartM = null;
      if (distFromStartM !== null) {
        if (distFromStartM < band.min || distFromStartM > band.max) continue;
      }
    }

    const panoId = meta.pano_id || null;
    // Avoid repeats (Phase 1 optional, but recommended)
    try {
      if (typeof window.__isPanoRecentlyUsed === 'function' && window.__isPanoRecentlyUsed(panoId, meta.location.lat, meta.location.lon)) continue;
    } catch(e) {}
    try {
      if (typeof window.__rememberPanoUsed === 'function') window.__rememberPanoUsed(panoId, meta.location.lat, meta.location.lon);
    } catch(e) {}

    // Phase 6: log the exact start→target distance (debug)
    try {
      if (debugMode && typeof distFromStartM === 'number' && isFinite(distFromStartM)) {
        log(`📏 Target distance: ${distFromStartM.toFixed(0)}m from start`);
      }
    } catch (e) {}

    return {
      ok: true,
      target: {
        kind: 'pano',
        id: panoId ? `pano:${panoId}` : `pano:${meta.location.lat.toFixed(6)},${meta.location.lon.toFixed(6)}`,
        name: 'Hidden Node',
        lat: meta.location.lat,
        lon: meta.location.lon,
        pano_id: panoId,
        debug_dist_from_start_m: (typeof distFromStartM === 'number' && isFinite(distFromStartM)) ? distFromStartM : null,
        meta: { date: meta.date || null },
        debug_dist_from_start_m: (distFromStartM !== null) ? distFromStartM : null,
      }
    };
  }
  return { ok: false, reason: 'no_pano_found' };
}
function ensureReady() {
  if (!player) { log("⚠️ Tap “Enable location” first."); return false; }
  if (__isPickingTarget) { log("⏳ Choosing a target…"); return false; }
  if (!target) pickNewTarget(false);
  return true;
}

function pickNewTarget(verbose = true) {
  if (__isPickingTarget) return;
  __isPickingTarget = true;

  // Debug/dev convenience: when starting a new round, spawn the player just outside
  // Lime Street Station (so the loop is repeatable when testing).
  // In normal play, GPS will overwrite this unless debug mode is on.
  try {
    const dbg = (typeof debugMode !== 'undefined') ? !!debugMode : false;
    const hasPlayer = !!(player && typeof player.lat === 'number' && typeof player.lon === 'number');
    if ((dbg || !hasPlayer) && typeof DEFAULT_START_LATLNG !== 'undefined' && DEFAULT_START_LATLNG) {
      setPlayerLatLng(DEFAULT_START_LATLNG.lat, DEFAULT_START_LATLNG.lon, { manual: true, source: 'debug:spawn' });
      if (dbg) log(`🧪 Debug: spawn player to ${DEFAULT_START_LATLNG.lat.toFixed(6)}, ${DEFAULT_START_LATLNG.lon.toFixed(6)} (Lime Street)`);
    }
  } catch (e) {}

  // Clear overlays/caches immediately so the UI feels like a fresh round.
  try { if (typeof clearClues === 'function') clearClues(); } catch(e) {}
  try { if (typeof clearFog === 'function') clearFog(); } catch(e) {}
  try { if (typeof clearStreetViewGlimpseCache === 'function') clearStreetViewGlimpseCache(); } catch(e) {}
  try { if (typeof clearRevealOverlay === 'function') clearRevealOverlay(); } catch(e) {}

  // Clear any existing target marker while we pick.
  targetIdx = null;
  target = null;
  try { if (typeof syncLeafletTargetMarker === 'function') syncLeafletTargetMarker(); } catch(e) {}

  if (verbose) log('🎯 Choosing a new target…');
  updateUI();
  try { if (typeof updateHUD === "function") updateHUD(); } catch(e) {}
  try { if (typeof draw === 'function') draw(); } catch(e) {}

  (async () => {
    const usePano = (typeof USE_STREETVIEW_PANO_TARGETS !== 'undefined') ? !!USE_STREETVIEW_PANO_TARGETS : false;

    // Prefer pano targets when enabled.
    // Capture round start reference for Phase 6 distance banding.
    const startRef = (player && typeof player.lat === 'number' && typeof player.lon === 'number')
      ? { lat: player.lat, lon: player.lon }
      : null;

    if (usePano) {
      try {
        const chosen = await __pickStreetViewPanoTarget(startRef);
        if (chosen && chosen.ok && chosen.target) {
          target = chosen.target;
          targetIdx = null;

          // For debug + future tools: keep track of the nearest known POI to this pano target.
          try {
            const near = __nearestPoiTo(target.lat, target.lon);
            if (near && near.poi) {
              target.debug_poi = { name: near.poi.name || 'Unnamed', lat: near.poi.lat, lon: near.poi.lon, dist_m: near.dist_m };
              // A simple string label that the debug UI can always display, even
              // if other restore paths fail to re-compute debug_poi.
              target.debug_label = target.debug_poi.name;
            } else {
              target.debug_poi = null;
              target.debug_label = null;
            }
          } catch (e) {
            target.debug_poi = null;
            target.debug_label = null;
          }
        }
      } catch (e) {
        // ignore; fallback below
      }
    }

    // Fallback: old POI target selection (keeps game playable even if Street View metadata fails).
    if (!target) {
      targetIdx = Math.floor(Math.random() * POIS.length);
      target = POIS[targetIdx];
    }

    // New round starts whenever a new target is chosen.
    try { resetRound({ keepTarget: true }); } catch(e) {}
    try {
      if (typeof window.__initRoundStateV1ForNewTarget === 'function' && player && target) {
        window.__initRoundStateV1ForNewTarget({ lat: player.lat, lon: player.lon }, target);
      }
    } catch(e) {}
    try { saveRoundState(); } catch(e) {}
    try { if (typeof syncLeafletTargetMarker === 'function') syncLeafletTargetMarker(); } catch(e) {}

    if (verbose) {
      if (debugMode && target) {
        // For pano targets, show nearest POI as the human-readable label.
        let label = (target.name ?? 'Unnamed');
        let extra = '';
        if (target.kind === 'pano' && target.debug_poi && target.debug_poi.name) {
          const dm = (typeof target.debug_poi.dist_m === 'number' && isFinite(target.debug_poi.dist_m)) ? target.debug_poi.dist_m : null;
          label = target.debug_poi.name;
          extra = dm !== null ? ` (${dm.toFixed(0)}m from pano)` : '';
        }
        let distBit = '';
        try {
          const dms = (typeof target.debug_dist_from_start_m === 'number' && isFinite(target.debug_dist_from_start_m))
            ? target.debug_dist_from_start_m
            : (startRef && typeof haversineMeters === 'function')
              ? haversineMeters(startRef.lat, startRef.lon, target.lat, target.lon)
              : null;
          if (typeof dms === 'number' && isFinite(dms)) distBit = ` | start→target ${dms.toFixed(0)}m`;
        } catch(e) {}
        log(`🎯 New target: ${label}${extra} | pano @ ${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}${distBit}`);
      } else {
        log(`🎯 New target chosen (hidden).`);
      }
    }

    updateUI();
    try { if (typeof updateHUD === "function") updateHUD(); } catch(e) {}
    try { if (typeof draw === 'function') draw(); } catch(e) {}

    // Phase 1: always show the initial "Circle Snapshot" for the new target.
    try {
      if (typeof showStreetViewGlimpseForTarget === 'function') {
        await showStreetViewGlimpseForTarget({ context: 'snapshot' });
      }
    } catch (e) {
      // If Street View fails, don't block the round; player can still use other tools.
    }
  })().finally(() => {
    __isPickingTarget = false;
  });
}

function clearClues() {
  clues.length = 0;
  try { if (typeof clearFog === "function") clearFog(); } catch(e) {}
  thermoBaseline = null;
  if (elLast) { elLast.className = "pill mid"; elLast.textContent = "Cleared"; }
  updateUI();
  draw();
  log("🧽 Cleared clues.");
}

function addClue(clue) {
  clues.push({ ...clue, ts: Date.now() });
  updateUI();
  draw();
}

function askRadar(metersOverride) {
  if (!ensureReady()) return;

  const meters = (typeof metersOverride === "number" && !isNaN(metersOverride) && metersOverride > 0)
    ? metersOverride
    : parseFloat(elRadarPreset ? elRadarPreset.value : "100");

  // Distance in meters (prefer Leaflet's distance helper if available)
  let dist = NaN;
  try {
    if (window.leafletMap && typeof window.leafletMap.distance === "function") {
      dist = window.leafletMap.distance(
        L.latLng(player.lat, player.lon),
        L.latLng(target.lat, target.lon)
      );
    }
  } catch (e) {}

  if (!isFinite(dist)) {
    // Fallback to our haversine helper (expects {lat,lon} objects)
    dist = haversineMeters(
      { lat: player.lat, lon: player.lon },
      { lat: target.lat, lon: target.lon }
    );
  }

  const ok = dist <= meters;

  // Leaflet geometry fog (new system)
  try {
    if (typeof addFogRadar === "function") addFogRadar(player.lat, player.lon, meters, ok);
  } catch (e) {}

  // Keep legacy clue storage for future tools/compat (not used for fog anymore)
  const pp = latLonToPixel(player.lat, player.lon);
  const rPx = radiusMetersToPixels(player.lat, player.lon, meters);
  addClue({ type: "ring", x: pp.x, y: pp.y, r: rPx, ok });

  setLast(ok ? `TRUE (≤${meters}m)` : `FALSE (>${meters}m)`, ok);
  log(`📡 Radar ${meters}m → ${ok ? "TRUE" : "FALSE"} (actual ${dist.toFixed(0)}m)`);

  return { ok, meters, dist };
}

function askDirection(dir) {
  if (!ensureReady()) return;
  let ok = false;
  if (dir === "N") ok = target.lat > player.lat;
  if (dir === "S") ok = target.lat < player.lat;
  if (dir === "E") ok = target.lon > player.lon;
  if (dir === "W") ok = target.lon < player.lon;

  try { if (typeof addFogDirection === "function") addFogDirection(player.lat, player.lon, dir, ok); } catch(e) {}

  const pp = latLonToPixel(player.lat, player.lon);
  addClue({ type: "half", x: pp.x, y: pp.y, dir, ok });

  setLast(ok ? "TRUE" : "FALSE", ok);
  log(`🧭 ${dir} of me? → ${ok ? "TRUE" : "FALSE"}`);
  return { ok, dir };
}
function askQuadrant() {
  if (!ensureReady()) return;
  const north = target.lat > player.lat;
  const east = target.lon > player.lon;
  const quad = (north && east) ? "NE" : (north && !east) ? "NW" : (!north && east) ? "SE" : "SW";

  try { if (typeof addFogQuadrant === "function") addFogQuadrant(player.lat, player.lon, quad); } catch(e) {}

  const pp = latLonToPixel(player.lat, player.lon);
  addClue({ type: "quadrant", x: pp.x, y: pp.y, quad, ok: true });

  setLast(quad, true);
  log(`🧩 Quadrant → ${quad}`);
  return { quad };
}
function askBearing() {
  if (!ensureReady()) return;
  const buckets = parseInt(elBearingBuckets.value, 10);
  const deg = bearingDeg(player.lat, player.lon, target.lat, target.lon);

  const labels4 = ["N","E","S","W"];
  const labels8 = ["N","NE","E","SE","S","SW","W","NW"];
  const labels = (buckets === 4) ? labels4 : labels8;
  const bucketSize = 360 / buckets;
  const idx = Math.floor((deg + bucketSize / 2) / bucketSize) % buckets;
  const label = labels[idx];

  const centerDeg = idx * bucketSize;
  const startDeg = centerDeg - bucketSize / 2;
  const endDeg = centerDeg + bucketSize / 2;

  try { if (typeof addFogBearingWedge === "function") addFogBearingWedge(player.lat, player.lon, startDeg, endDeg); } catch(e) {}

  const pp = latLonToPixel(player.lat, player.lon);
  addClue({
    type: "wedge",
    x: pp.x, y: pp.y,
    a0: toRad(startDeg - 90),
    a1: toRad(endDeg - 90),
    ok: true,
    label
  });

  setLast(label, true);
  log(`🧭 Bearing (${buckets}) → ${label} (${deg.toFixed(0)}°)`);
  return { label, startDeg, endDeg, deg, buckets };
}
function askDistanceBucket() {
  if (!ensureReady()) return;
  const bucket = parseBucket(elDistBucket.value);

  let dist = NaN;
  try {
    if (window.leafletMap && typeof window.leafletMap.distance === "function") {
      dist = window.leafletMap.distance(
        L.latLng(player.lat, player.lon),
        L.latLng(target.lat, target.lon)
      );
    }
  } catch(e) {}
  if (!isFinite(dist)) {
    dist = haversineMeters(
      { lat: player.lat, lon: player.lon },
      { lat: target.lat, lon: target.lon }
    );
  }

  const ok = dist >= bucket.min && dist < bucket.max;

  try { if (typeof addFogDistanceBucket === "function") addFogDistanceBucket(player.lat, player.lon, bucket.min, bucket.max, ok); } catch(e) {}

  const pp = latLonToPixel(player.lat, player.lon);
  const MW = (window.FOG_W||1000), MH = (window.FOG_H||1000);
  const rIn = bucket.min <= 0 ? 0 : radiusMetersToPixels(player.lat, player.lon, bucket.min);
  const rOut = bucket.max === Infinity ? Math.max(MW, MH) * 1.6 : radiusMetersToPixels(player.lat, player.lon, bucket.max);

  addClue({ type: "donut", x: pp.x, y: pp.y, rIn, rOut, ok, text: bucket.text });
  setLast(ok ? `TRUE (${bucket.text})` : `FALSE (${bucket.text})`, ok);
  log(`📏 Distance bucket ${bucket.text} → ${ok ? "TRUE" : "FALSE"} (actual ${dist.toFixed(0)}m)`);

  return { ok, bucket, dist };
}
function askThermometer() {
  if (!ensureReady()) return;
  if (!thermoBaseline) {
    thermoBaseline = { ...player };
    log("🌡️ Thermometer baseline set. Walk somewhere else, then press again.");
    setLast("Baseline set", true);
    return { baselineSet: true };
  }

  const distFn = (aLat,aLon,bLat,bLon) => {
    try {
      if (window.leafletMap && typeof window.leafletMap.distance === "function") {
        return window.leafletMap.distance(L.latLng(aLat,aLon), L.latLng(bLat,bLon));
      }
    } catch(e) {}
    return haversineMeters({lat:aLat, lon:aLon}, {lat:bLat, lon:bLon});
  };

  const d0 = distFn(thermoBaseline.lat, thermoBaseline.lon, target.lat, target.lon);
  const d1 = distFn(player.lat, player.lon, target.lat, target.lon);
  const hotter = d1 < d0;

  // Leaflet geometry fog (thermometer)
  try { if (typeof addFogThermometer === "function") addFogThermometer(startP.lat, startP.lon, endP.lat, endP.lon, hotter); } catch(e) {}

  try { if (typeof addFogThermometer === "function") addFogThermometer(thermoBaseline.lat, thermoBaseline.lon, player.lat, player.lon, hotter); } catch(e) {}

  const p0 = latLonToPixel(thermoBaseline.lat, thermoBaseline.lon);
  const p1 = latLonToPixel(player.lat, player.lon);
  addClue({ type: "thermo", a: p0, b: p1, ok: hotter });

  setLast(hotter ? "HOTTER" : "COLDER", hotter);
  log(`🌡️ ${hotter ? "HOTTER" : "COLDER"} (baseline ${d0.toFixed(0)}m → now ${d1.toFixed(0)}m)`);
  return { hotter, d0, d1 };
}
// ---- Timed Thermometer ----
let __thermoTimeout = null;

function startTimedThermometer(seconds) {
  if (!ensureReady()) return null;
  if (!player) {
    log("🌡️ Thermometer failed: no player location yet.");
    return { ok: false, reason: "no_player" };
  }
  const secs = Math.max(1, parseFloat(seconds) || 0);
  const durationMs = Math.round(secs * 1000);

  const run = {
    startMs: Date.now(),
    durationMs,
    startPlayer: { lat: player.lat, lon: player.lon },
  };
  if (typeof setThermoRun === "function") setThermoRun(run);

  // Log start info
  const t = new Date(run.startMs);
  const hh = String(t.getHours()).padStart(2,"0");
  const mm = String(t.getMinutes()).padStart(2,"0");
  const ss = String(t.getSeconds()).padStart(2,"0");
  log(`🌡️ Thermometer started (${secs}s) at ${hh}:${mm}:${ss} — start @ ${run.startPlayer.lat.toFixed(6)}, ${run.startPlayer.lon.toFixed(6)}`);

  scheduleThermoCompletion();
  return { ok: true, seconds: secs };
}

function scheduleThermoCompletion() {
  try { if (__thermoTimeout) clearTimeout(__thermoTimeout); } catch (e) {}
  __thermoTimeout = null;

  if (!thermoRun || typeof thermoRun.startMs !== "number" || typeof thermoRun.durationMs !== "number") return;
  const endMs = thermoRun.startMs + thermoRun.durationMs;
  const remaining = endMs - Date.now();
  const delay = Math.max(0, remaining);

  __thermoTimeout = setTimeout(() => {
    try { completeTimedThermometer(); } catch (e) { console.error(e); }
  }, delay);
}

function completeTimedThermometer() {
  if (!thermoRun) return;
  if (!ensureReady()) return;

  const startP = thermoRun.startPlayer;
  const endP = player ? { lat: player.lat, lon: player.lon } : null;

  const endMs = thermoRun.startMs + thermoRun.durationMs;
  const t = new Date(endMs);
  const hh = String(t.getHours()).padStart(2,"0");
  const mm = String(t.getMinutes()).padStart(2,"0");
  const ss = String(t.getSeconds()).padStart(2,"0");

  if (!endP) {
    log(`🌡️ Thermometer completed at ${hh}:${mm}:${ss} — but no current player location, so cannot compare.`);
    if (typeof clearThermoRun === "function") clearThermoRun();
    try { if (typeof updateHUD === "function") updateHUD(); } catch(e) {}
    if (typeof showToast === "function") showToast("Thermometer finished, but I couldn't read your current location.", false);
    return;
  }

  
  // Validate that the player actually moved (>= 100m) or the thermo is invalid.
  const moved = haversineMeters(startP.lat, startP.lon, endP.lat, endP.lon);
  if (moved < 100) {
    log(`🌡️ Thermometer cancelled: you only moved ${moved.toFixed(0)}m (need at least 100m).`);
    if (typeof clearThermoRun === "function") clearThermoRun();
    try { if (typeof updateHUD === "function") updateHUD(); } catch(e) {}
    if (typeof showToast === "function") showToast("Thermometer cancelled — move at least 100m before it completes.", false);
    return;
  }

const d0 = haversineMeters(startP.lat, startP.lon, target.lat, target.lon);
  const d1 = haversineMeters(endP.lat, endP.lon, target.lat, target.lon);
  const hotter = d1 < d0;

  // Leaflet geometry fog (thermometer)
  try { if (typeof addFogThermometer === "function") addFogThermometer(startP.lat, startP.lon, endP.lat, endP.lon, hotter); } catch(e) {}

  log(`🌡️ Thermometer completed at ${hh}:${mm}:${ss}`);
  log(`   Start @ ${startP.lat.toFixed(6)}, ${startP.lon.toFixed(6)} (dist ${d0.toFixed(0)}m)`);
  log(`   End   @ ${endP.lat.toFixed(6)}, ${endP.lon.toFixed(6)} (dist ${d1.toFixed(0)}m)`);
  log(`   Result: ${hotter ? "HOTTER (closer)" : "COLDER (further)"}`);

  // Apply fog half-plane perpendicular bisector between start and end.
const p0 = latLonToPixel(startP.lat, startP.lon);
  const p1 = latLonToPixel(endP.lat, endP.lon);
  addClue({ type: "thermo", a: p0, b: p1, ok: hotter });

  if (typeof clearThermoRun === "function") clearThermoRun();
  try { if (typeof updateHUD === "function") updateHUD(); } catch(e) {}

  if (typeof showToast === "function") {
    showToast(hotter ? "✅ Hotter — you're closer to the target." : "❌ Colder — you're further from the target.", hotter);
  }
}


function askAxisDirection(axis) {
  if (!ensureReady()) return null;
  if (!player || !target) return null;
const pp = latLonToPixel(player.lat, player.lon);

  let dir = null;
  let label = "";
  if (axis === "NS") {
    if (target.lat > player.lat) { dir = "N"; label = "North"; }
    else if (target.lat < player.lat) { dir = "S"; label = "South"; }
    else { dir = "N"; label = "Exactly level (treating as North)"; }
  } else if (axis === "EW") {
    if (target.lon > player.lon) { dir = "E"; label = "East"; }
    else if (target.lon < player.lon) { dir = "W"; label = "West"; }
    else { dir = "E"; label = "Exactly aligned (treating as East)"; }
  } else {
    return null;
  }

  // Leaflet geometry fog: eliminate the opposite half-plane.
  try { if (typeof addFogDirection === "function") addFogDirection(player.lat, player.lon, dir, true); } catch(e) {}

  // We already know which half contains the target, so apply that half-plane directly.
  addClue({ type: "half", x: pp.x, y: pp.y, dir, ok: true });

  setLast(label.toUpperCase(), true);
  log(`🧭 ${axis === "NS" ? "North/South" : "East/West"} → ${label} (dir=${dir})`);
  return { dir, label, axis };
}
