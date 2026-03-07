// ---- View transform (legacy) ----
// With Leaflet handling pan/zoom, we no longer manage tx/ty/scale ourselves.
// We keep a minimal 'view' object so existing drawing code can use view.scale
// for line-width compensation etc.

const view = {
  scale: 1,
  tx: 0,
  ty: 0
};

function clampView() {
  // no-op in Leaflet mode
}

function fitViewToMap() {
  // no-op in Leaflet mode
}

function resizeCanvasToDisplaySize() {
  const c = (window.canvas || document.getElementById('view'));
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }

  // Keep fogScreen in sync
  if (window.fogScreen) {
    if (window.fogScreen.width !== w || window.fogScreen.height !== h) {
      window.fogScreen.width = w;
      window.fogScreen.height = h;
    }
  }
}

