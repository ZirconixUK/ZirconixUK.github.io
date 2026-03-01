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
