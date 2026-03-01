// ---- UI helpers ----
function setLast(text, ok) {
  if (!elLast) return;
  elLast.className = "pill " + (ok ? "ok" : "no");
  elLast.textContent = text;
}
function updateUI() {
  elClues.textContent = String(clues.length);
  elPlayer.textContent = player ? `${player.lat.toFixed(6)}, ${player.lon.toFixed(6)}` : "not set";
  elTarget.textContent = (elReveal.checked && target) ? target.name : "hidden";
  updateFogUI();
}

function log(msg) {
  const t = new Date().toLocaleTimeString();
  elLog.innerHTML = `<div style="margin-bottom:8px;"><span class="muted">[${t}]</span> ${msg}</div>` + elLog.innerHTML;
}
