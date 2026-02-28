/** Your bbox corners */
const BBOX = {
  nw: { lat: 53.410529518470405, lon: -2.9982161521911626 },
  se: { lat: 53.40140896291161,  lon: -2.971136569976807  },
};

// POIs loaded from ./pois.json (with a built-in fallback so file:// still works).
const DEFAULT_POIS = [
  { name: "Liverpool Lime Street Station", lat: 53.4073, lon: -2.9777 },
  { name: "St George's Hall",             lat: 53.4084, lon: -2.9801 },
  { name: "Royal Albert Dock",            lat: 53.4009, lon: -2.9943 },
];
let POIS = DEFAULT_POIS;

async function loadPois() {
  try {
    const res = await fetch("./pois.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      POIS = data;
      // Don’t spam; one line is enough.
      log(`📌 Loaded ${POIS.length} POIs from pois.json`);
    } else {
      log("📌 pois.json was empty; using built-in defaults.");
    }
  } catch (err) {
    // If you open index.html directly (file://) Safari/Chrome will block fetch() — fallback keeps it working.
    log(`📌 Could not load pois.json; using built-in defaults. (${err?.message || err})`);
  }
}

const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");

// Offscreen fog layer so overlaps don't double-dark.
const fogLayer = document.createElement("canvas");
const fogCtx = fogLayer.getContext("2d");

// Offscreen allowed-region mask (intersection of TRUE radar rings).
const allowedLayer = document.createElement("canvas");
const allowedCtx = allowedLayer.getContext("2d");

const mapImg = new Image();
mapImg.src = "./map.png";
let mapReady = false;

let player = null;
let target = null;

/**
 * Visual clue overlays.
 * type: 'ring'|'half'|'quadrant'|'wedge'|'donut'|'thermo'
 */
const clues = [];

// Thermometer baseline
let thermoBaseline = null; // {lat,lon,distToTarget}

function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    fogLayer.width = w;
    fogLayer.height = h;
    allowedLayer.width = w;
    allowedLayer.height = h;
  }
}


// UI
const elRadarPreset = document.getElementById("radarPreset");
const elThickness = document.getElementById("thickness");
const elLast = document.getElementById("lastAnswer");
const elLog = document.getElementById("log");
const elPlayer = document.getElementById("playerOut");
const elTarget = document.getElementById("targetOut");
const elClues = document.getElementById("cluesOut");
const elReveal = document.getElementById("dbgReveal");
const elBBox = document.getElementById("dbgBBox");
const elBearingBuckets = document.getElementById("bearingBuckets");
const elDistBucket = document.getElementById("distBucket");

const elFogOpacity = document.getElementById("fogOpacity");
const elFogOpacityOut = document.getElementById("fogOpacityOut");

function fogAlpha() {
  const v = parseFloat(elFogOpacity?.value ?? "0.55");
  return Math.max(0, Math.min(0.95, isNaN(v) ? 0.55 : v));
}
function fogFill() {
  // slightly blue-black looks nicer over maps than pure #000
  return `rgba(2, 6, 23, ${fogAlpha()})`;
}
function badStroke() {
  return "rgba(148,163,184,.95)"; // slate-ish outline
}
function updateFogUI() {
  if (elFogOpacityOut) elFogOpacityOut.textContent = `${Math.round(fogAlpha() * 100)}%`;
}

