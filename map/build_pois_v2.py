import json
import time
import urllib.parse
import urllib.request

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# === Tile-aligned BBOX matching your current map.png ===
WEST  = -3.0047607421875
SOUTH = 53.389880751560305
EAST  = -2.95806884765625
NORTH = 53.414443210551035

# Overpass bbox order: (south, west, north, east)
BBOX = (SOUTH, WEST, NORTH, EAST)

USER_AGENT = "MapGamePOIBuilder/1.0 (personal use)"

# ---------------------------
# Geometry helpers
# ---------------------------
def element_to_point(el):
    if el["type"] == "node":
        return el.get("lat"), el.get("lon")
    center = el.get("center")
    if center:
        return center.get("lat"), center.get("lon")
    return None, None

# ---------------------------
# Categorisation
# ---------------------------
def categorise(tags):
    """
    Returns a list of categories describing what the POI is.
    This is for filtering later (including "exclude in curated").
    """
    cats = set()

    amenity = tags.get("amenity")
    tourism = tags.get("tourism")
    historic = tags.get("historic")
    leisure = tags.get("leisure")
    building = tags.get("building")
    man_made = tags.get("man_made")
    railway = tags.get("railway")
    public_transport = tags.get("public_transport")
    memorial = tags.get("memorial")
    shop = tags.get("shop")

    # Gameplay core
    if amenity == "pub":
        cats.add("pub")

    if tourism in {"museum", "gallery"}:
        cats.add("museum_gallery")

    if historic in {"monument", "memorial", "wayside_cross", "milestone"}:
        cats.add("monument_memorial")

    # Plaques (often: memorial=plaque)
    if memorial == "plaque":
        cats.add("historic_plaque")

    if tourism in {"attraction", "viewpoint"}:
        cats.add("landmark")

    if leisure in {"park", "garden", "common"}:
        cats.add("park_public_space")

    if railway == "station" or public_transport == "station":
        cats.add("transport_hub")

    if amenity in {"townhall", "courthouse", "library"}:
        cats.add("civic")

    if amenity == "place_of_worship" or building in {"cathedral", "church", "chapel"}:
        cats.add("religious")

    if man_made in {"pier"}:
        cats.add("waterfront")

    if building in {"cathedral", "church", "chapel", "civic", "public", "historic"}:
        cats.add("architecture")

    # “Include everything” categories (these will be excluded from curated)
    if shop:
        cats.add("shop")

    if tourism in {"hotel", "hostel", "motel", "guest_house"}:
        cats.add("accommodation")

    if amenity in {"restaurant", "fast_food", "cafe", "bar", "food_court"}:
        cats.add("food_drink")

    # If nothing matched, we still may want to keep it in POI.json if it’s named.
    return sorted(cats)

def game_tags_from(categories, tags):
    """
    Optional "properties" that help puzzle selection, etc.
    """
    t = []
    if "historic_plaque" in categories:
        t.append("text_present")
    # Add more heuristics later (high_visibility, night_friendly etc.)
    return t

def is_curated(categories):
    """
    Define what stays in POI_curated.json.

    Rule:
    - Keep: pubs, museums/galleries, landmarks, plaques, monuments, architecture, civic, religious, parks, waterfront, transport hubs
    - Exclude: shop, accommodation, food_drink (unless it’s a pub, which is already included)
    """
    excluded = {"shop", "accommodation", "food_drink"}
    if any(c in excluded for c in categories):
        # But allow pubs even though they’re "food/drink" in real life; we track pub separately.
        if "pub" in categories and categories == ["food_drink", "pub"]:
            return True
        # More generally: if it's a pub, keep it even if food_drink is also present
        if "pub" in categories:
            return True
        return False

    # Keep only if it has at least one “gameplay-relevant” category
    keepers = {
        "pub",
        "museum_gallery",
        "landmark",
        "historic_plaque",
        "monument_memorial",
        "architecture",
        "civic",
        "religious",
        "park_public_space",
        "waterfront",
        "transport_hub",
    }
    return any(c in keepers for c in categories)

# ---------------------------
# Overpass fetch
# ---------------------------
def fetch_overpass(query, sleep=1.0):
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=data,
        headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        payload = resp.read()
    time.sleep(sleep)
    return json.loads(payload)

