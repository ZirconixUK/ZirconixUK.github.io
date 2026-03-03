// ---- DOM ----
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d", { alpha: true });

const elLog = document.getElementById("log");
const elPlayer = document.getElementById("playerOut");
const elTarget = document.getElementById("targetOut");
const elClues = document.getElementById("cluesOut");
const elReveal = null; // dbgReveal removed (use debugMode)
const elDbgMode = document.getElementById("dbgMode");
const elBBox = document.getElementById("dbgBBox");
const elDbgShowAllPois = document.getElementById("dbgShowAllPois");
const elViewBboxOut = document.getElementById("viewBboxOut");
const elLast = document.getElementById("lastAnswer");

const elRadarPreset = document.getElementById("radarPreset");
const elThickness = document.getElementById("thickness");
const elBearingBuckets = document.getElementById("bearingBuckets");
const elDistBucket = document.getElementById("distBucket");
const elFogOpacity = document.getElementById("fogOpacity");
const elFogOpacityOut = document.getElementById("fogOpacityOut");

// Debug: round controls
const elDbgHeatNew = document.getElementById("dbgHeatNew");
const elDbgHeatApply = document.getElementById("dbgHeatApply");
const elDbgHeatCurrent = document.getElementById("dbgHeatCurrent");

// HUD
const elTimerMain = document.getElementById("timerMain");
const elTimerPenalty = document.getElementById("timerPenalty");
const elHeatWidget = document.getElementById("heatWidget");




// Bind UI event listeners (called from boot after all functions are defined).
function showToast(msg, ok){
  const toast = document.getElementById("toast");
  if (!toast) return;
  const icon = ok ? "✅" : "❌";
  toast.innerHTML = `<div class="toastIcon">${icon}</div><div>${msg}</div>`;
  toast.classList.remove("hidden","good","bad");
  toast.classList.add(ok ? "good" : "bad");
  // click anywhere dismiss
  const dismiss = () => {
    toast.classList.add("hidden");
    toast.classList.remove("good","bad");
    window.removeEventListener("pointerdown", dismiss, true);
    window.removeEventListener("keydown", dismiss, true);
  };
  window.addEventListener("pointerdown", dismiss, true);
  window.addEventListener("keydown", dismiss, true);
}

function on(id, ev, fn){ const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); return el; }

function formatViewBbox(bounds){
  // Leaflet bounds -> python script bbox string: WEST,SOUTH,EAST,NORTH
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const west = sw.lng;
  const south = sw.lat;
  const east = ne.lng;
  const north = ne.lat;
  const fmt = (n) => (Math.round(n * 1e6) / 1e6).toFixed(6);
  return {
    west, south, east, north,
    csv: `${fmt(west)},${fmt(south)},${fmt(east)},${fmt(north)}`
  };
}

async function copyTextToClipboard(text){
  // Try modern clipboard API first
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch(e) {}

  // Fallback: hidden textarea
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch(e) {
    return false;
  }
}

