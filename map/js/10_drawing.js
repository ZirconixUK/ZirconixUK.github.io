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
    resizeCanvasToDisplaySize();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = `${Math.max(12, Math.round(12*(window.devicePixelRatio||1)))}px system-ui`;
    const msg = (typeof mapError === "string" && mapError) ? mapError : "Loading map...";
    ctx.fillText(msg, 20, 30);
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillText("Tip: ensure map.png sits next to index.html", 20, 52);
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
