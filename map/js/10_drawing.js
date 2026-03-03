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


function getLeafletFogTransform() {
  if (!window.leafletMap || !window.FOG_TL || typeof window.FOG_ZF !== "number") return null;

  const map = window.leafletMap;
  const z = map.getZoom();

  // Scale from our fixed fog zoom (FOG_ZF) into current zoom space
  const scaleCss = Math.pow(2, z - window.FOG_ZF);

  // Leaflet pans by translating its internal map pane; getPixelOrigin() can stay stable while panning.
  // getPixelBounds().min gives the projected pixel coord of the current viewport top-left and DOES move with pan.
  const topLeft = map.getPixelBounds().min;

  // Where the fog-world top-left lands in container CSS pixels
  const dxCss = window.FOG_TL.x * scaleCss - topLeft.x;
  const dyCss = window.FOG_TL.y * scaleCss - topLeft.y;

  // Our overlay canvas is in device pixels, Leaflet math is in CSS pixels => convert using DPR.
  const dpr = window.devicePixelRatio || 1;

  return {
    scale: scaleCss,
    scaleDpr: scaleCss * dpr,
    dx: dxCss,
    dy: dyCss,
    dxDpr: dxCss * dpr,
    dyDpr: dyCss * dpr,
    dpr
  };
}

function draw() {
  resizeCanvasToDisplaySize();
  const __t = getLeafletFogTransform();
  if (__t) { view.scale = __t.scale; view.tx = __t.dxDpr; view.ty = __t.dyDpr; }
  if (!mapReady) {
    resizeCanvasToDisplaySize();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = `${Math.max(12, Math.round(12*(window.devicePixelRatio||1)))}px system-ui`;
    const msg = (typeof mapError === "string" && mapError) ? mapError : "Loading map...";
    ctx.fillText(msg, 20, 30);
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillText("Tip: Leaflet tiles require internet (or swap in an ImageOverlay basemap).", 20, 52);
    return;
  }

  // base clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);


  if ((elBBox ? elBBox.checked : false)) drawMapBounds();

  // Fog is now handled by Leaflet geometry (js/17_leaflet_fog.js)

  // markers + outline rings
  drawMarkers();
  drawClueOutlines();
}

function drawMapBounds() {
  const MW = (window.FOG_W||0), MH = (window.FOG_H||0);
  if (!MW || !MH) return;
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);
  ctx.strokeStyle = "rgba(148,163,184,.55)";
  ctx.lineWidth = 2 / view.scale;
  ctx.strokeRect(0, 0, MW, MH);
  ctx.restore();
}

function buildAllowedWorld() { /* Leaflet geometry fog now */ }


function drawFog() { /* Leaflet geometry fog now */ }


function drawMarkers() {
  const MW = (window.FOG_W||0), MH = (window.FOG_H||0);
  if (!MW || !MH) return;

  // player/target markers are now Leaflet layers (so they stay anchored when panning/zooming)
  // (We keep the fog on canvas overlay.)
  // Legacy canvas markers removed in Leaflet mode.

  // target marker is handled by Leaflet markers layer (only visible in debug mode)
}

function drawClueOutlines() {
  // Outlines disabled (no stroke around radar/fog shapes)
  return;

  const MW = (window.FOG_W||0), MH = (window.FOG_H||0);
  if (!MW || !MH) return;
  const thick = clamp(parseFloat((elThickness ? elThickness.value : "3") || "3"), 1, 12);

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