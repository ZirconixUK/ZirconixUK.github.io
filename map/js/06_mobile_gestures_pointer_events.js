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
