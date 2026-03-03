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

const STORAGE_KEY = "mapgame_round_v1";

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function saveRoundState() {
  try {
    const payload = {
      debugMode,
      playerSaved: (player && player.manualOverride) ? { lat: player.lat, lon: player.lon } : null,
      targetIdx,
      roundStartMs,
      penaltyMs,
      heatValue,
      heatLevel,
      heatLastMs,
      thermoRun,
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
  if (!keepTarget) targetIdx = null;
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

function setHeatValue(v) {
  const next = parseFloat(v);
  const prevLevel = heatLevel | 0;
  heatValue = Math.max(0, Math.min(5, isFinite(next) ? next : 0));
  __recomputeHeatLevelFromValue();
  const newLevel = heatLevel | 0;
  if (newLevel !== prevLevel) {
    try { if (typeof onHeatLevelChanged === 'function') onHeatLevelChanged(prevLevel, newLevel, 'set'); } catch (e) {}
  }
  heatLastMs = Date.now();
  saveRoundState();
  try { if (typeof updateHUD === "function") updateHUD(); } catch (e) {}
}

function addHeat(delta) {
  const d = parseFloat(delta);
  const hv = (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : 0;
  setHeatValue(hv + (isFinite(d) ? d : 0));
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
      try { if (typeof onHeatLevelChanged === 'function') onHeatLevelChanged(prevLevel, newLevel, 'decay'); } catch (e) {}
    }

    // Throttle saves so we don't spam localStorage every tick
    if (!__lastHeatSaveMs || (now - __lastHeatSaveMs) > 2000 || next === 0) {
      __lastHeatSaveMs = now;
      saveRoundState();
    }
  }
}

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
  const v = parseFloat(elFogOpacity?.value ?? "0.55");
  return Math.max(0, Math.min(0.95, isNaN(v) ? 0.55 : v));
}
function updateFogUI() {
  if (elFogOpacityOut) elFogOpacityOut.textContent = `${Math.round(fogAlpha() * 100)}%`;
}
