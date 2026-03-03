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
const STREETVIEW_PITCH = 0;
const STREETVIEW_HEADING = null; // null = let Google choose




// ---- Question costs (placeholder; can be individualized later) ----
const QUESTION_TIME_COST_MS = 5 * 60 * 1000; // 5 minutes
const QUESTION_HEAT_COST = 0.5;

// ---- Heat drain (placeholder tuning) ----
// Heat drains continuously over time. Higher heat drains faster than lower heat.
// Rates are in heat-units per second.
const HEAT_DECAY_BASE_PER_SEC = 0.0015;     // base drain even at low heat
const HEAT_DECAY_PER_HEAT_PER_SEC = 0.0025; // extra drain per current heat unit
