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
