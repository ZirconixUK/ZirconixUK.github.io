// ---- Boot ----

// Allow map image loader to notify us when it finishes (including cached loads).
window.__onMapLoaded = function () {
  try {
    if (!mapReady) return;
    // Fit view once map dimensions are known
    if (typeof fitViewToMap === "function") fitViewToMap();
    if (typeof updateUI === "function") updateUI();
    if (typeof draw === "function") draw();
  } catch (e) {
    console.error("onMapLoaded error", e);
  }
};

window.addEventListener("resize", () => {
  if (!mapReady) return;
  if (typeof fitViewToMap === "function") fitViewToMap();
  if (typeof draw === "function") draw();
});

(async function init() {
  updateFogUI();
  await loadPois();
  pickNewTarget(false);
  updateUI();
  log("Ready. Tip: on mobile, use HTTPS or localhost for geolocation.");
  // Always render once so we show either map, loading, or errors.
  if (typeof draw === "function") draw();
})();

// After all scripts loaded, bind UI handlers.
if (typeof window.bindUI === "function") {
  window.bindUI();
}
