// ---- Map image ----

// Global map state
var mapReady = false;
var mapError = null;

const mapImg = new Image();
mapImg.decoding = "async";

mapImg.addEventListener("load", () => {
  mapReady = true;
  // Notify boot (handles fitViewToMap + render)
  if (typeof window.__onMapLoaded === "function") window.__onMapLoaded();
  else if (typeof draw === "function") draw();
});

mapImg.addEventListener("error", (e) => {
  mapError = "Could not load ./map.png (check filename + path and casing)";
  console.error(mapError, e);
  if (typeof draw === "function") draw();
});

// Set src AFTER listeners
mapImg.src = "./map.png";

// Cached-load fallback
if (mapImg.complete && mapImg.naturalWidth > 0) {
  mapReady = true;
  if (typeof window.__onMapLoaded === "function") window.__onMapLoaded();
}

// World-size mask used to cut the fog (opaque pixels = allowed region)
const allowedWorld = document.createElement("canvas");
const allowedCtx = allowedWorld.getContext("2d", { alpha: true });

// Screen-sized fog layer so we can punch holes without erasing the map
const fogScreen = document.createElement("canvas");
const fogScreenCtx = fogScreen.getContext("2d", { alpha: true });
