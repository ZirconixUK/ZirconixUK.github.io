// ---- UI helpers ----
function setLast(text, ok) {
  if (!elLast) return;
  elLast.className = "pill " + (ok ? "ok" : "no");
  elLast.textContent = text;
}
function updateUI() {
  try { if (typeof syncDebugModeUI === "function") syncDebugModeUI(); } catch(e){}
  try {
    if (window.__coins && typeof window.__coins.getCoins === 'function') {
      const el = document.getElementById('coinsMain');
      if (el) el.textContent = String(window.__coins.getCoins());

      // Keep debug coin widget in sync too (if present)
      const dbgC = document.getElementById('dbgCoinsCurrent');
      if (dbgC) dbgC.textContent = String(window.__coins.getCoins());
    }
  } catch(e) {}
  if (elClues) elClues.textContent = String(clues.length);
  if (elPlayer) elPlayer.textContent = player ? `${player.lat.toFixed(6)}, ${player.lon.toFixed(6)}` : "not set";
  if (elTarget) {
    if (debugMode && target) {
      // Debug target label:
      // Always show a human-friendly name in the debug panel.
      // For Street View pano targets, show the nearest POI name.
      const isPano = (target && ((target.kind === 'pano') || !!target.pano_id || (target.id && String(target.id).startsWith('pano:'))));

      const ensureNearestPoi = () => {
        if (!isPano) return;
        if (target.debug_poi && target.debug_poi.name) return;

        const hav = function(a, b) {
          const R = 6371000;
          const toRad = (deg) => deg * Math.PI / 180;
          const dLat = toRad((+b.lat) - (+a.lat));
          const dLon = toRad((+b.lon) - (+a.lon));
          const lat1 = toRad(+a.lat);
          const lat2 = toRad(+b.lat);
          const s1 = Math.sin(dLat/2);
          const s2 = Math.sin(dLon/2);
          const h = s1*s1 + Math.cos(lat1)*Math.cos(lat2)*s2*s2;
          return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
        };

        // Prefer shared helper if available.
        let near = null;
        try {
          if (typeof __nearestPoiTo === 'function') near = __nearestPoiTo(target.lat, target.lon);
        } catch (e) { near = null; }

        // Fallback: scan POIS / window.POIS directly.
        if (!near || !near.poi) {
          const arr = (Array.isArray(POIS) && POIS.length) ? POIS : (Array.isArray(window.POIS) ? window.POIS : []);
          let best = null;
          let bestD = Infinity;
          for (let i = 0; i < arr.length; i++) {
            const p = arr[i];
            if (!p) continue;
            const plat = (typeof p.lat === 'number') ? p.lat : parseFloat(p.lat);
            const plon = (typeof p.lon === 'number') ? p.lon : parseFloat(p.lon);
            if (!isFinite(plat) || !isFinite(plon)) continue;
            const d = hav({ lat: target.lat, lon: target.lon }, { lat: plat, lon: plon });
            if (d < bestD) { bestD = d; best = p; }
          }
          if (best) near = { poi: best, dist_m: bestD };
        }

        if (near && near.poi) {
          target.debug_poi = { name: near.poi.name || 'Unnamed', lat: near.poi.lat, lon: near.poi.lon, dist_m: near.dist_m };
          target.debug_label = target.debug_label || target.debug_poi.name;
        }
      };

      try { ensureNearestPoi(); } catch (e) {}

      let txt = String(target.name || 'Unnamed');
      if (isPano) {
        const label = target.debug_label || (target.debug_poi && target.debug_poi.name) || null;
        const dm = (target.debug_poi && typeof target.debug_poi.dist_m === 'number' && isFinite(target.debug_poi.dist_m)) ? target.debug_poi.dist_m : null;
        if (label) txt = `${String(label)}${dm !== null ? ` (${dm.toFixed(0)}m)` : ''}`;
        else txt = `pano @ ${(+target.lat).toFixed(6)}, ${( +target.lon).toFixed(6)}`;
      }
      elTarget.textContent = txt;
    } else {
      elTarget.textContent = 'hidden';
    }
  }
  updateFogUI();

  // Phase 2: end-of-round UI state
  try {
    const over = (typeof window.isRoundOver === 'function') ? window.isRoundOver() : false;
    const btnLock = document.getElementById('btnLockGuess');
    const btnNR = document.getElementById('btnNewRound');
    if (btnLock) {
      btnLock.disabled = !!over;
      btnLock.classList.toggle('disabled', !!over);
    }
    if (btnNR) {
      btnNR.classList.toggle('hidden', !over);
      btnNR.disabled = !over;
    }

    // Disable tool buttons once guessed (allow viewing results/new round only).
    const lockSelectors = [
      '#qRadar','#qThermo','#qDir','#qLandmark','#qPhoto',
      '#radarMenu .menuBtn','#thermoMenu .menuBtn','#dirMenu .menuBtn','#landmarkMenu .menuBtn','#photoMenu .menuBtn'
    ];
    const nodes = document.querySelectorAll(lockSelectors.join(','));
    nodes.forEach(n => {
      if (!n) return;
      // Don't disable the round-action buttons
      if (n.id === 'btnLockGuess' || n.id === 'btnNewRound') return;
      if (over) {
        n.disabled = true;
        n.classList.add('disabled');
      } else {
        n.disabled = false;
        n.classList.remove('disabled');
      }
    });

    // Phase 3: coin affordability (only when not over)
    if (!over) {
      const coinGet = (window.__coins && typeof window.__coins.getCoins === 'function') ? window.__coins.getCoins : null;
      const coins = coinGet ? coinGet() : 0;
      const canAff = (window.__coins && typeof window.__coins.canAffordCoins === 'function') ? window.__coins.canAffordCoins : null;

      const affordMap = [
        { toolId: 'radar', selector: '[data-radar]', optAttr: 'data-radar' },
        { toolId: 'thermometer', selector: '[data-thermo]', optAttr: 'data-thermo' },
        { toolId: 'nsew', selector: '[data-dir]', optAttr: 'data-dir' },
        { toolId: 'landmark', selector: '[data-landmark]', optAttr: 'data-landmark' },
        { toolId: 'photo', selector: '[data-photo]', optAttr: 'data-photo' },
      ];
      affordMap.forEach(({toolId, selector, optAttr}) => {
        document.querySelectorAll(selector).forEach(btn => {
          if (!btn) return;
          const optId = btn.getAttribute(optAttr);
          let cost = null;
          try { if (typeof getToolCosts === 'function') cost = getToolCosts(toolId, optId); } catch(e) { cost = null; }

          // Photo tool: dynamic affordability.
          // - Starter is always free
          // - Extra photos become free to re-open after purchase
          // - Uncorrupt becomes free once applied
          if (toolId === 'photo') {
            const id = String(optId || '').toLowerCase();
            try {
              const rs = (typeof window.getRoundStateV1 === 'function') ? window.getRoundStateV1() : null;
              const photos = (rs && Array.isArray(rs.photos)) ? rs.photos : [];
              const owned = (k) => photos.some(p => p && String(p.kind) === String(k) && p.url);
              const uncor = !!(rs && rs.photosUncorrupted);

              if (id === 'starter') {
                cost = Object.assign({}, cost || {}, { coin_cost: 0, heat_cost: 0 });
              }
              if (id === 'near100' && owned('near100')) {
                cost = Object.assign({}, cost || {}, { coin_cost: 0, heat_cost: 0 });
              }
              if (id === 'near200' && owned('near200')) {
                cost = Object.assign({}, cost || {}, { coin_cost: 0, heat_cost: 0 });
              }
              if (id === 'uncorrupt' && uncor) {
                cost = Object.assign({}, cost || {}, { coin_cost: 0, heat_cost: 0 });
              }

              // Back-compat: older builds used 'glimpse' for starter.
              if (id === 'glimpse') {
                const isFree = (typeof window.isStreetViewGlimpseFreeForCurrentTarget === 'function')
                  ? window.isStreetViewGlimpseFreeForCurrentTarget()
                  : true;
                if (isFree) cost = Object.assign({}, cost || {}, { coin_cost: 0, heat_cost: 0 });
              }
            } catch(e) {}
          }

          const c = (cost && typeof cost.coin_cost === 'number' && isFinite(cost.coin_cost)) ? (cost.coin_cost|0) : 0;
          const ok = (c <= 0) ? true : (canAff ? canAff(c) : (coins >= c));
          btn.classList.toggle('unaffordable', !ok);
          // Only disable submenu tool buttons, not the top-level category icons.
          const isSub = btn.classList.contains('menuBtn') && (btn.hasAttribute('data-radar') || btn.hasAttribute('data-thermo') || btn.hasAttribute('data-dir') || btn.hasAttribute('data-landmark') || btn.hasAttribute('data-photo'));
          if (isSub) btn.disabled = !ok;
        });
      });
    }
  } catch(e) {}
}

