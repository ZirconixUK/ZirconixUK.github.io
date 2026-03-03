// ---- UI helpers ----
function setLast(text, ok) {
  if (!elLast) return;
  elLast.className = "pill " + (ok ? "ok" : "no");
  elLast.textContent = text;
}
function updateUI() {
  try { if (typeof syncDebugModeUI === "function") syncDebugModeUI(); } catch(e){}
  if (elClues) elClues.textContent = String(clues.length);
  if (elPlayer) elPlayer.textContent = player ? `${player.lat.toFixed(6)}, ${player.lon.toFixed(6)}` : "not set";
  if (elTarget) elTarget.textContent = (debugMode && target) ? target.name : "hidden";
  updateFogUI();
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
    // Inner fill uses continuous heatValue for smooth decay; the box glow uses locked-in heatLevel.
    const hv = (typeof heatValue === "number" && isFinite(heatValue)) ? heatValue : ((typeof heatLevel === "number" && isFinite(heatLevel)) ? heatLevel : 0);
    const L = (typeof heatLevel === "number" && isFinite(heatLevel)) ? (heatLevel | 0) : Math.floor(hv);
    boxes.forEach((box, i) => {
      const fill = box.querySelector(".heatBoxFill");
      const amt = Math.max(0, Math.min(1, hv - i)); // 0..1 in this segment
      if (fill) fill.style.width = `${Math.round(amt * 100)}%`;
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
