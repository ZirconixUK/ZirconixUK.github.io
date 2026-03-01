// ---- DOM ----
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d", { alpha: true });

const elLog = document.getElementById("log");
const elPlayer = document.getElementById("playerOut");
const elTarget = document.getElementById("targetOut");
const elClues = document.getElementById("cluesOut");
const elReveal = document.getElementById("dbgReveal");
const elBBox = document.getElementById("dbgBBox");
const elLast = document.getElementById("lastAnswer");

const elRadarPreset = document.getElementById("radarPreset");
const elThickness = document.getElementById("thickness");
const elBearingBuckets = document.getElementById("bearingBuckets");
const elDistBucket = document.getElementById("distBucket");
const elFogOpacity = document.getElementById("fogOpacity");
const elFogOpacityOut = document.getElementById("fogOpacityOut");




// Bind UI event listeners (called from boot after all functions are defined).
function bindUI() {
  document.getElementById("btnGeo").addEventListener("click", enableGeolocation);
  document.getElementById("btnCenter").addEventListener("click", centerOnPlayer);
  document.getElementById("btnClear").addEventListener("click", clearClues);
  document.getElementById("btnNewTarget").addEventListener("click", pickNewTarget);
  document.getElementById("btnRadar").addEventListener("click", askRadar);
  document.getElementById("btnNorth").addEventListener("click", () => askDirection("N"));
  document.getElementById("btnSouth").addEventListener("click", () => askDirection("S"));
  document.getElementById("btnEast").addEventListener("click", () => askDirection("E"));
  document.getElementById("btnWest").addEventListener("click", () => askDirection("W"));
  document.getElementById("btnQuadrant").addEventListener("click", askQuadrant);
  document.getElementById("btnBearing").addEventListener("click", askBearing);
  document.getElementById("btnDistance").addEventListener("click", askDistanceBucket);
  document.getElementById("btnThermo").addEventListener("click", askThermometer);
  elReveal.addEventListener("change", draw);
  elBBox.addEventListener("change", draw);
  elFogOpacity.addEventListener("input", () => { updateFogUI(); draw(); });
}
window.bindUI = bindUI;