function log(msg) {
  const t = new Date().toLocaleTimeString();
  if (!elLog) return;
  elLog.innerHTML = `<div style="margin-bottom:8px;"><span class="muted">[${t}]</span> ${msg}</div>` + elLog.innerHTML;
}

function syncDebugModeUI() {
  const el = document.getElementById("dbgMode");
  if (el) el.checked = !!debugMode;
}

// ---- HUD (timer + heat) ----
function pad2(n) { return String(n).padStart(2, "0"); }
function formatMMSS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${pad2(mm)}:${pad2(ss)}`;
}

function updateHUD() {
  try { if (typeof applyHeatDecay === "function") applyHeatDecay(Date.now()); } catch (e) {}
  try { if (typeof tickCurses === 'function') tickCurses(Date.now()); } catch (e) {}
  // Timer
  if (elTimerMain) {
    const start = (typeof roundStartMs === "number" && isFinite(roundStartMs)) ? roundStartMs : null;
    const elapsed = start ? (Date.now() - start) : 0;
    elTimerMain.textContent = formatMMSS(elapsed);
  }
  if (elTimerPenalty) {
    const p = (typeof penaltyMs === "number" && isFinite(penaltyMs)) ? penaltyMs : 0;
    elTimerPenalty.textContent = `+ ${formatMMSS(p)}`;
  }

  // Heat
  const heatEl = document.getElementById("heatWidget");
  if (heatEl) {
    const boxes = heatEl.querySelectorAll(".heatBox");
    const vertical = heatEl.classList.contains("heatWidget--vertical");
    // Inner fill uses continuous heatValue for smooth decay; the box glow uses locked-in heatLevel.
    const hv = (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : ((typeof heatLevel === "number" && isFinite(heatLevel)) ? heatLevel : 0);
    const L = (typeof heatLevel === "number" && isFinite(heatLevel)) ? (heatLevel | 0) : Math.floor(hv);
    boxes.forEach((box, i) => {
      const fill = box.querySelector(".heatBoxFill");
      const amt = Math.max(0, Math.min(1, hv - i)); // 0..1 in this segment
      if (fill) {
        const pct = `${Math.round(amt * 100)}%`;
        if (vertical) {
          fill.style.height = pct;
          fill.style.width = "100%";
        } else {
          fill.style.width = pct;
          fill.style.height = "100%";
        }
      }
      box.classList.toggle("is-full", amt >= 0.999);
      box.classList.toggle("is-partial", amt > 0.001 && amt < 0.999);
      box.classList.toggle("lit", (i + 1) <= Math.max(0, Math.min(5, L)));
    });
  }

  // Thermometer progress
  const tp = document.getElementById("thermoProgress");
  const tpFill = document.getElementById("thermoProgressFill");
  const tpText = document.getElementById("thermoProgressText");
  if (tp && tpFill && tpText) {
    if (thermoRun && typeof thermoRun.startMs === "number" && typeof thermoRun.durationMs === "number") {
      const endMs = thermoRun.startMs + thermoRun.durationMs;
      const now = Date.now();
      const pct = Math.max(0, Math.min(1, (now - thermoRun.startMs) / thermoRun.durationMs));
      tp.classList.remove("hidden");
      tpFill.style.width = `${Math.round(pct * 100)}%`;
      const remaining = Math.max(0, endMs - now);
      tpText.textContent = `Thermometer: ${formatMMSS(remaining)} remaining`;
    } else {
      tp.classList.add("hidden");
      tpFill.style.width = "0%";
      tpText.textContent = "Thermometer";
    }
  }

  // Debug: current heat display (if present)
  const dbgHeatCurrent = document.getElementById("dbgHeatCurrent");
  if (dbgHeatCurrent) {
    const v = (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : ((typeof heatLevel === "number" && isFinite(heatLevel)) ? heatLevel : 0);
    const L = (typeof heatLevel === "number" && isFinite(heatLevel)) ? (heatLevel | 0) : Math.floor(v);
    dbgHeatCurrent.textContent = `${Math.max(0, Math.min(5, v)).toFixed(2)}/5  (Level ${Math.max(0, Math.min(5, L))})`;
  }

}

// ---- Gameplay panel width helper ----
// The main tool menu is now icon-only and uses a tight 2-column grid.
// To avoid wasted space, we dynamically size the Gameplay panel based on
// whatever menu is currently visible. Submenus can be wider; the main menu
// should be compact.
function updateGameplayPanelWidth() {
  try {
    const panel = document.getElementById("panelGameplay");
    if (!panel) return;

    // Always let CSS handle width; we only toggle a compact mode for the main menu.
    panel.style.width = "";

    // On small screens the panel is effectively full-width; keep default sizing.
    const small = window.matchMedia && window.matchMedia("(max-width: 420px)").matches;
    if (small) {
      panel.classList.remove("panel--compact");
      return;
    }

    const menus = [
      document.getElementById("gameMenu"),
      document.getElementById("radarMenu"),
      document.getElementById("thermoMenu"),
      document.getElementById("dirMenu"),
      document.getElementById("landmarkMenu"),
      document.getElementById("photoMenu"),
    ].filter(Boolean);

    // Find the currently visible menu element
    const visible = menus.find(m => !m.classList.contains("hidden")) || menus[0];
    if (!visible) return;

    // Compact mode for the main icon-only menu.
    const isMain = (visible && visible.id === "gameMenu");
    panel.classList.toggle("panel--compact", !!isMain);
  } catch (e) {
    // ignore
  }
}

// Called by state when heatLevel changes (either by tool use or decay).
// Adds a quick pulse/glow so the player notices the new tier.
function onHeatLevelChanged(prevLevel, newLevel, reason) {
  try {
    const heatEl = document.getElementById("heatWidget");
    if (!heatEl) return;

    const dir = (newLevel > prevLevel) ? "up" : "down";

    // Pulse the whole widget
    heatEl.classList.remove("heatPulseUp", "heatPulseDown");
    // Force reflow so animation restarts
    // eslint-disable-next-line no-unused-expressions
    heatEl.offsetWidth;
    heatEl.classList.add(dir === "up" ? "heatPulseUp" : "heatPulseDown");

    // Highlight newly lit boxes on level-up
    if (dir === "up") {
      const boxes = heatEl.querySelectorAll(".heatBox");
      for (let i = prevLevel; i < newLevel && i < boxes.length; i++) {
        const b = boxes[i];
        b.classList.remove("heatBoxPop");
        // eslint-disable-next-line no-unused-expressions
        b.offsetWidth;
        b.classList.add("heatBoxPop");
      }
    }

    const clearPulse = () => {
      heatEl.classList.remove("heatPulseUp", "heatPulseDown");
      heatEl.removeEventListener("animationend", clearPulse);
    };
    heatEl.addEventListener("animationend", clearPulse);
  } catch (e) {
    // ignore
  }
}

let __hudTicker = null;
function startHUDTicker() {
  if (__hudTicker) return;
  __hudTicker = setInterval(() => {
    try { updateHUD(); } catch (e) {}
  }, 250);
  document.addEventListener("visibilitychange", () => {
    try { updateHUD(); } catch (e) {}
  });
}

function heatConsequencesText(level) {
  // Placeholder consequences for now (we'll refine once tools/curses are locked).
  const L = Math.max(0, Math.min(5, Math.floor((typeof level === "number" && isFinite(level)) ? level : 0)));
  if (L === 0) return "All good — nothing is tracking you yet.";
  if (L === 1) return "Mild attention — expect slightly pricier questions.";
  if (L === 2) return "Warm — penalties start to bite and some tools may get riskier.";
  if (L === 3) return "Hot — increased penalty pressure and higher chance of a bad draw.";
  if (L === 4) return "Very hot — mistakes get punished; cheap options dry up.";
  return "MAX HEAT — you're basically glowing. Expect the harsh stuff.";
}

function showHeatToast() {
  const hv = (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : 0;
  const L = Math.max(0, Math.min(5, heatLevel | 0));

  // Decay model: dH/dt = -(base + perHeat*H)  =>
  // H(t) = (H0 + b/a) * exp(-a t) - b/a
  // Solve for t when H(t)=T: t = (1/a) * ln((H0 + b/a) / (T + b/a))
  const base = (typeof HEAT_DECAY_BASE_PER_SEC === "number" && isFinite(HEAT_DECAY_BASE_PER_SEC)) ? HEAT_DECAY_BASE_PER_SEC : 0.0015;
  const perHeat = (typeof HEAT_DECAY_PER_HEAT_PER_SEC === "number" && isFinite(HEAT_DECAY_PER_HEAT_PER_SEC)) ? HEAT_DECAY_PER_HEAT_PER_SEC : 0.0025;

  function timeToHeatTargetSeconds(H0, T) {
    const h0 = Math.max(0, Math.min(5, H0));
    const t = Math.max(0, Math.min(5, T));
    if (h0 <= t) return 0;
    if (perHeat <= 0) {
      // Linear fallback (shouldn't happen with our defaults)
      const rate = Math.max(1e-9, base);
      return (h0 - t) / rate;
    }
    const k = base / perHeat;
    const num = (h0 + k);
    const den = (t + k);
    if (den <= 0 || num <= 0) return 0;
    return (1 / perHeat) * Math.log(num / den);
  }

  const lines = [];
  // Countdown to lower levels (hysteresis: level drops at (level-1).0)
  if (L > 0 && hv > 0) {
    const targets = [];
    for (let lvl = L - 1; lvl >= 0; lvl--) targets.push(lvl);
    for (const tgt of targets) {
      const secs = timeToHeatTargetSeconds(hv, tgt);
      lines.push(`↓ Level ${tgt} in <b>${formatMMSS(secs * 1000)}</b> (at ${tgt.toFixed(1)})`);
    }
  } else {
    lines.push("No cooldown pending.");
  }

  const msg = `
    <div style="display:flex; align-items:baseline; gap:10px;">
      <div style="font-weight:800; letter-spacing:.2px;">🔥 Heat Level ${L}/5</div>
      <div class="muted" style="font-variant-numeric: tabular-nums;">${hv.toFixed(2)}/5</div>
    </div>
    <div class="muted" style="margin-top:6px;">${heatConsequencesText(L)}</div>
    <div style="margin-top:8px; line-height:1.25;">${lines.map(s => `<div>${s}</div>`).join("")}</div>
  `;

  // Neutral toast: use "good" styling so it doesn't look like an answer verdict.
  if (typeof showToast === "function") showToast(msg, true);
}


// ---- Curses UI ----
// Render active curses managed by js/19_curses.js

function __getActiveCursesForUI() {
  try { return (typeof window.getActiveCurses === "function") ? window.getActiveCurses() : []; } catch (e) { return []; }
}

function updateCursesButton(){
  const btn = document.getElementById('btnCurses');
  if (!btn) return;
  const list = __getActiveCursesForUI();
  const isActive = Array.isArray(list) && list.length > 0;
  btn.classList.toggle('isActive', isActive);
  btn.classList.toggle('isInactive', !isActive);
}

function __fmtRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function updateCursesPanel(){
  const empty = document.getElementById('cursesEmpty');
  const ul = document.getElementById('cursesList');
  if (!empty || !ul) return;

  const list = __getActiveCursesForUI();

  if (!Array.isArray(list) || list.length === 0) {
    empty.classList.remove('hidden');
    ul.classList.add('hidden');
    ul.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  ul.classList.remove('hidden');

  ul.innerHTML = list.map(c => {
    const name = (c && c.name) ? String(c.name) : String((c && c.id) || 'Curse');
    const desc = (c && c.description) ? String(c.description) : '';
    let left = 0;
    try { left = (typeof window.__msLeftOnCurse === 'function') ? window.__msLeftOnCurse(c) : 0; } catch (e) { left = 0; }
    const t = __fmtRemaining(left);
    const d = desc ? `<div class="muted" style="margin-top:2px;">${desc}</div>` : '';
    return `<li><div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
      <span>${name}</span><span class="muted">${t}</span>
    </div>${d}</li>`;
  }).join('');
}

// Expose for curses system.
window.updateCursesButton = updateCursesButton;
window.updateCursesPanel = updateCursesPanel;

// Default render.
try { updateCursesButton(); updateCursesPanel(); } catch (e) {}