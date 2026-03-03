// ---- Clues / Questions ----
function ensureReady() {
  if (!player) { log("⚠️ Tap “Enable location” first."); return false; }
  if (!target) pickNewTarget(false);
  return true;
}

function pickNewTarget(verbose = true) {
  targetIdx = Math.floor(Math.random() * POIS.length);
  target = POIS[targetIdx];
  // New target => clear overlay history
  try { if (typeof clearClues === 'function') clearClues(); } catch(e) {}
  try { if (typeof clearFog === 'function') clearFog(); } catch(e) {}
  try { if (typeof clearStreetViewGlimpseCache === 'function') clearStreetViewGlimpseCache(); } catch(e) {}
  // New round starts whenever a new target is chosen.
  try { resetRound({ keepTarget: true }); } catch(e) {}
  try { saveRoundState(); } catch(e) {}
  try { if (typeof syncLeafletTargetMarker === 'function') syncLeafletTargetMarker(); } catch(e) {}
  if (verbose) {
    if (debugMode && target) {
      log(`🎯 New target: ${target.name ?? "Unnamed"} (${target.lat.toFixed(6)}, ${target.lon.toFixed(6)})`);
    } else {
      log(`🎯 New target chosen (hidden).`);
    }
  }
  updateUI();
  try { if (typeof updateHUD === "function") updateHUD(); } catch(e) {}
  draw();
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
  log(`⬆️ ${axis === "NS" ? "North/South" : "East/West"} → ${label} (dir=${dir})`);
  return { dir, label, axis };
}
