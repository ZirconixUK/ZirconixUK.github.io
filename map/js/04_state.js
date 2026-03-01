// ---- State ----
let player = null;  // {lat, lon}
let target = null;  // {name, lat, lon}
const clues = [];   // constraints to intersect
let thermoBaseline = null;

function fogAlpha() {
  const v = parseFloat(elFogOpacity?.value ?? "0.55");
  return Math.max(0, Math.min(0.95, isNaN(v) ? 0.55 : v));
}
function updateFogUI() {
  if (elFogOpacityOut) elFogOpacityOut.textContent = `${Math.round(fogAlpha() * 100)}%`;
}
