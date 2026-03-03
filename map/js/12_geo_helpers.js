// ---- Geo helpers ----
const Rm = 6378137;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

// Existing code calls: haversineMeters(lat1, lon1, lat2, lon2)
function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  return 2 * Rm * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Destination point (bearing+distance) on a sphere (good enough for our small radii)
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

// Leaflet-based projection into our fixed fog-world pixel space (FOG_ZF).
// Returns {x,y} relative to FOG_TL (top-left global pixel at FOG_ZF).
function latLonToPixel(lat, lon) {
  if (window.leafletMap && window.FOG_TL && typeof window.FOG_ZF === "number") {
    const p = window.leafletMap.project(L.latLng(lat, lon), window.FOG_ZF);
    return { x: p.x - window.FOG_TL.x, y: p.y - window.FOG_TL.y };
  }
  // Fallback (should not be used in Leaflet mode)
  return { x: 0, y: 0 };
}

function pixelToLatLon(x, y) {
  if (window.leafletMap && window.FOG_TL && typeof window.FOG_ZF === "number") {
    const g = L.point(x + window.FOG_TL.x, y + window.FOG_TL.y);
    const ll = window.leafletMap.unproject(g, window.FOG_ZF);
    return { lat: ll.lat, lon: ll.lng };
  }
  return { lat: 0, lon: 0 };
}

// Convert a radius in meters around a given lat/lon into fog-world pixels at FOG_ZF.
function radiusMetersToPixels(meters, lat, lon) {
  if (window.leafletMap && window.FOG_TL && typeof window.FOG_ZF === "number") {
    const a = window.leafletMap.project(L.latLng(lat, lon), window.FOG_ZF);
    const dest = destinationLatLon(lat, lon, 0, meters);
    const b = window.leafletMap.project(L.latLng(dest.lat, dest.lon), window.FOG_ZF);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  return meters;
}
