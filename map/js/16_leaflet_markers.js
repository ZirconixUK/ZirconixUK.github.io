// ---- Leaflet markers for player + target ----
// Keeps player/target anchored to geography (no pixel drift / vanish on pan).

let leafletTargetMarker = null;
let leafletPlayerMarker = null;
let leafletPlayerAccuracyCircle = null;
let leafletMarkersLayer = null;

// Debug: show all POI pins (independent of target/player)
let leafletPoiLayer = null;
let leafletPoiMarkers = [];
let showAllPoiPins = false;

function ensureLeafletMarkersLayer() {
  if (!window.leafletMap) return false;
  if (!leafletMarkersLayer) {
    leafletMarkersLayer = L.layerGroup().addTo(window.leafletMap);
  }
  return true;
}

function ensureLeafletPoiLayer() {
  if (!window.leafletMap) return false;
  if (!leafletPoiLayer) {
    leafletPoiLayer = L.layerGroup().addTo(window.leafletMap);
  }
  return true;
}

function clearAllPoiPins() {
  try {
    if (!leafletPoiLayer) return;
    leafletPoiMarkers.forEach(m => {
      try { leafletPoiLayer.removeLayer(m); } catch(e) {}
    });
    leafletPoiMarkers = [];
  } catch (e) {
    leafletPoiMarkers = [];
  }
}

function rebuildAllPoiPins() {
  if (!showAllPoiPins) return;
  if (!ensureLeafletPoiLayer()) return;
  clearAllPoiPins();

  const list = Array.isArray(window.POIS) ? window.POIS : [];
  if (!list.length) return;

  // Lightweight pins for every POI (debug visibility)
  for (const p of list) {
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    const ll = L.latLng(p.lat, p.lon);
    const m = L.circleMarker(ll, {
      radius: 4,
      weight: 1,
      fillOpacity: 0.75,
      interactive: false,
    });
    // Subtle style so target/player stand out.
    m.setStyle({ color: "#000000", fillColor: "#2b6cff" });
    m.addTo(leafletPoiLayer);
    leafletPoiMarkers.push(m);
  }
}

function setAllPoiPinsVisible(on) {
  showAllPoiPins = !!on;
  if (!showAllPoiPins) {
    clearAllPoiPins();
    return;
  }
  rebuildAllPoiPins();
}

function syncLeafletTargetMarker() {
  if (!ensureLeafletMarkersLayer()) return;
  if (!target) {
    if (leafletTargetMarker) { leafletMarkersLayer.removeLayer(leafletTargetMarker); leafletTargetMarker = null; }
    return;
  }
  const ll = L.latLng(target.lat, target.lon);
  if (!leafletTargetMarker) {
    // Red target marker (debug-only)
    leafletTargetMarker = L.circleMarker(ll, {
      radius: 8,
      weight: 2,
      fillOpacity: 0.95,
      interactive: false,
    });
    // Set colours (explicit, small & clear)
    leafletTargetMarker.setStyle({ color: "#ffffff", fillColor: "#d22f2f" });
    if (debugMode) leafletTargetMarker.addTo(leafletMarkersLayer);
  } else {
    leafletTargetMarker.setLatLng(ll);
    if (debugMode && !leafletMarkersLayer.hasLayer(leafletTargetMarker)) leafletTargetMarker.addTo(leafletMarkersLayer);
    if (!debugMode && leafletMarkersLayer.hasLayer(leafletTargetMarker)) leafletMarkersLayer.removeLayer(leafletTargetMarker);
  }
}

function syncLeafletPlayerMarker() {
  if (!ensureLeafletMarkersLayer()) return;
  if (!player) {
    if (leafletPlayerMarker) { leafletMarkersLayer.removeLayer(leafletPlayerMarker); leafletPlayerMarker = null; }
    if (leafletPlayerAccuracyCircle) { leafletMarkersLayer.removeLayer(leafletPlayerAccuracyCircle); leafletPlayerAccuracyCircle = null; }
    return;
  }
  const ll = L.latLng(player.lat, player.lon);
  // Accuracy circle intentionally disabled (keeps UI cleaner).
  const acc = null;

  if (!leafletPlayerMarker) {
    leafletPlayerMarker = L.circleMarker(ll, {
      radius: 7,
      weight: 2,
      fillOpacity: 0.9,
      interactive: false,
    }).addTo(leafletMarkersLayer);
  } else {
    leafletPlayerMarker.setLatLng(ll);
    if (!leafletMarkersLayer.hasLayer(leafletPlayerMarker)) leafletPlayerMarker.addTo(leafletMarkersLayer);
  }

  if (false) {
    if (!leafletPlayerAccuracyCircle) {
      leafletPlayerAccuracyCircle = L.circle(ll, {
        radius: acc,
        weight: 1,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(leafletMarkersLayer);
    } else {
      leafletPlayerAccuracyCircle.setLatLng(ll);
      leafletPlayerAccuracyCircle.setRadius(acc);
      if (!leafletMarkersLayer.hasLayer(leafletPlayerAccuracyCircle)) leafletPlayerAccuracyCircle.addTo(leafletMarkersLayer);
    }
  } else {
    if (leafletPlayerAccuracyCircle) { leafletMarkersLayer.removeLayer(leafletPlayerAccuracyCircle); leafletPlayerAccuracyCircle = null; }
  }
}

// Keep in sync when debugMode toggles (called from UI helpers)
function refreshLeafletMarkersVisibility() {
  syncLeafletTargetMarker();
  syncLeafletPlayerMarker();
  // POI pins are independent of debugMode; refresh if enabled.
  try { rebuildAllPoiPins(); } catch(e) {}
}

// Expose functions globally so other modules can call them
window.syncLeafletTargetMarker = syncLeafletTargetMarker;

// ---- Phase 2: reveal overlay (guess → target) ----
let __revealLayer = null;

function clearRevealOverlay(){
  try {
    if (__revealLayer && window.leafletMap) window.leafletMap.removeLayer(__revealLayer);
  } catch(e) {}
  __revealLayer = null;
}

function showRevealOverlay({ guess, target }){
  try {
    if (!window.leafletMap || !guess || !target) return;
    clearRevealOverlay();
    const g = L.latLng(+guess.lat, +guess.lon);
    const t = L.latLng(+target.lat, +target.lon);
    const grp = L.layerGroup();
    L.polyline([g, t], { weight: 4, opacity: 0.85 }).addTo(grp);
    L.circleMarker(g, { radius: 7, weight: 2, opacity: 0.9, fillOpacity: 0.5 }).addTo(grp);
    L.circleMarker(t, { radius: 7, weight: 2, opacity: 0.9, fillOpacity: 0.5 }).addTo(grp);
    grp.addTo(window.leafletMap);
    __revealLayer = grp;
  } catch(e) {}
}

window.showRevealOverlay = showRevealOverlay;
window.clearRevealOverlay = clearRevealOverlay;
window.syncLeafletPlayerMarker = syncLeafletPlayerMarker;
window.refreshLeafletMarkersVisibility = refreshLeafletMarkersVisibility;

// POI pins
window.setAllPoiPinsVisible = setAllPoiPinsVisible;
window.refreshAllPoiPins = rebuildAllPoiPins;
