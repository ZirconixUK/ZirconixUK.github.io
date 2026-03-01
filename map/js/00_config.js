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


