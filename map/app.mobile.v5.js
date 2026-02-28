/**
 * Mobile-ready map pane (pan + pinch zoom) + simple clue fog
 * - No "tap to set location" (tap/drag is only for panning)
 * - Uses Geolocation (watchPosition) when permission granted
 * - Static map.png as world; overlays are computed in map pixel coords and
 *   transformed along with the map.
 */

const BBOX = {
  nw: { lat: 53.410529518470405, lon: -2.9982161521911626 },
  se: { lat: 53.40140896291161,  lon: -2.971136569976807  },
};

// ---- POIs ----
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
    if (Array.isArray(data) && data.length) POIS = data;
    log(`📌 Loaded ${POIS.length} POIs`);
  } catch (e) {
    log(`📌 Using built-in POIs (couldn't load pois.json)`);
  }
}

// ---- DOM ----
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d", { alpha: true });

const elLog = document.getElementById("log");
const elPlayer = document.getElementById("playerOut");
const elTarget = document.getElementById("targetOut");
const elClues = document.getElementById("cluesOut");
const elReveal = document.getElementById("dbgReveal");
const elBBox = document.getElementById("dbgBBox");
const elLast = document.getElementById("lastAnswer");

const elRadarPreset = document.getElementById("radarPreset");
const elThickness = document.getElementById("thickness");
const elBearingBuckets = document.getElementById("bearingBuckets");
const elDistBucket = document.getElementById("distBucket");
const elFogOpacity = document.getElementById("fogOpacity");
const elFogOpacityOut = document.getElementById("fogOpacityOut");

document.getElementById("btnGeo").addEventListener("click", enableGeolocation);
document.getElementById("btnCenter").addEventListener("click", centerOnPlayer);
document.getElementById("btnClear").addEventListener("click", clearClues);
document.getElementById("btnNewTarget").addEventListener("click", pickNewTarget);

document.getElementById("btnRadar").addEventListener("click", askRadar);
document.getElementById("btnNorth").addEventListener("click", () => askDirection("N"));
document.getElementById("btnSouth").addEventListener("click", () => askDirection("S"));
document.getElementById("btnEast").addEventListener("click", () => askDirection("E"));
document.getElementById("btnWest").addEventListener("click", () => askDirection("W"));
document.getElementById("btnQuadrant").addEventListener("click", askQuadrant);
document.getElementById("btnBearing").addEventListener("click", askBearing);
document.getElementById("btnDistance").addEventListener("click", askDistanceBucket);
document.getElementById("btnThermo").addEventListener("click", askThermometer);

elReveal.addEventListener("change", draw);
elBBox.addEventListener("change", draw);
elFogOpacity.addEventListener("input", () => { updateFogUI(); draw(); });

// ---- Map image ----
const mapImg = new Image();
mapImg.src = "./map.png";
let mapReady = false;

// World-size mask used to cut the fog (opaque pixels = allowed region)
const allowedWorld = document.createElement("canvas");
const allowedCtx = allowedWorld.getContext("2d", { alpha: true });

// Screen-sized fog layer so we can punch holes without erasing the map
const fogScreen = document.createElement("canvas");
const fogScreenCtx = fogScreen.getContext("2d", { alpha: true });

// ---- State ----
let player = null;  // {lat, lon}
let target = null;  // {name, lat, lon}
const clues = [];   // constraints to intersect
let thermoBaseline = null;

function fogAlpha() {
  const v = parseFloat(elFogOpacity?.value ?? "0.55");
  return Math.max(0, Math.min(0.95, isNaN(v) ? 0.55 : v));
}
function updateFogUI() {
  if (elFogOpacityOut) elFogOpacityOut.textContent = `${Math.round(fogAlpha() * 100)}%`;
}

// ---- View transform ----
const view = { scale: 1, tx: 0, ty: 0 };
const LIMITS = { min: 0.4, max: 4.0 }; // sensible defaults for 2313x1548 on mobile
let viewInited = false;

function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    fogScreen.width = w; fogScreen.height = h;
  }
}

function fitViewToMap() {
  if (!mapReady) return;
  resizeCanvasToDisplaySize();
  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  if (!MW || !MH || !canvas.width || !canvas.height) return;

  const sx = canvas.width / MW;
  const sy = canvas.height / MH;

  // Mobile-first default: fit to HEIGHT (so the map fills vertically in portrait),
  // leaving horizontal overflow to pan.
  const isPortrait = canvas.height >= canvas.width;
  view.scale = isPortrait ? sy : Math.min(sx, sy);
  view.scale = clamp(view.scale, LIMITS.min, LIMITS.max);

  view.tx = (canvas.width - MW * view.scale) / 2;
  view.ty = (canvas.height - MH * view.scale) / 2;

  clampView();
  viewInited = true;
  draw();
}

