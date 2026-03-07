// ---- State ----
let debugMode = false;
let geoWatchId = null;
let player = null;  // {lat, lon}
let target = null;  // {name, lat, lon}
const clues = [];   // constraints to intersect
let thermoBaseline = null;

// Timed thermometer run (persisted)
let thermoRun = null; // { startMs, durationMs, startPlayer:{lat,lon} }


// ---- Round / HUD state (persisted) ----
let roundStartMs = null;     // timestamp in ms
let penaltyMs = 0;           // ms
// Heat is stored as a continuous value (heatValue) for decay + UI fill,
// but the *heat level* (heatLevel) has hysteresis so it doesn't instantly
// drop the moment you cross an integer threshold.
//
// Rule:
// - Heat level increases when heatValue >= (level+1)
// - Heat level decreases when heatValue <= (level-1)
//   (i.e. level 3 persists until heatValue cools to 2.0)
let heatValue = 0;           // 0..5 (continuous)
let heatLevel = 0;           // 0..5 (integer with hysteresis)
let heatLastMs = Date.now();  // for heat decay timing
let __lastHeatSaveMs = 0;     // throttle saves from decay
let targetIdx = null;        // index into POIS
// Non-POI targets (e.g. Street View pano targets)
let targetCustom = null;      // { kind, lat, lon, pano_id?, name?, id? }

// ---- Phase 1: RoundState v1 (photo-first hunt) ----
// This is a slim, game-design-facing state model used by the roadmap.
// We keep it alongside the existing state fields for now.
function __defaultRoundStateV1(){
  return {
    startLatLng: null,          // {lat, lon} captured when the round starts
    targetPanoLatLng: null,     // {lat, lon} for pano targets (null for POI targets)
    panoId: null,               // Street View pano_id when available
    starterPhotoUrl: null,      // data: URL (preferred) or Street View URL fallback
    photos: [],                 // [{ kind:'starter'|'near100'|'near200', context, url, sourceUrl, panoId, lat, lon, heading, pitch, fov, ts }]
    photosUncorrupted: false,  // When true, all photos display without blur/glitch
    // Phase 2 (win condition)
    hasGuessed: false,
    guessLatLng: null,          // {lat, lon}
    guessGpsAccuracyM: null,    // meters
    guessTimestamp: null,
    distanceToTargetM: null,    // raw
    adjustedDistanceM: null,    // max(0, d - accuracy)
    scorePoints: null,
    gradeLabel: null,
  };
}

let roundStateV1 = __defaultRoundStateV1();

// Short anti-repeat memory for pano targets
let recentPanoKeys = []; // array of strings
const RECENT_PANO_MAX = 8;

function __panoKey(panoId, lat, lon){
  if (panoId) return `panoid:${String(panoId)}`;
  const la = (typeof lat === 'number' && isFinite(lat)) ? lat.toFixed(6) : '';
  const lo = (typeof lon === 'number' && isFinite(lon)) ? lon.toFixed(6) : '';
  return `latlon:${la},${lo}`;
}

window.getRoundStateV1 = () => roundStateV1;
window.__defaultRoundStateV1 = __defaultRoundStateV1;

window.__arePhotosUncorrupted = () => {
  try { return !!(roundStateV1 && roundStateV1.photosUncorrupted); } catch(e) { return false; }
};

window.__setPhotosUncorrupted = (v) => {
  try {
    roundStateV1.photosUncorrupted = !!v;
    saveRoundState();
  } catch(e) {}
};


window.__isPanoRecentlyUsed = (panoId, lat, lon) => {
  const k = __panoKey(panoId, lat, lon);
  return !!(k && recentPanoKeys && recentPanoKeys.indexOf(k) !== -1);
};

window.__rememberPanoUsed = (panoId, lat, lon) => {
  const k = __panoKey(panoId, lat, lon);
  if (!k) return;
  // Move-to-front de-dupe
  recentPanoKeys = (recentPanoKeys || []).filter(x => x !== k);
  recentPanoKeys.unshift(k);
  if (recentPanoKeys.length > RECENT_PANO_MAX) recentPanoKeys.length = RECENT_PANO_MAX;
  try { saveRoundState(); } catch(e) {}
};

