// ---- Geo helpers ----
const Rm = 6378137;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

function mercatorXY(lat, lon) {
  const x = Rm * toRad(lon);
  const y = Rm * Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2));
  return { x, y };
}

function latLonToPixel(lat, lon, bbox, w, h) {
  const nw = mercatorXY(bbox.nw.lat, bbox.nw.lon);
  const se = mercatorXY(bbox.se.lat, bbox.se.lon);
  const p  = mercatorXY(lat, lon);
  return {
    x: ((p.x - nw.x) / (se.x - nw.x)) * w,
    y: ((p.y - nw.y) / (se.y - nw.y)) * h
  };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radiusMetersToPixels(radiusM, atLat, bbox, w, h) {
  const nw = mercatorXY(bbox.nw.lat, bbox.nw.lon);
  const se = mercatorXY(bbox.se.lat, bbox.se.lon);
  const mppX = (se.x - nw.x) / w;
  const mppY = (se.y - nw.y) / h;
  const mpp = (Math.abs(mppX) + Math.abs(mppY)) / 2;
  const scale = 1 / Math.cos(toRad(atLat));
  return (radiusM * scale) / mpp;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function midpoint(a, b) { return { x: (a.x + b.x)/2, y: (a.y + b.y)/2 }; }
