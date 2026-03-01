// ---- POIs ----
const DEFAULT_POIS = [
  { name: "Liverpool Lime Street Station", lat: 53.4073, lon: -2.9777 },
  { name: "St George's Hall",             lat: 53.4084, lon: -2.9801 },
  { name: "Royal Albert Dock",            lat: 53.4009, lon: -2.9943 },
];

let POIS = DEFAULT_POIS;

async function loadPois() {
  const candidates = ["./POI.json", "./pois.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        POIS = data;
        log(`📌 Loaded ${POIS.length} POIs from ${url}`);
        return;
      }
    } catch {}
  }
  log(`📌 Using built-in POIs (couldn't load POI.json/pois.json)`);
}