window.__initRoundStateV1ForNewTarget = (startLatLng, tgt) => {
  const s = (startLatLng && typeof startLatLng.lat === 'number' && typeof startLatLng.lon === 'number') ? { lat: startLatLng.lat, lon: startLatLng.lon } : null;
  const isPano = !!(tgt && tgt.kind === 'pano');
  roundStateV1 = {
    ...__defaultRoundStateV1(),
    startLatLng: s,
    targetPanoLatLng: isPano ? { lat: tgt.lat, lon: tgt.lon } : null,
    panoId: isPano ? (tgt.pano_id || null) : null,
  };
  // Phase 3: start stipend + reset movement coin progress for the new round.
  try {
    if (window.__coins && typeof window.__coins.initCoinsForNewRound === 'function') {
      window.__coins.initCoinsForNewRound(s);
    }
  } catch(e) {}
  try { saveRoundState(); } catch(e) {}
};

window.__onStreetViewPhotoCaptured = (info) => {
  try {
    const o = (info && typeof info === 'object') ? info : {};
    const ctx = (o.context || o.kind || 'glimpse');
    const url = o.url || null;
    if (!url) return;

    const entry = {
      kind: (ctx === 'snapshot') ? 'starter' : (o.kind || (ctx === 'near100' ? 'near100' : (ctx === 'near200' ? 'near200' : 'near100'))),
      context: ctx,
      url,
      sourceUrl: o.sourceUrl || null,
      panoId: o.panoId || null,
      lat: (typeof o.lat === 'number' && isFinite(o.lat)) ? o.lat : null,
      lon: (typeof o.lon === 'number' && isFinite(o.lon)) ? o.lon : null,
      heading: (typeof o.heading === 'number' && isFinite(o.heading)) ? o.heading : null,
      pitch: (typeof o.pitch === 'number' && isFinite(o.pitch)) ? o.pitch : null,
      fov: (typeof o.fov === 'number' && isFinite(o.fov)) ? o.fov : null,
      ts: Date.now(),
    };

    // Snapshot is the starter photo and should be stable per round.
    if (ctx === 'snapshot') {
      roundStateV1.starterPhotoUrl = url;
      // Ensure snapshot is the first item in photos[] (replace any existing starter).
      roundStateV1.photos = (roundStateV1.photos || []).filter(p => p && p.kind !== 'starter');
      roundStateV1.photos.unshift(entry);
    } else {
      roundStateV1.photos = (roundStateV1.photos || []);
      roundStateV1.photos.push(entry);
    }

    // Keep panoId in sync when available
    if (!roundStateV1.panoId && entry.panoId) roundStateV1.panoId = entry.panoId;

    saveRoundState();
  } catch(e) {}
};

const STORAGE_KEY = "mapgame_round_v1";

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function saveRoundState() {
  try {
    // Persist non-POI targets explicitly so refresh keeps the same hunt.
    const custom = (target && target.kind === 'pano') ? {
      kind: 'pano',
      id: target.id || null,
      name: target.name || null,
      lat: target.lat,
      lon: target.lon,
      pano_id: target.pano_id || null,
      debug_label: target.debug_label || null,
      snapshot_heading: (target.snapshot_heading !== undefined) ? target.snapshot_heading : null,
      snapshot_params: (target.snapshot_params !== undefined) ? target.snapshot_params : null,
    } : (targetCustom && targetCustom.kind ? { ...targetCustom } : null);

    const payload = {
      debugMode,
      playerSaved: (player && player.manualOverride) ? { lat: player.lat, lon: player.lon } : null,
      targetIdx,
      targetCustom: custom,
      roundStartMs,
      penaltyMs,
      heatValue,
      heatLevel,
      heatLastMs,
      coinsState: (window.__coins && typeof window.__coins.__getState === 'function') ? window.__coins.__getState() : null,
      activeCurses: (typeof window.__getCursesStateForSave === 'function') ? window.__getCursesStateForSave() : null,
      thermoRun,
      roundStateV1,
      recentPanoKeys,
      fogActions: (typeof getFogActions === 'function') ? getFogActions() : null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // ignore (private mode / storage blocked)
  }
}

function loadRoundState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return safeParseJSON(raw);
  } catch (e) {
    return null;
  }
}

function resetRound({ keepTarget = false } = {}) {
  roundStartMs = Date.now();
  penaltyMs = 0;
  heatValue = 0;
  heatLevel = 0;
  heatLastMs = Date.now();
  __lastHeatSaveMs = 0;
  thermoRun = null;
  if (!keepTarget) {
    targetIdx = null;
    targetCustom = null;
  }
  saveRoundState();
  try { if (typeof updateHUD === "function") updateHUD(); } catch (e) {}
}

function setPenaltyMs(ms) {
  penaltyMs = Math.max(0, ms | 0);
  saveRoundState();
  try { if (typeof updateHUD === "function") updateHUD(); } catch (e) {}
}

