/**
 * Mobile-ready map pane (pan + pinch zoom) + simple clue fog
 * - No "tap to set location" (tap/drag is only for panning)
 * - Uses Geolocation (watchPosition) when permission granted
 * - Static map.png as world; overlays are computed in map pixel coords and
 *   transformed along with the map.
 */

// ---- Config ----
const BBOX = {
  nw: { lat: 53.414443210551035, lon: -3.0047607421875 },
  se: { lat: 53.389880751560305, lon: -2.95806884765625 },
};

// ---- Optional: Google Street View Static API ----
// Used by the Photo → Glimpse tool. Leave blank to disable.
// Create a browser-restricted key and enable "Street View Static API".
const GOOGLE_STREETVIEW_API_KEY = "AIzaSyDXvuatJSnLxTIZXcdALlQB2x6T7w_ecbE";
const STREETVIEW_SIZE = "640x640";
const STREETVIEW_FOV = 90;
// Smaller FOV = more zoomed/cropped. Snapshot is the core clue, so we keep it tighter.
const STREETVIEW_SNAPSHOT_FOV = 70;

// Curated snapshot parameter presets (optional). Picked randomly per round and then persisted.
// Keep this small to avoid wildly unfair snapshots.
// Starter snapshot tuning:
// - Slightly zoomed (lower FOV) so it's less "obvious"
// - Slightly downward pitch so we see more near-context (but not pure tarmac)

// ---- Phase 5: Echo Snapshots ----
// Buy extra angles by sampling a ring around the target pano and snapping to the nearest pano.
const ECHO_SNAPSHOT_INNER_M = 150;
const ECHO_SNAPSHOT_OUTER_M = 300;
const ECHO_SNAPSHOT_MAX_ATTEMPTS = 22;
const ECHO_SNAPSHOT_MIN_SEPARATION_M = 25; // reject if too close to an existing returned pano

const STREETVIEW_SNAPSHOT_PRESETS = [
  { fov: 45, pitch: -20 },
  { fov: 55, pitch: -18 },
  { fov: 60, pitch: -24 },
];
const STREETVIEW_PITCH = 0;
const STREETVIEW_HEADING = null; // null = let Google choose

// ---- Street View pano targets (Phase 1) ----
// When enabled, new targets are chosen as snapped Street View pano locations
// (via the Street View Metadata endpoint), and the round starts by showing
// a "Circle Snapshot" from that pano.
const USE_STREETVIEW_PANO_TARGETS = true;
const STREETVIEW_METADATA_RADIUS_M = 200;
const STREETVIEW_TARGET_MAX_ATTEMPTS = 25;

// ---- Phase 6: Distance-biased target picking ----
// We bias targets by distance from the round start (startLatLng).
// Probabilities:
// - 10%: > 2km
// - 60%: 0..1km
// - 30%: 1..2km
// (Matches your intent of 10% far, and the remainder split ~2/3 close, ~1/3 mid.)
const TARGET_BAND_PROB_FAR_GT_2KM = 0.10;
const TARGET_BAND_PROB_CLOSE_LE_1KM = 0.60;
const TARGET_BAND_PROB_MID_1_TO_2KM = 0.30;

const TARGET_BAND_CLOSE_MAX_M = 1000;
const TARGET_BAND_MID_MIN_M = 1000;
const TARGET_BAND_MID_MAX_M = 2000;
const TARGET_BAND_FAR_MIN_M = 2000;

// ---- Phase 2: Scoring + grading ----
// Distance is computed to the target pano location.
// Adjusted distance can optionally subtract GPS accuracy to be fair.
const USE_ACCURACY_ADJUSTED_DISTANCE = true;

// Grade thresholds in meters (applied to adjusted distance if enabled).
// Tune these to taste; defaults are "GeoGuessr-ish" for city-centre play.
const GRADE_THRESHOLDS_M = [
  { label: 'S', max: 25 },
  { label: 'A', max: 75 },
  { label: 'B', max: 150 },
  { label: 'C', max: 300 },
  { label: 'D', max: 600 },
  { label: 'F', max: Infinity },
];

// Points: a smooth-ish curve. 5,000 at 0m → ~0 by ~2,000m.
const SCORE_MAX_POINTS = 5000;
const SCORE_ZERO_AT_M = 2000;

// Visual "corruption" overlay for the snapshot (CSS-only, no pixel access).
// 0..1 (higher = more glitch blocks)
const STREETVIEW_CORRUPTION_ENABLED = true;
const STREETVIEW_CORRUPTION_INTENSITY_SNAPSHOT = 0.85;
const STREETVIEW_CORRUPTION_INTENSITY_GLIMPSE = 0.60;


// ---- Phase 3: Movement loop + economy (coins) ----
// Coins are earned purely from distance walked. (Anti-cheese rules intentionally omitted for now.)
// 1 coin per 200m walked, continuous accumulation.
const COIN_EARN_METERS = 200;
// Starting coins per new round so the player isn't dead on arrival.
const COIN_START_STIPEND = 3;

// Debug-friendly default spawn for new rounds (outside Lime Street Station).
// Used when debug mode is ON, or when there is no player location yet.
const DEFAULT_START_LATLNG = { lat: 53.40744, lon: -2.97785 };




// ---- Question costs (placeholder; can be individualized later) ----
const QUESTION_TIME_COST_MS = 5 * 60 * 1000; // 5 minutes
const QUESTION_HEAT_COST = 0.5;

// ---- Heat drain (placeholder tuning) ----
// Heat drains continuously over time. Higher heat drains faster than lower heat.
// Rates are in heat-units per second.
const HEAT_DECAY_BASE_PER_SEC = 0.0015;     // base drain even at low heat
const HEAT_DECAY_PER_HEAT_PER_SEC = 0.0025; // extra drain per current heat unit