function bindUI() {
  on("btnRecenter","click", (ev) => {
    try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch(e) {}

    // a) Ensure debug is OFF so taps don't accidentally override player location
    try {
      const cb = document.getElementById("dbgMode");
      if (cb && cb.checked) {
        cb.checked = false;
        cb.dispatchEvent(new Event("change"));
      } else {
        debugMode = false;
      }
    } catch(e) { try { debugMode = false; } catch(e2) {} }

    // b) Ensure geolocation permission + grab a fix
    try {
      if (typeof enableGeolocation === "function") {
        // Force GPS to override any prior manual override (e.g., debug-set player location)
        enableGeolocation({ centerAfterFix: true, force: true });
        return;
      }
    } catch(e) {}

    // Fallback: if geolocation isn't available, just tell the user
    try { if (!("geolocation" in navigator)) log("❌ Geolocation not available in this browser."); } catch(e) {}
  });

  on("btnGeo","click", (ev) => {
    try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch(e) {}
    try { log("📡 Use location clicked."); } catch(e) {}
    try { console.info("[MapGame] Use location clicked"); } catch(e) {}

    if (!("geolocation" in navigator)) {
      try { log("❌ Geolocation not available in this browser."); } catch(e) {}
      try { if (typeof showToast === "function") showToast("Geolocation isn’t available in this browser.", false); } catch(e) {}
      return;
    }
    if (!window.isSecureContext) {
      try { log("❌ Geolocation requires HTTPS (or localhost)."); } catch(e) {}
      try { if (typeof showToast === "function") showToast("Geolocation requires HTTPS (or localhost).", false); } catch(e) {}
      return;
    }

    try { log("📡 Requesting your location…"); } catch(e) {}

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          if (typeof setPlayerLatLng === "function") {
            setPlayerLatLng(latitude, longitude, { source: "gps-button", manual: false, accuracy: pos.coords.accuracy, force: true });
          }
        } catch(e) {}

        // Update debug panel immediately (playerOut)
        try {
          const el = document.getElementById("playerOut");
          if (el) el.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        } catch(e) {}
        try { if (typeof updateUI === "function") updateUI(); } catch(e) {}
        try { if (typeof updateHUD === "function") updateHUD(); } catch(e) {}

        try { log(`📍 Player set: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`); } catch(e) {}
        try { if (typeof showToast === "function") showToast("✅ Location set.", true); } catch(e) {}

        // Start continuous tracking (no spam logs)
        try { if (typeof enableGeolocation === "function") enableGeolocation(); } catch(e) {}
      },
      (err) => {
        try { log(`❌ Geolocation error: ${err.message}`); } catch(e) {}
        try { if (typeof showToast === "function") showToast(`Geolocation error: ${err.message}`, false); } catch(e) {}
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  });
  on("btnCenter","click",(ev)=>{ try{ if(ev&&ev.preventDefault) ev.preventDefault(); }catch(e){} try{ log("🎯 Center clicked."); }catch(e){} if (typeof centerOnPlayer==="function") centerOnPlayer(); });
  on("btnClear","click",clearClues);
  on("btnNewTarget","click", () => { clearClues(); pickNewTarget(true); });
  on("btnRadar","click",askRadar);
  on("btnNorth","click", () => askDirection("N"));
  on("btnSouth","click", () => askDirection("S"));
  on("btnEast","click", () => askDirection("E"));
  on("btnWest","click", () => askDirection("W"));
  on("btnQuadrant","click",askQuadrant);
  on("btnBearing","click",askBearing);
  on("btnDistance","click",askDistanceBucket);
  on("btnThermo","click",askThermometer);
  /* dbgReveal removed */