function addPenaltyMs(ms) {
  setPenaltyMs(penaltyMs + (ms | 0));
}

function __recomputeHeatLevelFromValue() {
  const EPS = 1e-9;
  // Ensure integers
  heatLevel = Math.max(0, Math.min(5, (heatLevel | 0)));
  heatValue = Math.max(0, Math.min(5, (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : 0));

  // Upward transitions: cross integer boundary
  while (heatLevel < 5 && heatValue + EPS >= (heatLevel + 1)) heatLevel++;
  // Downward transitions: cool to the next threshold (inclusive)
  while (heatLevel > 0 && heatValue - EPS <= (heatLevel - 1)) heatLevel--;
}

function setHeatValue(v, reason = 'set') {
  const next = parseFloat(v);
  const prevLevel = heatLevel | 0;
  heatValue = Math.max(0, Math.min(5, isFinite(next) ? next : 0));
  __recomputeHeatLevelFromValue();
  const newLevel = heatLevel | 0;
  if (newLevel !== prevLevel) {
    // Important: call via window.* so it works even if the handler was assigned as a property.
    try { if (typeof window.onHeatLevelChanged === 'function') window.onHeatLevelChanged(prevLevel, newLevel, reason); } catch (e) {}
  }
  heatLastMs = Date.now();
  saveRoundState();
  try { if (typeof updateHUD === "function") updateHUD(); } catch (e) {}
}

function addHeat(delta) {
  const d = parseFloat(delta);
  const hv = (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : 0;
  setHeatValue(hv + (isFinite(d) ? d : 0), 'add');
}

function applyHeatDecay(nowMs = Date.now()) {
  // Uses elapsed time since last update; higher heat drains faster than lower heat.
  const now = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();
  const last = (typeof heatLastMs === "number" && isFinite(heatLastMs)) ? heatLastMs : now;

  const dtMs = Math.max(0, now - last);
  if (dtMs < 250) return; // avoid micro-updates (HUD ticks at 250ms)

  // If no heat, just advance timestamp.
  const hv = (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : 0;
  heatLastMs = now;
  if (hv <= 0) return;

  const base = (typeof HEAT_DECAY_BASE_PER_SEC === "number" && isFinite(HEAT_DECAY_BASE_PER_SEC)) ? HEAT_DECAY_BASE_PER_SEC : 0.0015;
  const perHeat = (typeof HEAT_DECAY_PER_HEAT_PER_SEC === "number" && isFinite(HEAT_DECAY_PER_HEAT_PER_SEC)) ? HEAT_DECAY_PER_HEAT_PER_SEC : 0.0025;

  const dtSec = dtMs / 1000;
  const rate = base + (perHeat * hv);
  const dec = rate * dtSec;

  if (dec <= 0) return;

  const next = Math.max(0, hv - dec);
  // Only commit if it actually changes enough to matter visually
  if (Math.abs(next - hv) >= 0.001) {
    const prevLevel = heatLevel | 0;
    heatValue = next;
    __recomputeHeatLevelFromValue();
    const newLevel = heatLevel | 0;
    if (newLevel !== prevLevel) {
      try { if (typeof window.onHeatLevelChanged === 'function') window.onHeatLevelChanged(prevLevel, newLevel, 'decay'); } catch (e) {}
    }

    // Throttle saves so we don't spam localStorage every tick
    if (!__lastHeatSaveMs || (now - __lastHeatSaveMs) > 2000 || next === 0) {
      __lastHeatSaveMs = now;
      saveRoundState();
    }
  }
}

// Read-only accessors for other modules
window.getHeatValue = () => heatValue;
window.getHeatLevel = () => heatLevel;

function setThermoRun(run) {
  thermoRun = run;
  saveRoundState();
  try { if (typeof updateHUD === "function") updateHUD(); } catch (e) {}
}
function clearThermoRun() {
  thermoRun = null;
  saveRoundState();
  try { if (typeof updateHUD === "function") updateHUD(); } catch (e) {}
}

function fogAlpha() {
  const slider = (window.elFogOpacity || document.getElementById('fogOpacity'));
  const v = parseFloat(slider?.value ?? "0.55");
  return Math.max(0, Math.min(0.95, isNaN(v) ? 0.55 : v));
}
function updateFogUI() {
  const out = (window.elFogOpacityOut || document.getElementById('fogOpacityOut'));
  if (out) out.textContent = `${Math.round(fogAlpha() * 100)}%`;
}