// ===== GEO HELPERS =====
const Rm = 6378137;
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function mercatorXY(lat, lon) {
  const x = Rm * toRad(lon);
  const y = Rm * Math.log(Math.tan(Math.PI/4 + toRad(lat)/2));
  return { x, y };
}
function invMercator(x, y) {
  const lon = toDeg(x / Rm);
  const lat = toDeg(2 * Math.atan(Math.exp(y / Rm)) - Math.PI/2);
  return { lat, lon };
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
function pixelToLatLon(px, py, bbox, w, h) {
  const nw = mercatorXY(bbox.nw.lat, bbox.nw.lon);
  const se = mercatorXY(bbox.se.lat, bbox.se.lon);
  const x = nw.x + (px / w) * (se.x - nw.x);
  const y = nw.y + (py / h) * (se.y - nw.y);
  return invMercator(x, y);
}
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
// meters -> px at player latitude (good enough for small area)
function radiusMetersToPixels(radiusM, atLat, bbox, w, h) {
  const nw = mercatorXY(bbox.nw.lat, bbox.nw.lon);
  const se = mercatorXY(bbox.se.lat, bbox.se.lon);
  const mppX = (se.x - nw.x) / w;
  const mppY = (se.y - nw.y) / h;
  const mpp  = (Math.abs(mppX) + Math.abs(mppY)) / 2;
  const scale = 1 / Math.cos(toRad(atLat));
  return (radiusM * scale) / mpp;
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  let θ = Math.atan2(y, x); // radians
  let deg = (toDeg(θ) + 360) % 360; // 0..360 from north clockwise
  return deg;
}

// ===== GAME/UI =====
function pickNewTarget() {
  target = POIS[Math.floor(Math.random() * POIS.length)];
  log(`🎯 New target (hidden): <b>${escapeHtml(target.name)}</b>`);
  updateUI(); draw();
}
function setPlayer(lat, lon, source="manual") {
  player = { lat, lon };
  log(`📍 Player set (${source}): ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  updateUI(); draw();
}
function ensureReady() {
  if (!player) { log("⚠️ Set your location first."); return false; }
  if (!target) pickNewTarget();
  return true;
}
function addClue(clue) {
  clues.push({ ...clue, ts: Date.now() });
  elClues.textContent = String(clues.length);
  draw();
}

// ===== Q0 Radar (existing) =====
function askRadar() {
  if (!ensureReady()) return;

  const meters = parseFloat(elRadarPreset.value);
  const dist = haversineMeters(player.lat, player.lon, target.lat, target.lon);
  const ok = dist <= meters;

  const p = latLonToPixel(player.lat, player.lon, BBOX, canvas.width, canvas.height);
  const rPx = radiusMetersToPixels(meters, player.lat, BBOX, canvas.width, canvas.height);

  addClue({ type:"ring", x:p.x, y:p.y, rPx, ok, meters });

  elLast.className = "pill " + (ok ? "ok" : "no");
  elLast.textContent = ok ? `TRUE (≤ ${meters}m)` : `FALSE (> ${meters}m)`;

  log(`📡 Radar ${meters}m → <span class="pill ${ok ? "ok":"no"}">${ok ? "TRUE" : "FALSE"}</span> (actual: ${dist.toFixed(1)}m)`);
}

// ===== Q1 N/S/E/W =====
function askDirection(dir) {
  if (!ensureReady()) return;
  const p = latLonToPixel(player.lat, player.lon, BBOX, canvas.width, canvas.height);

  let actualSide = dir;
  if (dir === "N") actualSide = (target.lat > player.lat) ? "N" : "S";
  if (dir === "S") actualSide = (target.lat < player.lat) ? "S" : "N";
  if (dir === "E") actualSide = (target.lon > player.lon) ? "E" : "W";
  if (dir === "W") actualSide = (target.lon < player.lon) ? "W" : "E";

  // Answer is whether the asked direction matches the actual side
  const ok = (actualSide === dir);

  addClue({
    type:"half",
    px: p.x, py: p.y,
    asked: dir,
    actual: actualSide,
    ok
  });

  log(`🧭 ${dir} of me? → <span class="pill ${ok ? "ok":"no"}">${ok ? "TRUE" : "FALSE"}</span> (so it’s <b>${actualSide}</b>)`);
}

// ===== Q2 Quadrant =====
function askQuadrant() {
  if (!ensureReady()) return;
  const p = latLonToPixel(player.lat, player.lon, BBOX, canvas.width, canvas.height);

  const north = target.lat > player.lat; // higher lat = north
  const east  = target.lon > player.lon;
  const quad =
    (north && east) ? "NE" :
    (north && !east) ? "NW" :
    (!north && east) ? "SE" : "SW";

  addClue({ type:"quadrant", px:p.x, py:p.y, quad, ok:true });
  log(`🧩 Quadrant → <span class="pill ok">${quad}</span>`);
}

// ===== Q3 Bearing bucket =====
function askBearing() {
  if (!ensureReady()) return;

  const buckets = parseInt(elBearingBuckets.value, 10);
  const deg = bearingDeg(player.lat, player.lon, target.lat, target.lon);

  const labels4 = ["N","E","S","W"];
  const labels8 = ["N","NE","E","SE","S","SW","W","NW"];
  const labels = (buckets === 4) ? labels4 : labels8;

  const bucketSize = 360 / buckets;
  const idx = Math.floor((deg + bucketSize/2) / bucketSize) % buckets;
  const label = labels[idx];

  // Convert (north=0°) to canvas arc angles (east=0°), radians
  const centerDeg = idx * bucketSize;
  const startDeg = centerDeg - bucketSize/2;
  const endDeg   = centerDeg + bucketSize/2;

  const p = latLonToPixel(player.lat, player.lon, BBOX, canvas.width, canvas.height);

  addClue({ type:"wedge",
    px:p.x, py:p.y,
    startRad: (toRad(startDeg - 90)),
    endRad:   (toRad(endDeg   - 90)),
    label,
    bearing: deg.toFixed(1) + "°",
    ok:true
  });

  log(`🧭 Bearing bucket (${buckets}) → <span class="pill ok">${label}</span> (bearing ${deg.toFixed(1)}°)`);
}

// ===== Q4 Distance bucket =====
function parseBucket(s) {
  if (s.endsWith("+")) {
    const min = parseFloat(s.slice(0, -1));
    return { min, max: Infinity, text: `${min}m+` };
  }
  const [a,b] = s.split("-").map(x => parseFloat(x));
  return { min: a, max: b, text: `${a}–${b}m` };
}
function askDistanceBucket() {
  if (!ensureReady()) return;

  const bucket = parseBucket(elDistBucket.value);
  const dist = haversineMeters(player.lat, player.lon, target.lat, target.lon);

  const ok = (dist >= bucket.min) && (dist < bucket.max);

  const p = latLonToPixel(player.lat, player.lon, BBOX, canvas.width, canvas.height);
  const rIn  = (bucket.min <= 0) ? 0 : radiusMetersToPixels(bucket.min, player.lat, BBOX, canvas.width, canvas.height);
  const rOut = (bucket.max === Infinity)
    ? Math.max(canvas.width, canvas.height) * 1.2
    : radiusMetersToPixels(bucket.max, player.lat, BBOX, canvas.width, canvas.height);

  addClue({
    type:"donut",
    px:p.x, py:p.y,
    rIn, rOut,
    ok,
    text: bucket.text,
    actual: dist.toFixed(1) + "m"
  });

  log(`📏 Distance in ${bucket.text}? → <span class="pill ${ok ? "ok":"no"}">${ok ? "TRUE" : "FALSE"}</span> (actual ${dist.toFixed(1)}m)`);
}

// ===== Q5 Thermometer =====
function askThermo() {
  if (!ensureReady()) return;

  // We compare your distance-to-target before and after you moved.
  // The constraint is the perpendicular bisector of segment AB:
  // - If you got WARMER, the target is in the half-plane closer to B.
  // - If you got COLDER, the target is in the half-plane closer to A.
  // First click sets A (baseline). Second click uses current player location as B.
  if (!thermoBaseline) {
    thermoBaseline = { lat: player.lat, lon: player.lon };
    elLast.className = "pill mid";
    elLast.textContent = "Thermo baseline set";
    log("🌡️ Thermometer baseline set. Move somewhere else, then ask again.");
    return;
  }

  const aLL = { lat: thermoBaseline.lat, lon: thermoBaseline.lon };
  const bLL = { lat: player.lat, lon: player.lon };

  const moved = haversineMeters(aLL.lat, aLL.lon, bLL.lat, bLL.lon);
  if (moved < 10) {
    elLast.className = "pill mid";
    elLast.textContent = "Move more";
    log(`🌡️ You barely moved (${moved.toFixed(1)}m). Move at least ~10m for a useful thermometer.`);
    return;
  }

  const dA = haversineMeters(aLL.lat, aLL.lon, target.lat, target.lon);
  const dB = haversineMeters(bLL.lat, bLL.lon, target.lat, target.lon);

  let result = "same";
  if (dB < dA - 0.5) result = "warmer";
  else if (dB > dA + 0.5) result = "colder";

  const a = latLonToPixel(aLL.lat, aLL.lon, BBOX, canvas.width, canvas.height);
  const b = latLonToPixel(bLL.lat, bLL.lon, BBOX, canvas.width, canvas.height);

  if (result !== "same") {
    addClue({ type:"thermo", ax:a.x, ay:a.y, bx:b.x, by:b.y, result });
  }

  elLast.className = "pill mid";
  elLast.textContent = `Thermo: ${result.toUpperCase()}`;
  log(`🌡️ Thermometer → <span class="pill mid">${result.toUpperCase()}</span> (A: ${dA.toFixed(1)}m → B: ${dB.toFixed(1)}m, moved ${moved.toFixed(1)}m)`);

  // Update baseline so the next thermometer compares from here.
  thermoBaseline = { lat: bLL.lat, lon: bLL.lon };
}

// ===== DRAW =====
function drawBBoxOutline() {
  ctx.save();
  ctx.setLineDash([10, 7]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(147,197,253,.95)";
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.restore();
}

function isRegionClue(c) {
  return c && (c.type === "ring" || c.type === "donut" || c.type === "half" || c.type === "quadrant" || c.type === "wedge" || c.type === "thermo");
}


function clipRectToHalfPlane(W, H, mx, my, nx, ny, keepPositive) {
  // Clip the canvas rectangle to a half-plane defined by:
  //   (P - M) · N >= 0   (if keepPositive=true)
  //   (P - M) · N <= 0   (if keepPositive=false)
  let poly = [
    {x:0, y:0},
    {x:W, y:0},
    {x:W, y:H},
    {x:0, y:H},
  ];
  const sign = keepPositive ? 1 : -1;
  const EPS = 1e-9;

  function sd(p) { // signed distance * sign
    return ((p.x - mx) * nx + (p.y - my) * ny) * sign;
  }

  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const S = poly[i];
    const E = poly[(i + 1) % poly.length];
    const dS = sd(S);
    const dE = sd(E);
    const S_in = dS >= -EPS;
    const E_in = dE >= -EPS;

    if (S_in && E_in) {
      out.push(E);
    } else if (S_in && !E_in) {
      // leaving: add intersection
      const t = dS / (dS - dE);
      out.push({ x: S.x + t * (E.x - S.x), y: S.y + t * (E.y - S.y) });
    } else if (!S_in && E_in) {
      // entering: add intersection then E
      const t = dS / (dS - dE);
      out.push({ x: S.x + t * (E.x - S.x), y: S.y + t * (E.y - S.y) });
      out.push(E);
    }
  }
  return out;
}

function fillPolygon(g, poly) {
  if (!poly || poly.length < 3) return;
  g.beginPath();
  g.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
  g.closePath();
  g.fill();
}
function paintRegion(g, c, W, H) {
  switch (c.type) {
    case "ring": {
      g.beginPath();
      g.arc(c.x, c.y, c.rPx, 0, Math.PI * 2);
      g.fill();
      return;
    }
    case "donut": {
      g.beginPath();
      g.arc(c.px, c.py, c.rOut, 0, Math.PI * 2);
      if (c.rIn > 0.5) g.arc(c.px, c.py, c.rIn, 0, Math.PI * 2, true);
      g.closePath();
      g.fill("evenodd");
      return;
    }
    case "half": {
      // The "questioned area" is the asked half-plane
      if (c.asked === "N") g.fillRect(0, 0, W, c.py);
      if (c.asked === "S") g.fillRect(0, c.py, W, H - c.py);
      if (c.asked === "W") g.fillRect(0, 0, c.px, H);
      if (c.asked === "E") g.fillRect(c.px, 0, W - c.px, H);
      return;
    }
    case "quadrant": {
      const northY0 = 0, northH = c.py;
      const southY0 = c.py, southH = H - c.py;
      const westX0 = 0, westW = c.px;
      const eastX0 = c.px, eastW = W - c.px;

      if (c.quad === "NE") g.fillRect(eastX0, northY0, eastW, northH);
      if (c.quad === "NW") g.fillRect(westX0, northY0, westW, northH);
      if (c.quad === "SE") g.fillRect(eastX0, southY0, eastW, southH);
      if (c.quad === "SW") g.fillRect(westX0, southY0, westW, southH);
      return;
    }
    case "wedge": {
      const R = Math.max(W, H) * 1.35;
      g.beginPath();
      g.moveTo(c.px, c.py);
      g.arc(c.px, c.py, R, c.startRad, c.endRad);
      g.closePath();
      g.fill();
      return;
    }

    case "thermo": {
      // Thermometer: after moving from A->B, "warmer" means target is closer to B than A.
      // That defines a half-plane split by the perpendicular bisector of segment AB.
      if (!c || (c.result !== "warmer" && c.result !== "colder")) return;
      const ax = c.ax, ay = c.ay, bx = c.bx, by = c.by;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx*vx + vy*vy;
      if (len2 < 1e-6) return;

      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;

      // Using N = (B-A). Points closer to B satisfy (P-M)·N > 0.
      const keepPositive = (c.result === "warmer"); // keep B-side if warmer; keep A-side if colder
      const poly = clipRectToHalfPlane(W, H, mx, my, vx, vy, keepPositive);
      fillPolygon(g, poly);
      return;
    }
  }
}

function drawClues() {
  const W = canvas.width, H = canvas.height;

  // Build a single fog layer (no double-dark overlap):
  // - If a clue is TRUE (or it directly returns a region like quadrant/wedge), we fog EVERYTHING OUTSIDE that region.
  //   Multiple TRUE clues intersect (only the overlap stays clear).
  // - If a clue is FALSE, we fog the questioned region itself.
  const regionClues = clues.filter(isRegionClue);

  const positives = regionClues.filter(c => c.ok !== false); // ok=true or undefined (quadrant/wedge)
  const negatives = regionClues.filter(c => c.ok === false);

  // Allowed region = intersection of all positives (if any)
  allowedCtx.clearRect(0, 0, W, H);
  if (positives.length > 0) {
    allowedCtx.save();
    allowedCtx.globalCompositeOperation = "source-over";
    allowedCtx.fillStyle = "rgba(2, 6, 23, 1)";
    allowedCtx.fillRect(0, 0, W, H);

    allowedCtx.globalCompositeOperation = "destination-in";
    for (const c of positives) paintRegion(allowedCtx, c, W, H);
    allowedCtx.restore();
  }

  // Fog mask
  fogCtx.clearRect(0, 0, W, H);
  fogCtx.save();
  fogCtx.globalCompositeOperation = "source-over";
  fogCtx.fillStyle = "rgba(2, 6, 23, 1)";

  if (positives.length > 0) {
    // Start fogged everywhere, then punch out the allowed intersection
    fogCtx.fillRect(0, 0, W, H);
    fogCtx.globalCompositeOperation = "destination-out";
    fogCtx.drawImage(allowedLayer, 0, 0);
    fogCtx.globalCompositeOperation = "source-over";
  }

  // Add all FALSE regions (union)
  for (const c of negatives) paintRegion(fogCtx, c, W, H);

  fogCtx.restore();

  // Composite fog once (slider controls opacity)
  const a = fogAlpha();
  if (a > 0) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(fogLayer, 0, 0);
    ctx.restore();
  }

  

  // Optional but useful: draw the thermometer move segment (neutral colour, no dashes).
  const thermos = clues.filter(c => c && c.type === "thermo");
  if (thermos.length) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(148,163,184,.9)";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(148,163,184,.9)";
    for (const t of thermos) {
      ctx.beginPath();
      ctx.moveTo(t.ax, t.ay);
      ctx.lineTo(t.bx, t.by);
      ctx.stroke();

      const mx = (t.ax + t.bx) / 2;
      const my = (t.ay + t.by) / 2;
      ctx.beginPath();
      ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

// NOTE: We intentionally draw NO outlines, dashed lines, or coloured fills.
  // The fog mask is the whole UI.
}




function draw() {
  resizeCanvasToDisplaySize();
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (mapReady) ctx.drawImage(mapImg, 0, 0, canvas.width, canvas.height);
  else {
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#93c5fd";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("map.png not loaded", 14, 26);
  }

  drawClues();

  // player marker
  if (player) {
    const p = latLonToPixel(player.lat, player.lon, BBOX, canvas.width, canvas.height);
    ctx.save();
    ctx.fillStyle = "rgba(59,130,246,.95)";
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // target (debug)
  if (target && elReveal.checked) {
    const t = latLonToPixel(target.lat, target.lon, BBOX, canvas.width, canvas.height);
    ctx.save();
    ctx.fillStyle = "rgba(245,158,11,.95)";
    ctx.beginPath(); ctx.arc(t.x, t.y, 6, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  if (elBBox.checked) drawBBoxOutline();
  ctx.restore();
}

function updateUI() {
  elPlayer.textContent = player ? `${player.lat.toFixed(6)}, ${player.lon.toFixed(6)}` : "not set";
  elTarget.textContent = (target && elReveal.checked)
    ? `${target.name} — ${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}`
    : "hidden";
  elClues.textContent = String(clues.length);
}

function clearClues() {
  clues.length = 0;
  thermoBaseline = null;
  elLast.className = "pill mid";
  elLast.textContent = "Cleared";
  log("🧽 Cleared all clues (including thermometer baseline).");
  updateUI(); draw();
}

function log(html) {
  const time = new Date().toLocaleTimeString();
  elLog.innerHTML = `<div style="margin-bottom:8px;"><span class="muted">[${time}]</span> ${html}</div>` + elLog.innerHTML;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== EVENTS =====
document.getElementById("btnGeo").addEventListener("click", () => {
  if (!navigator.geolocation) { log("❌ Geolocation not available."); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => setPlayer(pos.coords.latitude, pos.coords.longitude, "geolocation"),
    (err) => log(`❌ Geolocation error: ${escapeHtml(err.message || String(err))}`),
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

document.getElementById("btnClear").addEventListener("click", clearClues);
document.getElementById("btnNewTarget").addEventListener("click", () => { pickNewTarget(); clearClues(); });

document.getElementById("btnRadar").addEventListener("click", askRadar);

document.getElementById("btnNorth").addEventListener("click", () => askDirection("N"));
document.getElementById("btnSouth").addEventListener("click", () => askDirection("S"));
document.getElementById("btnEast").addEventListener("click", () => askDirection("E"));
document.getElementById("btnWest").addEventListener("click", () => askDirection("W"));

document.getElementById("btnQuadrant").addEventListener("click", askQuadrant);
document.getElementById("btnBearing").addEventListener("click", askBearing);
document.getElementById("btnDistance").addEventListener("click", askDistanceBucket);
document.getElementById("btnThermo").addEventListener("click", askThermo);

elReveal.addEventListener("change", () => { updateUI(); draw(); });
elBBox.addEventListener("change", draw);
elThickness.addEventListener("input", draw);

if (elFogOpacity) {
  elFogOpacity.addEventListener("input", () => { updateFogUI(); draw(); });
}

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
  const ll = pixelToLatLon(x, y, BBOX, canvas.width, canvas.height);
  setPlayer(ll.lat, ll.lon, "map click");
});

// ===== INIT =====

// Keep the canvas bitmap synced to its displayed size (fixes Safari stretching).
try {
  const mapCard = document.querySelector(".mapCard");
  if (window.ResizeObserver && mapCard) {
    const ro = new ResizeObserver(() => { resizeCanvasToDisplaySize(); draw(); });
    ro.observe(mapCard);
  }
} catch (e) {}
window.addEventListener("resize", () => { resizeCanvasToDisplaySize(); draw(); });

mapImg.onload = () => {
  mapReady = true;
  const iw = mapImg.naturalWidth || 960;
  const ih = mapImg.naturalHeight || 720;
  // Lock the displayed aspect ratio to the image so Safari can't "stretch" the map on redraws.
  canvas.style.aspectRatio = `${iw} / ${ih}`;

  log("🗺️ Loaded map.png");
  resizeCanvasToDisplaySize();
  updateUI(); draw();
};
mapImg.onerror = () => {
  mapReady = false;
  log("🗺️ map.png failed to load — check it’s next to index.html and being served by npm dev server.");
  updateUI(); draw();
};

(async function init() {
  updateFogUI();
  updateUI();
  draw();
  await loadPois();
  pickNewTarget();
})();
