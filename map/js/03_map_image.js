// ---- Leaflet map (replaces map.png) ----
//
// This refactor keeps the existing "allowedWorld" + compositing fog pipeline,
// but swaps the base layer to a Leaflet map underneath the overlay canvas.
//
// Key concepts:
// - We maintain a fixed "fog world" coordinate space in Leaflet CRS pixels at FOG_ZF.
// - All clues are stored in that fog-world pixel space (x,y,r, etc), same as before.
// - To render, we draw fogScreen on the overlay canvas, transforming fog-world -> screen
//   using Leaflet's pixel origin + zoom scale.

var mapReady = false;
var mapError = null;

// Leaflet globals
var leafletMap = null;

// Fog/world coordinate system settings
const FOG_ZF = 18;              // fixed reference zoom for fog geometry storage
let FOG_TL = null;              // Leaflet global pixel coords at FOG_ZF for the top-left of our bounds
let FOG_W = 0, FOG_H = 0;       // fog-world canvas size in pixels at FOG_ZF

// World-size mask used to cut the fog (opaque pixels = allowed region)
const allowedWorld = document.createElement("canvas");
const allowedCtx = allowedWorld.getContext("2d", { alpha: true });

// Screen-sized fog layer so we can punch holes without erasing the map
const fogScreen = document.createElement("canvas");
const fogScreenCtx = fogScreen.getContext("2d", { alpha: true });

// Expose for other modules (keeps existing names)
window.leafletMap = leafletMap;
window.allowedWorld = allowedWorld;
window.allowedCtx = allowedCtx;
window.fogScreen = fogScreen;
window.fogScreenCtx = fogScreenCtx;
window.FOG_ZF = FOG_ZF;

function initLeafletMap() {
  try {
    const el = document.getElementById("leafletMap");
    if (!el) throw new Error("#leafletMap not found in DOM");

    // Performance: prefer Canvas rendering for vector layers (fog polygons) to avoid SVG lag
    leafletMap = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    }).setView([53.4075, -2.9919], 16);

    // Move zoom controls away from the debug button (top-left)
    L.control.zoom({ position: "bottomleft" }).addTo(leafletMap);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(leafletMap);

    window.leafletMap = leafletMap;

    // Establish bounds for fog-world based on existing config BBOX (same area as map.png build).
    // Expect BBOX in 00_config.js as {nw:{lat,lon}, se:{lat,lon}}.
    const nw = L.latLng(BBOX.nw.lat, BBOX.nw.lon);
    const se = L.latLng(BBOX.se.lat, BBOX.se.lon);

    FOG_TL = leafletMap.project(nw, FOG_ZF); // global pixel coords at ref zoom
    const br = leafletMap.project(se, FOG_ZF);

    FOG_W = Math.max(1, Math.round(br.x - FOG_TL.x));
    FOG_H = Math.max(1, Math.round(br.y - FOG_TL.y));

    allowedWorld.width = FOG_W;
    allowedWorld.height = FOG_H;

    window.FOG_TL = FOG_TL;
    window.FOG_W = FOG_W;
    window.FOG_H = FOG_H;

    mapReady = true;


    if (typeof window.__onMapLoaded === "function") window.__onMapLoaded();
    else if (typeof draw === "function") draw();
  } catch (e) {
    mapError = e;
    mapReady = false;
    console.error(e);
  }
}

// Kick off after DOM is ready (boot will also run, but this is safe)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLeafletMap, { once: true });
} else {
  initLeafletMap();
}