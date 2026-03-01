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