function clampView() {
  if (!mapReady) return;
  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const sw = MW * view.scale;
  const sh = MH * view.scale;

  if (sw <= canvas.width) view.tx = (canvas.width - sw) / 2;
  else view.tx = clamp(view.tx, canvas.width - sw, 0);

  if (sh <= canvas.height) view.ty = (canvas.height - sh) / 2;
  else view.ty = clamp(view.ty, canvas.height - sh, 0);
}

function screenPxFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top)  * (canvas.height / rect.height);
  return { x, y };
}

function screenToWorld(sx, sy) {
  return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale };
}

// ---- Mobile gestures (Pointer Events) ----
const pointers = new Map(); // pointerId -> {sx, sy}
let mode = "none"; // "pan" | "pinch"
let panStart = { sx:0, sy:0, tx:0, ty:0 };
let pinchStart = { dist:1, scale:1, worldX:0, worldY:0 };

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = screenPxFromClient(e.clientX, e.clientY);
  pointers.set(e.pointerId, p);

  if (pointers.size === 1) {
    mode = "pan";
    panStart = { sx: p.x, sy: p.y, tx: view.tx, ty: view.ty };
  } else if (pointers.size === 2) {
    mode = "pinch";
    const [p1, p2] = [...pointers.values()];
    const mid = midpoint(p1, p2);
    pinchStart.dist = distance(p1, p2);
    pinchStart.scale = view.scale;
    const wpt = screenToWorld(mid.x, mid.y);
    pinchStart.worldX = wpt.x;
    pinchStart.worldY = wpt.y;
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  const p = screenPxFromClient(e.clientX, e.clientY);
  pointers.set(e.pointerId, p);

  if (!viewInited) return;

  if (mode === "pan" && pointers.size === 1) {
    const dx = p.x - panStart.sx;
    const dy = p.y - panStart.sy;
    view.tx = panStart.tx + dx;
    view.ty = panStart.ty + dy;
    clampView();
    drawThrottled();
  }

  if (mode === "pinch" && pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    const mid = midpoint(p1, p2);
    const dist = distance(p1, p2);

    let nextScale = pinchStart.scale * (dist / pinchStart.dist);
    nextScale = clamp(nextScale, LIMITS.min, LIMITS.max);

    // Zoom around pinch midpoint: keep pinchStart.worldX/Y under the midpoint
    view.tx = mid.x - pinchStart.worldX * nextScale;
    view.ty = mid.y - pinchStart.worldY * nextScale;
    view.scale = nextScale;

    clampView();
    drawThrottled();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) mode = "none";
  if (pointers.size === 1) {
    // smooth pinch->pan transition
    const remaining = [...pointers.values()][0];
    mode = "pan";
    panStart = { sx: remaining.x, sy: remaining.y, tx: view.tx, ty: view.ty };
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

// Prevent iOS double-tap zoom / scrolling on the canvas
canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
canvas.addEventListener("touchmove",  (e) => e.preventDefault(), { passive: false });

// ---- Geolocation ----
let watchId = null;
let hasCenteredOnce = false;

function enableGeolocation() {
  if (!("geolocation" in navigator)) {
    log("❌ Geolocation not available in this browser.");
    return;
  }
  if (watchId != null) {
    log("📡 Location already enabled.");
    return;
  }

  // watchPosition updates while moving (best UX for mobile)
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setPlayer(latitude, longitude, true);
    },
    (err) => {
      log(`❌ Geolocation error: ${err.message}`);
      watchId = null;
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );

  log("✅ Location enabled. (We only use it locally to place you on the map.)");
}

function setPlayer(lat, lon, silent = false) {
  player = { lat, lon };
  elPlayer.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  if (!silent) log(`📍 Player: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);

  if (!hasCenteredOnce && mapReady && viewInited) {
    centerOnPlayer();
    hasCenteredOnce = true;
  } else {
    drawThrottled();
  }
}

function centerOnPlayer() {
  if (!player || !mapReady || !viewInited) return;
  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const p = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);
  // Center player's pixel on canvas
  view.tx = canvas.width / 2 - p.x * view.scale;
  view.ty = canvas.height / 2 - p.y * view.scale;
  clampView();
  draw();
  log("🎯 Centered on player.");
}

// ---- Clues / Questions ----
function ensureReady() {
  if (!player) { log("⚠️ Tap “Enable location” first."); return false; }
  if (!target) pickNewTarget(false);
  return true;
}

function pickNewTarget(verbose = true) {
  target = POIS[Math.floor(Math.random() * POIS.length)];
  if (verbose) log(`🎯 New target chosen (hidden).`);
  updateUI();
  draw();
}

function clearClues() {
  clues.length = 0;
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

function askRadar() {
  if (!ensureReady()) return;
  const meters = parseFloat(elRadarPreset.value);
  const dist = haversineMeters(player.lat, player.lon, target.lat, target.lon);
  const ok = dist <= meters;

  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const pp = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);
  const rPx = radiusMetersToPixels(meters, player.lat, BBOX, MW, MH);

  addClue({ type: "ring", x: pp.x, y: pp.y, r: rPx, ok });
  setLast(ok ? `TRUE (≤${meters}m)` : `FALSE (>${meters}m)`, ok);
  log(`📡 Radar ${meters}m → ${ok ? "TRUE" : "FALSE"} (actual ${dist.toFixed(0)}m)`);
}

function askDirection(dir) {
  if (!ensureReady()) return;
  let ok = false;
  if (dir === "N") ok = target.lat > player.lat;
  if (dir === "S") ok = target.lat < player.lat;
  if (dir === "E") ok = target.lon > player.lon;
  if (dir === "W") ok = target.lon < player.lon;

  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const pp = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);

  addClue({ type: "half", x: pp.x, y: pp.y, dir, ok });
  setLast(ok ? "TRUE" : "FALSE", ok);
  log(`🧭 ${dir} of me? → ${ok ? "TRUE" : "FALSE"}`);
}

function askQuadrant() {
  if (!ensureReady()) return;
  const north = target.lat > player.lat;
  const east = target.lon > player.lon;
  const quad = (north && east) ? "NE" : (north && !east) ? "NW" : (!north && east) ? "SE" : "SW";

  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const pp = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);

  addClue({ type: "quadrant", x: pp.x, y: pp.y, quad, ok: true });
  setLast(quad, true);
  log(`🧩 Quadrant → ${quad}`);
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

  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const pp = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);

  // Store angles in radians in WORLD coords, but we draw with a big radius
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
}

function parseBucket(s) {
  if (s.endsWith("+")) return { min: parseFloat(s.slice(0,-1)), max: Infinity, text: `${s}` };
  const [a,b] = s.split("-").map(Number);
  return { min:a, max:b, text:`${a}–${b}m` };
}

function askDistanceBucket() {
  if (!ensureReady()) return;
  const bucket = parseBucket(elDistBucket.value);
  const dist = haversineMeters(player.lat, player.lon, target.lat, target.lon);
  const ok = dist >= bucket.min && dist < bucket.max;

  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const pp = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);

  const rIn = bucket.min <= 0 ? 0 : radiusMetersToPixels(bucket.min, player.lat, BBOX, MW, MH);
  const rOut = bucket.max === Infinity ? Math.max(MW, MH) * 1.6 : radiusMetersToPixels(bucket.max, player.lat, BBOX, MW, MH);

  addClue({ type: "donut", x: pp.x, y: pp.y, rIn, rOut, ok, text: bucket.text });
  setLast(ok ? `TRUE (${bucket.text})` : `FALSE (${bucket.text})`, ok);
  log(`📏 Distance bucket ${bucket.text} → ${ok ? "TRUE" : "FALSE"} (actual ${dist.toFixed(0)}m)`);
}

function askThermometer() {
  if (!ensureReady()) return;
  if (!thermoBaseline) {
    thermoBaseline = { ...player };
    log("🌡️ Thermometer baseline set. Walk somewhere else, then press again.");
    setLast("Baseline set", true);
    return;
  }
  const d0 = haversineMeters(thermoBaseline.lat, thermoBaseline.lon, target.lat, target.lon);
  const d1 = haversineMeters(player.lat, player.lon, target.lat, target.lon);
  const hotter = d1 < d0;

  // Constrain: closer to current point than baseline? That's a half-plane in Voronoi sense.
  // We'll approximate as a perpendicular bisector: allowed region is closer to current than baseline.
  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const p0 = latLonToPixel(thermoBaseline.lat, thermoBaseline.lon, BBOX, MW, MH);
  const p1 = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);

  addClue({ type: "thermo", a: p0, b: p1, ok: hotter });
  setLast(hotter ? "HOTTER" : "COLDER", hotter);
  log(`🌡️ ${hotter ? "HOTTER" : "COLDER"} (baseline ${d0.toFixed(0)}m → now ${d1.toFixed(0)}m)`);
}

// ---- UI helpers ----
function setLast(text, ok) {
  if (!elLast) return;
  elLast.className = "pill " + (ok ? "ok" : "no");
  elLast.textContent = text;
}
function updateUI() {
  elClues.textContent = String(clues.length);
  elPlayer.textContent = player ? `${player.lat.toFixed(6)}, ${player.lon.toFixed(6)}` : "not set";
  elTarget.textContent = (elReveal.checked && target) ? target.name : "hidden";
  updateFogUI();
}

function log(msg) {
  const t = new Date().toLocaleTimeString();
  elLog.innerHTML = `<div style="margin-bottom:8px;"><span class="muted">[${t}]</span> ${msg}</div>` + elLog.innerHTML;
}

// ---- Drawing ----
let rafPending = false;
function drawThrottled() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    draw();
  });
}

function draw() {
  resizeCanvasToDisplaySize();
  if (!mapReady) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.font = `${Math.max(12, Math.round(12*(window.devicePixelRatio||1)))}px system-ui`;
    ctx.fillText("Loading map...", 20, 30);
    return;
  }

  // base clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // draw map
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mapImg, 0, 0);
  ctx.restore();

  if (elBBox.checked) drawMapBounds();

  // recompute allowed region mask
  buildAllowedWorld();

  // apply fog (darken outside allowed)
  drawFog();

  // markers + outline rings
  drawMarkers();
  drawClueOutlines();
}

function drawMapBounds() {
  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);
  ctx.strokeStyle = "rgba(148,163,184,.55)";
  ctx.lineWidth = 2 / view.scale;
  ctx.strokeRect(0, 0, MW, MH);
  ctx.restore();
}

function buildAllowedWorld() {
  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  if (allowedWorld.width !== MW || allowedWorld.height !== MH) {
    allowedWorld.width = MW;
    allowedWorld.height = MH;
  }

  // Start allowed = whole map (opaque)
  allowedCtx.clearRect(0,0,MW,MH);
  allowedCtx.fillStyle = "rgba(255,255,255,1)";
  allowedCtx.fillRect(0,0,MW,MH);

  // Intersect sequential constraints by masking in-place using destination-in
  for (const c of clues) {
    allowedCtx.save();
    allowedCtx.globalCompositeOperation = "destination-in";

    // Draw region for which the clue is satisfied ("allowed region")
    allowedCtx.clearRect(0,0,0,0); // no-op; just for readability
    allowedCtx.fillStyle = "rgba(255,255,255,1)";
    allowedCtx.beginPath();

    if (c.type === "ring") {
      // ok=true: inside circle; ok=false: outside circle
      if (c.ok) {
        allowedCtx.arc(c.x, c.y, c.r, 0, Math.PI*2);
        allowedCtx.closePath();
        allowedCtx.fill();
      } else {
        allowedCtx.rect(0,0,MW,MH);
        allowedCtx.arc(c.x, c.y, c.r, 0, Math.PI*2, true);
        allowedCtx.closePath();
        allowedCtx.fill("evenodd");
      }
    } else if (c.type === "half") {
      const okDir = c.ok ? c.dir : oppositeDir(c.dir);
      drawHalfPlanePath(allowedCtx, okDir, c.x, c.y, MW, MH);
      allowedCtx.fill();
    } else if (c.type === "quadrant") {
      drawQuadrantPath(allowedCtx, c.quad, c.x, c.y, MW, MH);
      allowedCtx.fill();
    } else if (c.type === "wedge") {
      // wedge from point to edge (use large radius)
      const R = Math.max(MW, MH) * 2;
      allowedCtx.moveTo(c.x, c.y);
      allowedCtx.arc(c.x, c.y, R, c.a0, c.a1);
      allowedCtx.closePath();
      allowedCtx.fill();
    } else if (c.type === "donut") {
      // ok=true: annulus; ok=false: outside annulus (inside inner OR outside outer)
      if (c.ok) {
        allowedCtx.arc(c.x, c.y, c.rOut, 0, Math.PI*2);
        allowedCtx.arc(c.x, c.y, c.rIn,  0, Math.PI*2, true);
        allowedCtx.closePath();
        allowedCtx.fill("evenodd");
      } else {
        // outside annulus = (outside outer) OR (inside inner)
        // easiest: whole map, cut out annulus
        allowedCtx.rect(0,0,MW,MH);
        allowedCtx.arc(c.x, c.y, c.rOut, 0, Math.PI*2, true);
        allowedCtx.arc(c.x, c.y, c.rIn,  0, Math.PI*2);
        allowedCtx.closePath();
        allowedCtx.fill("evenodd");
      }
    } else if (c.type === "thermo") {
      // ok=true means "hotter": closer to b than a (Voronoi half-plane).
      // Build a line perpendicular bisector between a and b; choose side.
      const A = c.a, B = c.b;
      const mx = (A.x + B.x)/2, my = (A.y + B.y)/2;
      const vx = B.x - A.x, vy = B.y - A.y;
      // Perp direction:
      const px = -vy, py = vx;
      // Two far points along the bisector:
      const L = Math.max(MW, MH) * 4;
      const x1 = mx - px*L, y1 = my - py*L;
      const x2 = mx + px*L, y2 = my + py*L;

      // To decide which side is "closer to B than A", test one point:
      // point B itself should be in the "closer to B" side.
      // Determine which side of line (x1,y1)-(x2,y2) B lies on; fill that half-plane.
      const sideB = lineSide(x1,y1,x2,y2,B.x,B.y);
      const wantSide = c.ok ? sideB : -sideB;

      drawHalfPlaneFromLine(allowedCtx, x1,y1,x2,y2, wantSide, MW, MH);
      allowedCtx.fill();
    }

    allowedCtx.restore();
  }
}

function drawFog() {
  const a = fogAlpha();
  if (clues.length === 0 || a <= 0) return;

  // Build fog on an offscreen screen-sized canvas so we don't "erase" the map.
  if (fogScreen.width !== canvas.width || fogScreen.height !== canvas.height) {
    fogScreen.width = canvas.width;
    fogScreen.height = canvas.height;
  }
  fogScreenCtx.clearRect(0, 0, fogScreen.width, fogScreen.height);

  // 1) Fill fog everywhere
  fogScreenCtx.globalCompositeOperation = "source-over";
  fogScreenCtx.fillStyle = `rgba(0,0,0,${a})`;
  fogScreenCtx.fillRect(0, 0, fogScreen.width, fogScreen.height);

  // 2) Punch out the allowed region (transparent hole) using destination-out
  fogScreenCtx.globalCompositeOperation = "destination-out";
  fogScreenCtx.imageSmoothingEnabled = false;
  fogScreenCtx.save();
  fogScreenCtx.translate(view.tx, view.ty);
  fogScreenCtx.scale(view.scale, view.scale);
  fogScreenCtx.drawImage(allowedWorld, 0, 0);
  fogScreenCtx.restore();

  // 3) Composite fog over the already-drawn map
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(fogScreen, 0, 0);
  ctx.restore();
}

function drawMarkers() {
  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;

  // player marker
  if (player) {
    const p = latLonToPixel(player.lat, player.lon, BBOX, MW, MH);
    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    ctx.fillStyle = "rgba(56,189,248,.95)";
    ctx.strokeStyle = "rgba(2,6,23,.9)";
    ctx.lineWidth = 3 / view.scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7 / view.scale, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // target marker if reveal on
  if (elReveal.checked && target) {
    const t = latLonToPixel(target.lat, target.lon, BBOX, MW, MH);
    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    ctx.fillStyle = "rgba(244,63,94,.95)";
    ctx.strokeStyle = "rgba(2,6,23,.9)";
    ctx.lineWidth = 3 / view.scale;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 7 / view.scale, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}

function drawClueOutlines() {
  if (clues.length === 0) return;

  const MW = mapImg.naturalWidth, MH = mapImg.naturalHeight;
  const thick = clamp(parseFloat(elThickness.value || "3"), 1, 12);

  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);

  for (const c of clues) {
    ctx.lineWidth = (thick / view.scale);
    ctx.strokeStyle = c.ok ? "rgba(148,163,184,.85)" : "rgba(148,163,184,.55)";

    if (c.type === "ring") {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI*2);
      ctx.stroke();
    } else if (c.type === "donut") {
      ctx.beginPath(); ctx.arc(c.x, c.y, c.rIn, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y, c.rOut, 0, Math.PI*2); ctx.stroke();
    } else if (c.type === "half") {
      ctx.beginPath();
      drawHalfPlanePath(ctx, c.ok ? c.dir : oppositeDir(c.dir), c.x, c.y, MW, MH);
      ctx.closePath();
      ctx.stroke();
    } else if (c.type === "quadrant") {
      ctx.beginPath();
      drawQuadrantPath(ctx, c.quad, c.x, c.y, MW, MH);
      ctx.closePath();
      ctx.stroke();
    } else if (c.type === "wedge") {
      const R = Math.max(MW, MH) * 2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.arc(c.x, c.y, R, c.a0, c.a1);
      ctx.closePath();
      ctx.stroke();
    } else if (c.type === "thermo") {
      // show baseline/current points + bisector
      ctx.fillStyle = "rgba(148,163,184,.85)";
      ctx.beginPath(); ctx.arc(c.a.x, c.a.y, 5 / view.scale, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(c.b.x, c.b.y, 5 / view.scale, 0, Math.PI*2); ctx.fill();
    }
  }

  ctx.restore();
}

// ---- Geometry drawing helpers ----
function drawHalfPlanePath(g, dir, x, y, MW, MH) {
  // Build a polygon covering the half of the map relative to point (x,y)
  // N: y <= py, S: y >= py, E: x >= px, W: x <= px
  if (dir === "N") { g.rect(0, 0, MW, y); }
  if (dir === "S") { g.rect(0, y, MW, MH - y); }
  if (dir === "W") { g.rect(0, 0, x, MH); }
  if (dir === "E") { g.rect(x, 0, MW - x, MH); }
}

function drawQuadrantPath(g, quad, x, y, MW, MH) {
  if (quad === "NE") g.rect(x, 0, MW - x, y);
  if (quad === "NW") g.rect(0, 0, x, y);
  if (quad === "SE") g.rect(x, y, MW - x, MH - y);
  if (quad === "SW") g.rect(0, y, x, MH - y);
}

function oppositeDir(d) {
  return d === "N" ? "S" : d === "S" ? "N" : d === "E" ? "W" : "E";
}

function drawHalfPlaneFromLine(g, x1,y1,x2,y2, wantSide, MW, MH) {
  // Create a big polygon that represents one half-plane.
  // We'll clip by drawing an enormous quad; choose points based on which side is desired.
  // We approximate by taking the line and extending normal direction.
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // unit normal

  const L = Math.max(MW, MH) * 8;
  const sx = nx * L * Math.sign(wantSide);
  const sy = ny * L * Math.sign(wantSide);

  // two points on the line, shifted to the desired side
  const a1 = { x: x1 + sx, y: y1 + sy };
  const a2 = { x: x2 + sx, y: y2 + sy };
  // and far points further out (same direction)
  const b1 = { x: x2 + sx + dx * 1000, y: y2 + sy + dy * 1000 };
  const b2 = { x: x1 + sx - dx * 1000, y: y1 + sy - dy * 1000 };

  g.moveTo(a1.x, a1.y);
  g.lineTo(a2.x, a2.y);
  g.lineTo(b1.x, b1.y);
  g.lineTo(b2.x, b2.y);
  g.closePath();

  // Clip to map bounds by intersecting with bounds via evenodd on fill later (good enough)
  // We'll rely on destination-in with map-sized canvas, so anything outside is irrelevant.
}

function lineSide(x1,y1,x2,y2, px,py) {
  // returns sign of cross product (line -> point)
  const v = (x2-x1)*(py-y1) - (y2-y1)*(px-x1);
  return v === 0 ? 0 : (v > 0 ? 1 : -1);
}

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

// ---- Boot ----
mapImg.addEventListener("load", () => {
  mapReady = true;
  fitViewToMap();
  updateUI();
  draw();
});
window.addEventListener("resize", () => {
  if (!mapReady) return;
  fitViewToMap();
});

(async function init() {
  updateFogUI();
  await loadPois();
  pickNewTarget(false);
  updateUI();
  log("Ready. Tip: on mobile, use HTTPS or localhost for geolocation.");
})();


// ---- Panel toggle (mobile overlay UI) ----
(() => {
  const panel = document.getElementById("panel");
  const btn = document.getElementById("btnPanel");
  const btnClose = document.getElementById("btnPanelClose");

  if (!panel || !btn) return;

  function setOpen(open) {
    panel.classList.toggle("open", open);
  }
  btn.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  if (btnClose) btnClose.addEventListener("click", () => setOpen(false));

  // Start hidden (map-first)
  setOpen(false);
})();
