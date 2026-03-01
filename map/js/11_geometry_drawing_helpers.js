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
