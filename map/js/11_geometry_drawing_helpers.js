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


function lineIntersection(a1,a2,b1,b2) {
  // segment intersection between a (infinite line) and b segment? We'll compute intersection of infinite line a1-a2 with segment b1-b2.
  const x1=a1.x, y1=a1.y, x2=a2.x, y2=a2.y;
  const x3=b1.x, y3=b1.y, x4=b2.x, y4=b2.y;
  const den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if (Math.abs(den) < 1e-9) return null;
  const px = ((x1*y2 - y1*x2)*(x3-x4) - (x1-x2)*(x3*y4 - y3*x4)) / den;
  const py = ((x1*y2 - y1*x2)*(y3-y4) - (y1-y2)*(x3*y4 - y3*x4)) / den;

  // check within segment b1-b2 with small epsilon
  const minx = Math.min(x3,x4) - 1e-6, maxx = Math.max(x3,x4) + 1e-6;
  const miny = Math.min(y3,y4) - 1e-6, maxy = Math.max(y3,y4) + 1e-6;
  if (px < minx || px > maxx || py < miny || py > maxy) return null;
  return { x:px, y:py };
}

function sortPolygonPoints(points) {
  const c = points.reduce((acc,p)=>({x:acc.x+p.x,y:acc.y+p.y}), {x:0,y:0});
  c.x /= points.length; c.y /= points.length;
  points.sort((p,q)=>Math.atan2(p.y-c.y,p.x-c.x) - Math.atan2(q.y-c.y,q.x-c.x));
  return points;
}

function drawHalfPlaneClippedFromLine(g, x1,y1,x2,y2, wantSide, MW, MH) {
  // Build polygon = all rect corners on desired side + intersection points of line with rect edges.
  const corners = [
    {x:0,y:0},
    {x:MW,y:0},
    {x:MW,y:MH},
    {x:0,y:MH},
  ];
  const pts = [];

  // include corners on side (or on the line)
  for (const c of corners) {
    const s = lineSide(x1,y1,x2,y2,c.x,c.y);
    if (s === wantSide || s === 0) pts.push(c);
  }

  // intersections with rectangle edges
  const a1={x:x1,y:y1}, a2={x:x2,y:y2};
  const edges = [
    [{x:0,y:0},{x:MW,y:0}],
    [{x:MW,y:0},{x:MW,y:MH}],
    [{x:MW,y:MH},{x:0,y:MH}],
    [{x:0,y:MH},{x:0,y:0}],
  ];
  for (const [b1,b2] of edges) {
    const ip = lineIntersection(a1,a2,b1,b2);
    if (ip) pts.push(ip);
  }

  // Deduplicate close points
  const uniq = [];
  for (const p of pts) {
    if (!uniq.some(q => Math.hypot(p.x-q.x,p.y-q.y) < 0.5)) uniq.push(p);
  }
  if (uniq.length < 3) return;

  sortPolygonPoints(uniq);

  g.moveTo(uniq[0].x, uniq[0].y);
  for (let i=1;i<uniq.length;i++) g.lineTo(uniq[i].x, uniq[i].y);
  g.closePath();
}