def build_query(south, west, north, east):
    """
    Pull a broad-but-reasonable set of named POIs. You can expand later.
    """
    return f"""
    [out:json][timeout:80];
    (
      // Pubs
      node["amenity"="pub"]({south},{west},{north},{east});
      way["amenity"="pub"]({south},{west},{north},{east});
      relation["amenity"="pub"]({south},{west},{north},{east});

      // Museums & galleries
      node["tourism"="museum"]({south},{west},{north},{east});
      way["tourism"="museum"]({south},{west},{north},{east});
      relation["tourism"="museum"]({south},{west},{north},{east});

      node["tourism"="gallery"]({south},{west},{north},{east});
      way["tourism"="gallery"]({south},{west},{north},{east});
      relation["tourism"="gallery"]({south},{west},{north},{east});

      // Attractions / viewpoints
      node["tourism"="attraction"]({south},{west},{north},{east});
      way["tourism"="attraction"]({south},{west},{north},{east});
      relation["tourism"="attraction"]({south},{west},{north},{east});

      node["tourism"="viewpoint"]({south},{west},{north},{east});
      way["tourism"="viewpoint"]({south},{west},{north},{east});
      relation["tourism"="viewpoint"]({south},{west},{north},{east});

      // Memorials / monuments / plaques
      node["historic"="memorial"]({south},{west},{north},{east});
      way["historic"="memorial"]({south},{west},{north},{east});
      relation["historic"="memorial"]({south},{west},{north},{east});

      node["historic"="monument"]({south},{west},{north},{east});
      way["historic"="monument"]({south},{west},{north},{east});
      relation["historic"="monument"]({south},{west},{north},{east});

      node["memorial"="plaque"]({south},{west},{north},{east});
      way["memorial"="plaque"]({south},{west},{north},{east});
      relation["memorial"="plaque"]({south},{west},{north},{east});

      // Parks
      node["leisure"="park"]({south},{west},{north},{east});
      way["leisure"="park"]({south},{west},{north},{east});
      relation["leisure"="park"]({south},{west},{north},{east});

      // Transport hubs
      node["railway"="station"]({south},{west},{north},{east});
      way["railway"="station"]({south},{west},{north},{east});
      relation["railway"="station"]({south},{west},{north},{east});

      node["public_transport"="station"]({south},{west},{north},{east});
      way["public_transport"="station"]({south},{west},{north},{east});
      relation["public_transport"="station"]({south},{west},{north},{east});

      // Civic / worship
      node["amenity"="townhall"]({south},{west},{north},{east});
      way["amenity"="townhall"]({south},{west},{north},{east});
      relation["amenity"="townhall"]({south},{west},{north},{east});

      node["amenity"="courthouse"]({south},{west},{north},{east});
      way["amenity"="courthouse"]({south},{west},{north},{east});
      relation["amenity"="courthouse"]({south},{west},{north},{east});

      node["amenity"="library"]({south},{west},{north},{east});
      way["amenity"="library"]({south},{west},{north},{east});
      relation["amenity"="library"]({south},{west},{north},{east});

      node["amenity"="place_of_worship"]({south},{west},{north},{east});
      way["amenity"="place_of_worship"]({south},{west},{north},{east});
      relation["amenity"="place_of_worship"]({south},{west},{north},{east});

      // Accommodation
      node["tourism"="hotel"]({south},{west},{north},{east});
      way["tourism"="hotel"]({south},{west},{north},{east});
      relation["tourism"="hotel"]({south},{west},{north},{east});

      node["tourism"="hostel"]({south},{west},{north},{east});
      way["tourism"="hostel"]({south},{west},{north},{east});
      relation["tourism"="hostel"]({south},{west},{north},{east});

      // Food/drink (non-pub)
      node["amenity"="restaurant"]({south},{west},{north},{east});
      way["amenity"="restaurant"]({south},{west},{north},{east});
      relation["amenity"="restaurant"]({south},{west},{north},{east});

      node["amenity"="cafe"]({south},{west},{north},{east});
      way["amenity"="cafe"]({south},{west},{north},{east});
      relation["amenity"="cafe"]({south},{west},{north},{east});

      // Shops (broad, named only)
      node["shop"]({south},{west},{north},{east});
      way["shop"]({south},{west},{north},{east});
      relation["shop"]({south},{west},{north},{east});
    );
    out center tags;
    """

def main():
    south, west, north, east = BBOX
    q = build_query(south, west, north, east)
    raw = fetch_overpass(q)
    elements = raw.get("elements", [])

    full = []
    curated = []
    seen = set()

    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue

        lat, lon = element_to_point(el)
        if lat is None or lon is None:
            continue

        osm_key = f'{el["type"]}/{el["id"]}'
        if osm_key in seen:
            continue
        seen.add(osm_key)

        categories = categorise(tags)
        poi = {
            "id": f"osm_{el['type']}_{el['id']}",
            "name": name,
            "lat": lat,
            "lon": lon,
            "categories": categories,
            "tags": game_tags_from(categories, tags),
            "osm": {"type": el["type"], "id": el["id"]},
            "osm_tags": tags,  # keep raw tags for future recategorisation
        }

        full.append(poi)
        if is_curated(categories):
            curated.append(poi)

    full.sort(key=lambda p: p["name"].lower())
    curated.sort(key=lambda p: p["name"].lower())

    with open("POI.json", "w", encoding="utf-8") as f:
        json.dump(full, f, ensure_ascii=False, indent=2)

    with open("POI_curated.json", "w", encoding="utf-8") as f:
        json.dump(curated, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(full)} POIs to POI.json")
    print(f"Wrote {len(curated)} POIs to POI_curated.json")
    print("BBOX used (west,south,east,north):")
    print(WEST, SOUTH, EAST, NORTH)

if __name__ == "__main__":
    main()