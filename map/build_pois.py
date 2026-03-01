import json
import time
import urllib.parse
import urllib.request

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Liverpool city centre-ish bounding box (south, west, north, east)
# Tweak these as you like.
BBOX = (53.3920, -3.0100, 53.4245, -2.9600)

# Helper: normalize Overpass elements to a point
def element_to_point(el):
    if el["type"] == "node":
        return el.get("lat"), el.get("lon")
    center = el.get("center")
    if center:
        return center.get("lat"), center.get("lon")
    return None, None

# Map OSM tags -> your categories
def categorise(tags):
    cats = set()

    amenity = tags.get("amenity")
    tourism = tags.get("tourism")
    historic = tags.get("historic")
    leisure = tags.get("leisure")
    building = tags.get("building")
    man_made = tags.get("man_made")
    public_transport = tags.get("public_transport")
    railway = tags.get("railway")
    waterway = tags.get("waterway")

    # Exclusions: retail-ish stuff (expand as needed)
    if tags.get("shop"):
        return None  # skip
    if amenity in {"fast_food", "restaurant", "cafe", "bar"}:
        # You said no shops; I’m also excluding these by default.
        # Keep pubs though.
        if amenity != "pub":
            return None

    # Core categories
    if amenity == "pub":
        cats.add("pub")

    if tourism in {"museum", "gallery"}:
        cats.add("museum_gallery")

    if historic in {"memorial", "monument", "wayside_cross", "milestone"}:
        cats.add("monument_memorial")

    # Plaques are messy in OSM; common tags you may see:
    # memorial=plaque, historic=memorial + memorial=plaque, etc.
    if tags.get("memorial") == "plaque" or tags.get("historic") == "memorial" and tags.get("memorial") == "plaque":
        cats.add("historic_plaque")

    # Big notable civic/religious/transport/waterfront/public spaces
    if amenity in {"townhall", "courthouse"}:
        cats.add("civic")

    if building in {"cathedral", "church", "chapel"} or amenity in {"place_of_worship"}:
        cats.add("religious")

    if leisure in {"park", "garden"}:
        cats.add("park_public_space")

    if railway in {"station"} or public_transport in {"station"}:
        cats.add("transport_hub")

    if waterway or man_made in {"pier"}:
        cats.add("waterfront")

    # Architecture / landmark heuristics
    if building in {"historic", "civic", "cathedral", "church"}:
        cats.add("architecture")

    # If we got *something* but it’s still empty, don’t invent a category
    if not cats:
        return None

    return sorted(cats)

def fetch_overpass(query, sleep=1.0):
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": "POI-Builder/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = resp.read()
    time.sleep(sleep)  # be polite to Overpass
    return json.loads(payload)

def main():
    south, west, north, east = BBOX

    # Pull a “significant places” bundle. Add/remove blocks as you like.
    overpass_query = f"""
    [out:json][timeout:40];
    (
      node["amenity"="pub"]({south},{west},{north},{east});
      way["amenity"="pub"]({south},{west},{north},{east});
      relation["amenity"="pub"]({south},{west},{north},{east});

      node["tourism"="museum"]({south},{west},{north},{east});
      way["tourism"="museum"]({south},{west},{north},{east});
      relation["tourism"="museum"]({south},{west},{north},{east});

      node["tourism"="gallery"]({south},{west},{north},{east});
      way["tourism"="gallery"]({south},{west},{north},{east});
      relation["tourism"="gallery"]({south},{west},{north},{east});

      node["historic"="memorial"]({south},{west},{north},{east});
      way["historic"="memorial"]({south},{west},{north},{east});
      relation["historic"="memorial"]({south},{west},{north},{east});

      node["leisure"="park"]({south},{west},{north},{east});
      way["leisure"="park"]({south},{west},{north},{east});
      relation["leisure"="park"]({south},{west},{north},{east});

      node["railway"="station"]({south},{west},{north},{east});
      way["railway"="station"]({south},{west},{north},{east});
      relation["railway"="station"]({south},{west},{north},{east});

      node["man_made"="pier"]({south},{west},{north},{east});
      way["man_made"="pier"]({south},{west},{north},{east});
      relation["man_made"="pier"]({south},{west},{north},{east});

      node["amenity"="townhall"]({south},{west},{north},{east});
      way["amenity"="townhall"]({south},{west},{north},{east});
      relation["amenity"="townhall"]({south},{west},{north},{east});

      node["amenity"="place_of_worship"]({south},{west},{north},{east});
      way["amenity"="place_of_worship"]({south},{west},{north},{east});
      relation["amenity"="place_of_worship"]({south},{west},{north},{east});
    );
    out center tags;
    """

    raw = fetch_overpass(overpass_query)
    elements = raw.get("elements", [])

    pois = []
    seen = set()

    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue

        categories = categorise(tags)
        if categories is None:
            continue

        lat, lon = element_to_point(el)
        if lat is None or lon is None:
            continue

        osm_key = f'{el["type"]}/{el["id"]}'
        if osm_key in seen:
            continue
        seen.add(osm_key)

        poi = {
            "id": f"osm_{el['type']}_{el['id']}",
            "name": name,
            "lat": lat,
            "lon": lon,
            "osm": {"type": el["type"], "id": el["id"]},
            "categories": categories,
            # Store raw tags if you want maximum flexibility (you can prune later)
            "osm_tags": tags,
        }

        # Optional “game tags” you can compute later.
        poi["tags"] = []
        if "historic_plaque" in categories:
            poi["tags"].append("text_present")
        if "pub" in categories or "museum_gallery" in categories or "landmark" in categories:
            poi["tags"].append("high_visibility")

        pois.append(poi)

    pois.sort(key=lambda p: p["name"].lower())

    with open("POI.json", "w", encoding="utf-8") as f:
        json.dump(pois, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(pois)} POIs to POI.json")

if __name__ == "__main__":
    main()