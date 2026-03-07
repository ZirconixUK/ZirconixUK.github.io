(function(){
// ---- Leaflet fog-of-war (geometry-based) ----
// Replaces the canvas-mask fog system with Leaflet geometry.
// Key goals:
// - Fog is anchored to the map (no drifting on pan/zoom)
// - Overlaps do NOT get darker (we maintain a single unioned geometry)
// - Expensive geometry ops happen only when a clue is added/cleared (not during pan)
//
// Implementation:
// - Maintain fog geometry in EPSG:3857 projected meters in Martinez format (MultiPolygon).
// - Each radar result adds a fog region (NO => fog inside circle; YES => fog outside circle).
// - Union regions using martinez.union.
// - Render resulting MultiPolygon as a Leaflet polygon (or array of polygons) with a single style.
//
// Dependencies: Leaflet (L) + martinez-polygon-clipping (global `martinez`)

let fogGeom = null;          // Martinez multipolygon geometry (in EPSG3857 meters)
let fogActions = [];        // replayable fog operations for persistence
let fogLayer = null;         // Leaflet layer (L.Polygon or L.LayerGroup)

// Performance: force Canvas renderer for heavy fog polygons (SVG can get very laggy when unioned shapes grow)
let __fogRenderer = null;

// Web Mercator world extents in meters
const WM_MAX = 20037508.342789244;
const WORLD_RING = [
  [-WM_MAX, -WM_MAX],
  [ WM_MAX, -WM_MAX],
  [ WM_MAX,  WM_MAX],
  [-WM_MAX,  WM_MAX],
  [-WM_MAX, -WM_MAX],
];

// Convert Leaflet LatLng to EPSG:3857 meters
function llToM(lat, lon) {
  const p = L.CRS.EPSG3857.project(L.latLng(lat, lon));
  return [p.x, p.y];
}

// Convert EPSG:3857 meters to Leaflet LatLng
function mToLL(x, y) {
  const ll = L.CRS.EPSG3857.unproject(L.point(x, y));
  return [ll.lat, ll.lng];
}

// Simple destination point in lat/lon for circle approximation
const Rm = 6378137;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

function destinationLatLon(lat, lon, bearingDeg, distanceM) {
  const brng = toRad(bearingDeg);
  const δ = distanceM / Rm;
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(brng);
  const φ2 = Math.asin(sinφ2);

  const y = Math.sin(brng) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2);
  const λ2 = λ1 + Math.atan2(y, x);

  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

// Build a circle polygon ring (closed) around a center in EPSG:3857 meters.
function circleRingMeters(lat, lon, radiusM, points = 48) {
  const ring = [];
  for (let i = 0; i <= points; i++) {
    const bearing = (i / points) * 360;
    const d = destinationLatLon(lat, lon, bearing, radiusM);
    ring.push(llToM(d.lat, d.lon));
  }
  return ring;
}

// Wrap polygon rings into Martinez MultiPolygon format
// MultiPolygon => [ Polygon, Polygon, ... ]
// Polygon => [ outerRing, holeRing1, ... ]
function asMultiPolygon(poly) {
  // poly might already be a MultiPolygon (array of polygons) or a Polygon (array of rings)
  if (!poly) return null;
  // If it looks like MultiPolygon (first element is Polygon => array of rings => array of points)
  if (Array.isArray(poly[0]) && Array.isArray(poly[0][0]) && Array.isArray(poly[0][0][0])) return poly;
  // If it looks like Polygon (array of rings)
  if (Array.isArray(poly[0]) && Array.isArray(poly[0][0]) && typeof poly[0][0][0] === "number") return [poly];
  return null;
}

// Union helper (keeps fogGeom as MultiPolygon)
function unionIntoFog(addGeom) {
  const a = asMultiPolygon(fogGeom) || null;
  const b = asMultiPolygon(addGeom) || null;

  if (!b) return;
  if (!a) {
    fogGeom = b;
    return;
  }

  try {
    const u = martinez.union(a, b);
    fogGeom = asMultiPolygon(u) || null;
  } catch (e) {
    console.error("Fog union error", e);
    // Fail safe: keep existing fog
  }
}

function ensureFogLayer() {
  if (!window.leafletMap) return false;
  if (fogLayer) return true;

  // Use a LayerGroup so we can replace polygons cleanly
  try { __fogRenderer = __fogRenderer || L.canvas({ padding: 0.5 }); } catch(e) { __fogRenderer = null; }

  fogLayer = L.layerGroup().addTo(window.leafletMap);
  return true;
}

function clearFogLayer() {
  if (fogLayer) fogLayer.clearLayers();
}

// Render fogGeom into Leaflet layers.
// We render each polygon separately, but because fogGeom is unioned, polygons don't overlap => no darker regions.
function renderFog() {
  if (!ensureFogLayer()) return;

  clearFogLayer();

  const a = (typeof fogAlpha === "function") ? fogAlpha() : 0.35;
  if (!fogGeom || !Array.isArray(fogGeom) || fogGeom.length === 0 || a <= 0) return;

  const opts = {
    stroke: false,
    fill: true,
    // Grey fog (Leaflet defaults to blue if fillColor not specified)
    fillColor: "#2f343a",
    fillOpacity: a,
    interactive: false,
    renderer: (__fogRenderer || undefined),
  };

  for (const poly of fogGeom) {
    if (!poly || poly.length === 0) continue;

    // Convert rings -> LatLng arrays
    const ringsLL = poly.map((ring) => ring.map(([x, y]) => mToLL(x, y)));
    L.polygon(ringsLL, opts).addTo(fogLayer);
  }
}

// Public: add radar fog.
// ok=true means player IS within radius => fog outside circle.
// ok=false means player NOT within radius => fog inside circle.
function addFogRadar(lat, lon, radiusM, ok, opts) {
  if (!window.leafletMap) return;
  if (!window.martinez) {
    console.error("martinez library not loaded; fog union not available.");
    return;
  }

  const circle = circleRingMeters(lat, lon, radiusM, 48);

  // Record for persistence (unless replay)
  if (!(opts && opts._replay)) recordAction({ type: 'radar', lat, lon, radiusM, ok });

  let addGeom;
  if (ok) {
    // Fog outside circle: world rect with circular hole
    addGeom = [[ WORLD_RING, circle ]];
  } else {
    // Fog inside circle: just the circle polygon
    addGeom = [[ circle ]];
  }

  unionIntoFog(addGeom);
  renderFog();
}

// Public: clear fog (called when resetting clues / picking new target etc)

// ---- Persistence helpers ----
function recordAction(action) {
  fogActions.push(action);
  try { if (typeof saveRoundState === "function") saveRoundState(); } catch(e) {}
}

function getFogActions() {
  return Array.isArray(fogActions) ? fogActions : [];
}

function setFogActions(actions) {
  fogActions = Array.isArray(actions) ? actions : [];
}

function rebuildFogFromActions(actions) {
  setFogActions(actions || []);
  fogGeom = null;
  renderFog(); // clear
  for (const a of fogActions) {
    if (!a || !a.type) continue;
    try {
      if (a.type === "radar") addFogRadar(a.lat, a.lon, a.radiusM, a.ok, { _replay: true });
      else if (a.type === "dir") addFogDirection(a.lat, a.lon, a.dir, a.ok, { _replay: true });
      else if (a.type === "quad") addFogQuadrant(a.lat, a.lon, a.quad, { _replay: true });
      else if (a.type === "bearing") addFogBearingWedge(a.lat, a.lon, a.startDeg, a.endDeg, { _replay: true });
      else if (a.type === "dist") addFogDistanceBucket(a.lat, a.lon, a.minM, a.maxM, a.ok, { _replay: true });
      else if (a.type === "thermo") addFogThermometer(a.lat0, a.lon0, a.lat1, a.lon1, a.hotter, { _replay: true });
      else if (a.type === "nearest_station") addFogNearestStation(a.key, a.ok, { _replay: true });
      else if (a.type === "nearest_landmark") addFogNearestLandmark(a.kind, a.key, a.ok, { _replay: true });
    } catch(e) {}
  }
}
function clearFog() {
  fogGeom = null;
  fogActions = [];
  renderFog();
  try { if (typeof saveRoundState === 'function') saveRoundState(); } catch(e) {}
}

// Public: when opacity changes
function updateFogStyle() {
  renderFog();
}

// Expose globally

// ---- Half-plane clipping (Sutherland–Hodgman) in EPSG:3857 meters ----
function dot(a, b) { return a[0]*b[0] + a[1]*b[1]; }

function clipRingHalfPlane(ring, n, c, keepGreater=true) {
  if (!ring || ring.length < 3) return [];
  const out = [];
  const inside = (p) => keepGreater ? (dot(n,p) >= c) : (dot(n,p) <= c);

  for (let i=0; i<ring.length-1; i++) {
    const a = ring[i];
    const b = ring[i+1];
    const aIn = inside(a);
    const bIn = inside(b);

    if (aIn && bIn) {
      out.push(b);
    } else if (aIn && !bIn) {
      const ab = [b[0]-a[0], b[1]-a[1]];
      const denom = dot(n, ab);
      if (denom !== 0) {
        const t = (c - dot(n,a)) / denom;
        out.push([a[0] + t*ab[0], a[1] + t*ab[1]]);
      }
    } else if (!aIn && bIn) {
      const ab = [b[0]-a[0], b[1]-a[1]];
      const denom = dot(n, ab);
      if (denom !== 0) {
        const t = (c - dot(n,a)) / denom;
        out.push([a[0] + t*ab[0], a[1] + t*ab[1]]);
      }
      out.push(b);
    }
  }

  if (out.length === 0) return [];
  const first = out[0];
  const last = out[out.length-1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  return out;
}

function clipPolyHalfPlane(polyRing, n, c, keepGreater=true) {
  const ring = polyRing.slice();
  const f = ring[0], l = ring[ring.length-1];
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
  return clipRingHalfPlane(ring, n, c, keepGreater);
}

function worldPoly() { return WORLD_RING.slice(); }

function fogHalfPlane(n, c, keepGreater=true) {
  const ring = clipPolyHalfPlane(worldPoly(), n, c, keepGreater);
  if (!ring || ring.length < 4) return null;
  return [[ ring ]];
}

function addFogDirection(lat, lon, dir, ok, opts) {
  if (!window.leafletMap || !window.martinez) return;
  if (!(opts && opts._replay)) recordAction({ type:'dir', lat, lon, dir, ok });
  const p = llToM(lat, lon);
  const x0 = p[0], y0 = p[1];

  let eliminateDir = dir;
  if (ok) {
    if (dir === "N") eliminateDir = "S";
    else if (dir === "S") eliminateDir = "N";
    else if (dir === "E") eliminateDir = "W";
    else if (dir === "W") eliminateDir = "E";
  }

  let geom = null;
  if (eliminateDir === "N") geom = fogHalfPlane([0, 1], y0, true);
  if (eliminateDir === "S") geom = fogHalfPlane([0, 1], y0, false);
  if (eliminateDir === "E") geom = fogHalfPlane([1, 0], x0, true);
  if (eliminateDir === "W") geom = fogHalfPlane([1, 0], x0, false);

  unionIntoFog(geom);
  renderFog();
}

function addFogQuadrant(lat, lon, quad, opts) {
  if (!window.leafletMap || !window.martinez) return;
  if (!(opts && opts._replay)) recordAction({ type:'quad', lat, lon, quad });
  const p = llToM(lat, lon);
  const x0 = p[0], y0 = p[1];

  let ring = worldPoly();
  if (quad.includes("N")) ring = clipPolyHalfPlane(ring, [0,1], y0, true);
  else ring = clipPolyHalfPlane(ring, [0,1], y0, false);
  if (quad.includes("E")) ring = clipPolyHalfPlane(ring, [1,0], x0, true);
  else ring = clipPolyHalfPlane(ring, [1,0], x0, false);

  if (!ring || ring.length < 4) return;
  const geom = [[ WORLD_RING, ring ]];
  unionIntoFog(geom);
  renderFog();
}

function addFogBearingWedge(lat, lon, startDeg, endDeg, opts) {
  if (!window.leafletMap || !window.martinez) return;
  if (!(opts && opts._replay)) recordAction({ type:'bearing', lat, lon, startDeg, endDeg });

  const center = llToM(lat, lon);
  const FAR = 50000;
  const a = destinationLatLon(lat, lon, startDeg, FAR);
  const b = destinationLatLon(lat, lon, endDeg, FAR);
  const pa = llToM(a.lat, a.lon);
  const pb = llToM(b.lat, b.lon);

  const wedge = [ center, pa, pb, center ];
  const geom = [[ WORLD_RING, wedge ]];
  unionIntoFog(geom);
  renderFog();
}

function addFogDistanceBucket(lat, lon, minM, maxM, ok, opts) {
  if (!window.leafletMap || !window.martinez) return;
  if (!(opts && opts._replay)) recordAction({ type:'dist', lat, lon, minM, maxM, ok });

  const outerM = (maxM === Infinity) ? 150000 : maxM;
  const outer = circleRingMeters(lat, lon, outerM, 64);

  if (ok) {
    if (minM > 0) {
      const inner = circleRingMeters(lat, lon, minM, 64);
      unionIntoFog([[ inner ]]);
    }
    unionIntoFog([[ WORLD_RING, outer ]]);
  } else {
    if (minM > 0) {
      const inner = circleRingMeters(lat, lon, minM, 64);
      unionIntoFog([[ outer, inner ]]);
    } else {
      unionIntoFog([[ outer ]]);
    }
  }

  renderFog();
}

function addFogThermometer(lat0, lon0, lat1, lon1, hotter, opts) {
  if (!window.leafletMap || !window.martinez) return;
  if (!(opts && opts._replay)) recordAction({ type:'thermo', lat0, lon0, lat1, lon1, hotter });

  const A = llToM(lat0, lon0);
  const B = llToM(lat1, lon1);

  const v = [B[0] - A[0], B[1] - A[1]];
  const vLen2 = v[0]*v[0] + v[1]*v[1];
  if (vLen2 < 1e-6) {
    // Baseline and current are effectively the same point; no useful constraint.
    return;
  }

  // Bisector equation: X·v = (|B|^2 - |A|^2)/2
  const c = (dot(B, B) - dot(A, A)) / 2;

  // f(X) = X·v - c. Points with f(X) having same sign as f(B) are closer to B; opposite sign closer to A.
  const sB = dot(B, v) - c;

  // Allowed side:
  // - HOTTER => closer to B
  // - COLDER => closer to A
  // If sB >= 0, "closer to B" corresponds to f(X) >= 0; else it corresponds to f(X) <= 0.
  const closerToBIsGreater = (sB >= 0);
  const allowedGreater = hotter ? closerToBIsGreater : !closerToBIsGreater;

  // Fog eliminates the opposite of allowed
  const fogKeepGreater = !allowedGreater;

  const geom = fogHalfPlane(v, c, fogKeepGreater);
  unionIntoFog(geom);
  renderFog();
}

// ---- Nearest-train-station Voronoi constraint ----
// ok=true  => eliminate everything NOT in the chosen station's Voronoi cell (fog outside cell).
// ok=false => eliminate the chosen station's Voronoi cell (fog inside cell).
function addFogNearestStation(key, ok, opts) {
  if (!window.leafletMap || !window.martinez) return;
  if (!key) return;

  if (!(opts && opts._replay)) recordAction({ type:'nearest_station', key: String(key), ok: !!ok });

  const stations = (Array.isArray(window.POIS) ? window.POIS : []).filter(p => {
    const t = p && p.osm_tags;
    return t && String(t.railway || '').toLowerCase() === 'station';
  });
  if (!stations.length) return;

  const k = String(key);
  const getKey = (p) => String((p && (p.id || p.name)) || '');
  const chosen = stations.find(s => getKey(s) === k);
  if (!chosen) return;

  const A = llToM(chosen.lat, chosen.lon);
  let ring = worldPoly();

  for (const s of stations) {
    if (!s) continue;
    if (getKey(s) === k) continue;

    const B = llToM(s.lat, s.lon);
    const v = [B[0] - A[0], B[1] - A[1]];
    const vLen2 = v[0]*v[0] + v[1]*v[1];
    if (vLen2 < 1e-6) continue;

    const c = (dot(B, B) - dot(A, A)) / 2;
    // Keep the half-plane where points are closer to A than B.
    // For v = (B-A): closer-to-A condition is dot(v, P) <= c where c = (||B||^2 - ||A||^2)/2
    ring = clipPolyHalfPlane(ring, v, c, false);
    if (!ring || ring.length < 4) return;
  }

  const cell = ring;
  // Build fog geometry robustly using martinez.diff rather than relying on hole ring winding.
  let geom = null;
  if (ok) {
    try {
      // Fog outside cell = WORLD ∖ cell
      geom = martinez.diff([[ WORLD_RING ]], [[ cell ]]);
    } catch (e) {
      console.error('Fog diff error', e);
      // Fallback to hole-based geometry
      geom = [[ WORLD_RING, cell ]];
    }
  } else {
    // Fog inside cell
    geom = [[ cell ]];
  }

  unionIntoFog(geom);
  renderFog();
}



function addFogNearestLandmark(kind, key, ok, opts) {
  if (!window.leafletMap || !window.martinez) return;
  if (!kind || !key) return;

  if (!(opts && opts._replay)) recordAction({ type:'nearest_landmark', kind: String(kind), key: String(key), ok: !!ok });

  const knd = String(kind).toLowerCase();
  const pois = (Array.isArray(window.POIS) ? window.POIS : []);

  const getTag = (p, k) => (p && p.osm_tags) ? String(p.osm_tags[k] || '').toLowerCase() : '';
  const filtered = pois.filter(p => {
    if (!p) return false;
    if (knd === 'train_station') return getTag(p, 'railway') === 'station';
    if (knd === 'cathedral') return getTag(p, 'building') === 'cathedral';
    if (knd === 'bus_station') return getTag(p, 'amenity') === 'bus_station';
    if (knd === 'library') return getTag(p, 'amenity') === 'library';
    if (knd === 'museum') return getTag(p, 'tourism') === 'museum';
    return false;
  });

  if (!filtered.length) return;

  const getKey = (p) => String((p && (p.id || p.name)) || '');
  const chosen = filtered.find(p => getKey(p) === String(key));
  if (!chosen) return;

  const A = llToM(chosen.lat, chosen.lon);
  let ring = worldPoly();

  for (const p of filtered) {
    if (!p) continue;
    if (getKey(p) === String(key)) continue;

    const B = llToM(p.lat, p.lon);
    const v = [B[0] - A[0], B[1] - A[1]];
    const vLen2 = v[0]*v[0] + v[1]*v[1];
    if (vLen2 < 1e-6) continue;

    const c = (dot(B, B) - dot(A, A)) / 2;
    ring = clipPolyHalfPlane(ring, v, c, false);
    if (!ring || ring.length < 4) return;
  }

  const cell = ring;
  let geom = null;
  if (ok) {
    try {
      geom = martinez.diff([[ WORLD_RING ]], [[ cell ]]);
    } catch (e) {
      console.error('Fog diff error', e);
      geom = [[ WORLD_RING, cell ]];
    }
  } else {
    geom = [[ cell ]];
  }

  unionIntoFog(geom);
  renderFog();
}

window.addFogDirection = addFogDirection;
window.addFogQuadrant = addFogQuadrant;
window.addFogBearingWedge = addFogBearingWedge;
window.addFogDistanceBucket = addFogDistanceBucket;
window.addFogThermometer = addFogThermometer;
window.addFogNearestStation = addFogNearestStation;
window.addFogNearestLandmark = addFogNearestLandmark;
window.addFogRadar = addFogRadar;
window.clearFog = clearFog;
window.updateFogStyle = updateFogStyle;
window.getFogActions = getFogActions;
window.rebuildFogFromActions = rebuildFogFromActions;


})();