// elReveal.addEventListener("change", draw);
  if (elBBox) elBBox.addEventListener("change", draw);

  // ---- Debug: view bbox (copy/paste into python script) ----
  let lastViewBboxCsv = "";
  on("btnGetViewBbox", "click", () => {
    try {
      const m = window.leafletMap;
      if (!m || typeof m.getBounds !== "function") {
        log("❌ Map not ready yet.");
        return;
      }
      const info = formatViewBbox(m.getBounds());
      lastViewBboxCsv = info.csv;
      if (elViewBboxOut) elViewBboxOut.textContent = info.csv;
      log(`🧾 View BBOX: ${info.csv}`);
    } catch (e) {
      log(`❌ BBOX failed: ${e.message}`);
    }
  });

  on("btnCopyViewBbox", "click", async () => {
    try {
      // If not computed yet, compute now
      if (!lastViewBboxCsv) {
        const m = window.leafletMap;
        if (!m || typeof m.getBounds !== "function") {
          log("❌ Map not ready yet.");
          return;
        }
        const info = formatViewBbox(m.getBounds());
        lastViewBboxCsv = info.csv;
        if (elViewBboxOut) elViewBboxOut.textContent = info.csv;
      }
      const ok = await copyTextToClipboard(lastViewBboxCsv);
      log(ok ? `📋 Copied BBOX: ${lastViewBboxCsv}` : "❌ Copy failed (browser blocked clipboard)." );
    } catch (e) {
      log(`❌ Copy failed: ${e.message}`);
    }
  });

  if (elDbgMode) {
    elDbgMode.addEventListener("change", () => {
      debugMode = !!elDbgMode.checked;
      log(`Debug mode: ${debugMode ? "ON" : "OFF"}`);

      
      if (!debugMode) {
        // Leaving debug mode: resume real GPS location (starts watch, may prompt if not yet granted)
        try { enableGeolocation(); } catch(e) {}
      }
if (debugMode) {
        // stop auto-follow, but remember if it was running
        wasWatchingBeforeDebug = (typeof watchId !== "undefined" && watchId != null);
        if (typeof stopGeolocationWatch === "function") stopGeolocationWatch();
      } else {
        // restore auto-follow if it was previously enabled
        if (wasWatchingBeforeDebug && typeof startGeolocationWatch === "function") startGeolocationWatch();
      }

      updateUI();
      draw();
    });
  }

  if (elFogOpacity) elFogOpacity.addEventListener("input", () => { updateFogUI(); draw(); });

  // Debug: heat override (typed value + Apply)
  const applyHeatFromInput = () => {
    if (!elDbgHeatNew) return;
    const raw = (elDbgHeatNew.value ?? "").toString().trim();
    let v = parseFloat(raw);
    if (!isFinite(v)) v = 0;
    v = Math.max(0, Math.min(5, v));
    // normalize input
    elDbgHeatNew.value = v.toFixed(1);
    // Heat model is continuous (heatValue) with a locked-in integer tier (heatLevel).
    // Debug override should set the continuous value.
    if (typeof setHeatValue === "function") setHeatValue(v);
    // current heat display will refresh via updateHUD; but update immediately too
    if (elDbgHeatCurrent) elDbgHeatCurrent.textContent = `${v.toFixed(1)}/5`;
  };

  if (elDbgHeatApply) {
    elDbgHeatApply.addEventListener("click", applyHeatFromInput);
  }
  if (elDbgHeatNew) {
    elDbgHeatNew.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyHeatFromInput();
    });
    elDbgHeatNew.addEventListener("blur", () => {
      if ((elDbgHeatNew.value ?? "").toString().trim() === "") return;
      applyHeatFromInput();
    });
  }

  // Heat widget toast
  if (elHeatWidget) {
    elHeatWidget.addEventListener("click", () => {
      try {
        if (typeof showHeatToast === "function") showHeatToast();
      } catch (e) {}
    });
  }

  // ---- POI Import / Export ----
  const elImportBtn = document.getElementById("btnImportPois");
  const elExportBtn = document.getElementById("btnExportPois");
  const elForgetBtn = document.getElementById("btnForgetImportedPois");
  const elFile = document.getElementById("fileImportPois");

  if (elImportBtn && elFile) {
    elImportBtn.addEventListener("click", () => {
      try { elFile.value = ""; } catch(e) {}
      elFile.click();
    });

    elFile.addEventListener("change", async () => {
      const f = elFile.files && elFile.files[0];
      if (!f) return;
      try {
        log(`📥 Importing POIs: ${f.name}…`);
        const text = await f.text();
        const data = JSON.parse(text);
        const { chosen, pack, label } = coercePoisPayload(data);

        // Clear existing POIs first (in-place), then load.
        setPoisFromList(chosen, `${f.name} (${label})`);
        window.__POI_PACK__ = pack ? { ...pack, filename: f.name } : { filename: f.name };
        try {
          if (typeof saveImportedPoisPack === "function") {
            await saveImportedPoisPack({ filename: f.name, label, pack, pois: chosen });
          }
        } catch(e) {}

        // If POI pins are enabled, rebuild them for the new list.
        try { if (typeof window.refreshAllPoiPins === "function") window.refreshAllPoiPins(); } catch(e) {}

        // Fresh round feel: clear overlays and pick a new target.
        try { if (typeof clearClues === "function") clearClues(); } catch(e) {}
        try { if (typeof pickNewTarget === "function") pickNewTarget(true); } catch(e) {}
        try { if (typeof updateUI === "function") updateUI(); } catch(e) {}
        try { if (typeof draw === "function") draw(); } catch(e) {}

        try { if (typeof showToast === "function") showToast("POIs imported.", true); } catch(e) {}
      } catch (e) {
        log(`❌ POI import failed: ${e.message}`);
        try { if (typeof showToast === "function") showToast(`Import failed: ${e.message}`, false); } catch(_e) {}
      }
    });
  }

  if (elForgetBtn) {
    elForgetBtn.addEventListener("click", async () => {
      try {
        if (typeof forgetImportedPoisPack === "function") await forgetImportedPoisPack();
        log("🗑️ Cleared saved imported POIs. Refresh to load default POI.json.");
      } catch (e) {
        log(`❌ Could not clear saved POIs: ${e.message}`);
      }
    });
  }

  if (elExportBtn) {
    elExportBtn.addEventListener("click", () => {
      try {
        const base = (window.__POI_PACK__ && window.__POI_PACK__.filename)
          ? String(window.__POI_PACK__.filename).replace(/\.json$/i, "") + "_export"
          : "POI_export";
        exportPoisToFile(POIS, base);
      } catch (e) {
        log(`❌ Export failed: ${e.message}`);
      }
    });
  }

  // ---- Debug: show all POI pins (Leaflet) ----
  if (elDbgShowAllPois) {
    elDbgShowAllPois.addEventListener("change", () => {
      const on = !!elDbgShowAllPois.checked;
      try {
        if (typeof window.setAllPoiPinsVisible === "function") window.setAllPoiPinsVisible(on);
      } catch (e) {}
    });
  }


  // Gameplay menu navigation (new UI)
  const gameMenu = document.getElementById("gameMenu");
  const radarMenu = document.getElementById("radarMenu");
  const thermoMenu = document.getElementById("thermoMenu");
  const dirMenu = document.getElementById("dirMenu");
  const landmarkMenu = document.getElementById("landmarkMenu");
  const photoMenu = document.getElementById("photoMenu");
  const panelGameplay = document.getElementById("panelGameplay");

  
  function refreshLandmarkNearestLabels() {
    try {
      if (!landmarkMenu) return;
      const labels = landmarkMenu.querySelectorAll("[data-nearest-label]");
      if (!labels || !labels.length) return;

      // If player location isn't set yet, show a friendly prompt.
      if (!player || typeof player.lat !== "number" || typeof player.lon !== "number") {
        labels.forEach(el => { el.textContent = "Nearest: (set location)"; });
        return;
      }

      const pois = (Array.isArray(POIS) ? POIS : []);
      const tag = (p, k) => (p && p.osm_tags) ? String(p.osm_tags[k] || "").toLowerCase() : "";

      const pools = {
        train_station: pois.filter(p => tag(p, "railway") === "station"),
        cathedral: pois.filter(p => tag(p, "building") === "cathedral"),
        bus_station: pois.filter(p => tag(p, "amenity") === "bus_station"),
        library: pois.filter(p => tag(p, "amenity") === "library"),
        museum: pois.filter(p => tag(p, "tourism") === "museum"),
      };

      function nearestFrom(list) {
        let best = null;
        let bestD = Infinity;
        for (const p of list) {
          const d = haversineMeters(player.lat, player.lon, p.lat, p.lon);
          if (d < bestD) { bestD = d; best = p; }
        }
        return { poi: best, meters: bestD };
      }

      labels.forEach(el => {
        const kind = (el.getAttribute("data-nearest-label") || "").toLowerCase();
        const list = pools[kind] || [];
        if (!list.length) {
          el.textContent = "Nearest: (none)";
          return;
        }
        const n = nearestFrom(list);
        const name = (n.poi && n.poi.name) ? n.poi.name : "Unknown";
        el.textContent = `Nearest: ${name} (${Math.round(n.meters)}m)`;
      });
    } catch (e) {
      // fail silently (UI nicety only)
      console.error(e);
    }
  }

  function showMenu(which) {
    if (!gameMenu || !radarMenu || !thermoMenu || !dirMenu || !landmarkMenu || !photoMenu) return;
    const showMain = which === "main";
    const showRadar = which === "radar";
    const showThermo = which === "thermo";
    const showDir = which === "dir";
    const showLandmark = which === "landmark";
    const showPhoto = which === "photo";

    gameMenu.classList.toggle("hidden", !showMain);
    radarMenu.classList.toggle("hidden", !showRadar);
    thermoMenu.classList.toggle("hidden", !showThermo);
    dirMenu.classList.toggle("hidden", !showDir);
    landmarkMenu.classList.toggle("hidden", !showLandmark);
    photoMenu.classList.toggle("hidden", !showPhoto);
    if (showLandmark) refreshLandmarkNearestLabels();
  }

  on("qRadar", "click", () => showMenu("radar"));
  on("qThermo", "click", () => showMenu("thermo"));
  on("qDir", "click", () => showMenu("dir"));
  on("qLandmark", "click", () => showMenu("landmark"));
  on("qPhoto", "click", () => showMenu("photo"));
  on("radarBack", "click", () => showMenu("main"));
  on("gameClose", "click", () => { if (panelGameplay) panelGameplay.classList.remove("open"); showMenu("main"); });
  on("thermoBack", "click", () => showMenu("main"));
  on("thermoClose", "click", () => { if (panelGameplay) panelGameplay.classList.remove("open"); showMenu("main"); });
  on("dirBack", "click", () => showMenu("main"));
  on("dirClose", "click", () => { if (panelGameplay) panelGameplay.classList.remove("open"); showMenu("main"); });
  on("landmarkBack", "click", () => showMenu("main"));
  on("landmarkClose", "click", () => { if (panelGameplay) panelGameplay.classList.remove("open"); showMenu("main"); });
  on("photoBack", "click", () => showMenu("main"));
  on("photoClose", "click", () => { if (panelGameplay) panelGameplay.classList.remove("open"); showMenu("main"); });


  function applyQuestionCosts(toolId, optionId) {
    const cost = (typeof getToolCosts === "function") ? getToolCosts(toolId, optionId) : null;
    const h = (cost && typeof cost.heat_cost === "number" && isFinite(cost.heat_cost))
      ? cost.heat_cost
      : (typeof QUESTION_HEAT_COST === "number" ? QUESTION_HEAT_COST : 0.5);
    try { if (typeof addHeat === "function") addHeat(h); else if (typeof setHeatLevel === "function") setHeatLevel((heatLevel||0)+h); } catch(e) {}
  }

  if (radarMenu) {
    radarMenu.querySelectorAll("[data-radar]").forEach(btn => {
      btn.addEventListener("click", () => {
        const meters = parseFloat(btn.getAttribute("data-radar") || "0");
        // Apply costs
        applyQuestionCosts("radar", String(meters));
        // Close overlay immediately
        if (panelGameplay) panelGameplay.classList.remove("open");
        showMenu("main");
        try {
          const res = (meters > 0) ? askRadar(meters) : askRadar();
          if (res && typeof res.ok === "boolean") {
            const m = res.meters;
            const pretty = (m >= 1000)
              ? (m/1000).toFixed(m%1000===0?0:1) + "km"
              : m + "m";
            const msg = res.ok
              ? `Yes — the target is within ${pretty}.`
              : `No — the target is not within ${pretty}.`;
            showToast(msg, res.ok);
          }
        } catch (e) {
          console.error(e);
        }
      });
    });
  }

  // Thermometer menu (UI only for now)
  if (thermoMenu) {
    thermoMenu.querySelectorAll("[data-thermo]").forEach(btn => {
      btn.addEventListener("click", () => {
        const mins = parseFloat(btn.getAttribute("data-thermo") || "0");
        if (panelGameplay) panelGameplay.classList.remove("open");
        showMenu("main");
        if (typeof showToast === "function") {
          let started = false;
        try {
          if (typeof startTimedThermometer === "function") {
            const r = startTimedThermometer(mins);
            started = !!(r && r.ok);
          }
        } catch(e) { console.error(e); }
        if (started) {
          applyQuestionCosts("thermometer", String(mins));
          showToast(`Thermometer running: ${mins}s.`, true);
        } else {
          showToast("Set your location first (geolocation) before using the thermometer.", false);
        }
        }
      });
    });
  }


  // N/S/E/W menu (UI only for now + location check)
  if (dirMenu) {
    dirMenu.querySelectorAll("[data-dir]").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-dir") || "";
        if (!player) {
          if (typeof showToast === "function") showToast("Set your location first (geolocation) before using N/S/E/W.", false);
          return;
        }
        applyQuestionCosts("nsew", String(mode));
        if (panelGameplay) panelGameplay.classList.remove("open");
        showMenu("main");
        try {
          const res = (typeof askAxisDirection === "function") ? askAxisDirection(mode) : null;
          if (res && typeof showToast === "function") {
            const msg = (mode === "NS")
              ? `The target is ${res.label} of you.`
              : `The target is ${res.label} of you.`;
            showToast(msg, true);
          }
        } catch (e) {
          console.error(e);
          if (typeof showToast === "function") showToast("Couldn't run N/S/E/W right now.", false);
        }
      });
    });
  }


  // Landmark menu
  if (landmarkMenu) {
    landmarkMenu.querySelectorAll("[data-landmark]").forEach(btn => {
      btn.addEventListener("click", () => {
        const kind = (btn.getAttribute("data-landmark") || "").toLowerCase();
        // Apply costs
        applyQuestionCosts("landmark", String(kind));
        // Close overlay immediately
        if (panelGameplay) panelGameplay.classList.remove("open");
        showMenu("main");

        // Train station landmark (nearest station match test)
        if (kind === "train_station") {
          try {
            if (!player || typeof player.lat !== "number" || typeof player.lon !== "number") {
              log("🚉 Train Station check: player location not set.");
              showToast("Set your location first (geolocation) before using Train Station.", false);
              return;
            }
            if (!target || typeof target.lat !== "number" || typeof target.lon !== "number") {
              log("🚉 Train Station check: target not set.");
              showToast("No target set yet.", false);
              return;
            }

            const stations = (Array.isArray(POIS) ? POIS : []).filter(p => {
              const t = p && p.osm_tags;
              return t && String(t.railway || "").toLowerCase() === "station";
            });

            if (!stations.length) {
              log("🚉 Train Station check: no railway=station POIs found.");
              showToast("No train stations found in POI list.", false);
              return;
            }

            function nearestStationTo(lat, lon) {
              let best = null;
              let bestD = Infinity;
              for (const s of stations) {
                const d = haversineMeters(lat, lon, s.lat, s.lon);
                if (d < bestD) { bestD = d; best = s; }
              }
              return { poi: best, meters: bestD };
            }

            const np = nearestStationTo(player.lat, player.lon);
            const nt = nearestStationTo(target.lat, target.lon);

            const pName = (np.poi && np.poi.name) ? np.poi.name : "Unknown station";
            const tName = (nt.poi && nt.poi.name) ? nt.poi.name : "Unknown station";

            log(`🚉 Player nearest train station: ${pName} (${Math.round(np.meters)}m)`);
            log(`🎯 Target nearest train station: ${tName} (${Math.round(nt.meters)}m)`);

            const same = (np.poi && nt.poi) && (String(np.poi.id || np.poi.name) === String(nt.poi.id || nt.poi.name));

            // Apply fog constraint (Voronoi-style):
            // - YES => eliminate areas closer to OTHER stations
            // - NO  => eliminate areas closer to THIS (player) station
            try {
              const k = String(np.poi.id || np.poi.name);
              if (typeof addFogNearestStation === "function") addFogNearestStation(k, same);
            } catch(e) { console.error(e); }

            if (same) {
              log("✅ Train Station result: YES (match)");
              showToast("YES — you and the target share the same nearest train station.", true);
            } else {
              log("❌ Train Station result: NO (no match)");
              showToast("NO — your nearest train station is not the target’s nearest.", false);
            }
          } catch (e) {
            console.error(e);
            log("🚉 Train Station check: error (see console).");
            showToast("Train Station check failed (see console).", false);
          }
          return;
        }

        // Other landmark categories (Cathedral, Bus Station, Library, Museum)
        try {
          if (!player || typeof player.lat !== "number" || typeof player.lon !== "number") {
            log(`📍 ${kind}: player location not set.`);
            showToast("Set your location first (geolocation) before using this Landmark.", false);
            return;
          }
          if (!target || typeof target.lat !== "number" || typeof target.lon !== "number") {
            log(`🎯 ${kind}: target not set.`);
            showToast("No target set yet.", false);
            return;
          }

          const pois = (Array.isArray(POIS) ? POIS : []);
          const tag = (p, k) => (p && p.osm_tags) ? String(p.osm_tags[k] || "").toLowerCase() : "";

          const filtered = pois.filter(p => {
            if (!p) return false;
            if (kind === "cathedral") return tag(p, "building") === "cathedral";
            if (kind === "bus_station") return tag(p, "amenity") === "bus_station";
            if (kind === "library") return tag(p, "amenity") === "library";
            if (kind === "museum") return tag(p, "tourism") === "museum";
            return false;
          });

          if (!filtered.length) {
            log(`🧭 ${kind}: no matching POIs found in list.`);
            showToast(`No ${kind.replace("_"," ")} POIs found in POI list.`, false);
            return;
          }

          function nearestTo(lat, lon) {
            let best = null;
            let bestD = Infinity;
            for (const p of filtered) {
              const d = haversineMeters(lat, lon, p.lat, p.lon);
              if (d < bestD) { bestD = d; best = p; }
            }
            return { poi: best, meters: bestD };
          }

          const np = nearestTo(player.lat, player.lon);
          const nt = nearestTo(target.lat, target.lon);

          const pName = (np.poi && np.poi.name) ? np.poi.name : `Unknown ${kind}`;
          const tName = (nt.poi && nt.poi.name) ? nt.poi.name : `Unknown ${kind}`;

          const pretty = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          const label = pretty(kind);

          log(`🧭 Player nearest ${label}: ${pName} (${Math.round(np.meters)}m)`);
          log(`🎯 Target nearest ${label}: ${tName} (${Math.round(nt.meters)}m)`);

          const same = (np.poi && nt.poi) && (String(np.poi.id || np.poi.name) === String(nt.poi.id || nt.poi.name));

          // Apply fog constraint (Voronoi-style):
          // - YES => eliminate areas closer to OTHER landmarks
          // - NO  => eliminate areas closer to THIS (player) landmark
          try {
            const k = String(np.poi.id || np.poi.name);
            if (typeof addFogNearestLandmark === "function") addFogNearestLandmark(kind, k, same);
          } catch(e) { console.error(e); }

          if (same) {
            log(`✅ ${label} result: YES (match)`);
            showToast(`YES — you and the target share the same nearest ${label.toLowerCase()}.`, true);
          } else {
            log(`❌ ${label} result: NO (no match)`);
            showToast(`NO — your nearest ${label.toLowerCase()} is not the target’s nearest.`, false);
          }
        } catch (e) {
          console.error(e);
          log(`🧭 ${kind}: error (see console).`);
          showToast("Landmark check failed (see console).", false);
        }
      });
    });
  }

  // Photo menu
  if (photoMenu) {
    photoMenu.querySelectorAll('[data-photo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = (btn.getAttribute('data-photo') || 'glimpse').toLowerCase();
        if (panelGameplay) panelGameplay.classList.remove('open');
        showMenu('main');

        if (mode !== 'glimpse') return;

        try {
          if (typeof showStreetViewGlimpseForTarget === 'function') {
            const res = await showStreetViewGlimpseForTarget();
            // Only charge costs the first time per target; re-opening is free.
            if (!(res && res.cached)) {
              applyQuestionCosts('photo', mode);
            } else {
              if (typeof window.setLast === 'function') window.setLast('REVIEW', true);
            }
          } else {
            showToast('Photo glimpse module not loaded.', false);
          }
        } catch (e) {
          console.error(e);
          showToast('Could not load a photo glimpse right now.', false);
        }
      });
    });
  }

  // Ensure modal handlers are wired (safe to call multiple times)
  try { if (typeof bindPhotoModal === 'function') bindPhotoModal(); } catch(e) {}


}
window.bindUI = bindUI;