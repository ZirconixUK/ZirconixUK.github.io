#!/usr/bin/env python3
"""
make_poi_pack.py

POI-only area pack builder for Map Game (Leaflet basemap).
- Builds POI.json and POI_curated.json from OpenStreetMap via Overpass API.
- Keeps bounding box generation (center + radius) or accepts explicit bbox.
- Adds a "game tags" taxonomy derived from OSM tags, so the game can ask things like:
  "nearest museum", "nearest plaque", "nearest transport hub", etc.

Usage examples:
  python make_poi_pack.py --name liverpool_cc --lat 53.4075 --lon -2.9919 --radius-km 2.0
  python make_poi_pack.py --name my_area --bbox "west,south,east,north"

Outputs:
  <name>_POI.json
  <name>_POI_curated.json
  <name>_config.json   (bbox + files)
"""

import argparse
import json
import math
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "MapGamePOIPack/1.0 (personal use)"
EARTH_RADIUS_M = 6371000.0


@dataclass
class BBox:
    west: float
    south: float
    east: float
    north: float


def clamp_lat(lat: float) -> float:
    # Web Mercator usable range
    return max(min(lat, 85.05112878), -85.05112878)


def bbox_from_center_radius(lat: float, lon: float, radius_m: float) -> BBox:
    """Approximate bbox around (lat, lon) with radius_m (good for few km)."""
    lat = clamp_lat(lat)
    dlat = (radius_m / EARTH_RADIUS_M) * (180.0 / math.pi)
    dlon = (radius_m / (EARTH_RADIUS_M * math.cos(math.radians(lat)))) * (180.0 / math.pi)
    return BBox(west=lon - dlon, south=lat - dlat, east=lon + dlon, north=lat + dlat)


def fetch_overpass(query: str) -> Dict[str, Any]:
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=data,
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        payload = resp.read()
    # be polite to Overpass
    time.sleep(1.0)
    return json.loads(payload)


def element_to_point(el: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    if el.get("type") == "node":
        return el.get("lat"), el.get("lon")
    center = el.get("center")
    if center:
        return center.get("lat"), center.get("lon")
    return None, None


# ----------------------------
# Categories (coarse buckets)
# ----------------------------
def categorise(tags: Dict[str, str]) -> List[str]:
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

    # gameplay-relevant
    if amenity == "pub":
        cats.add("pub")
    if tourism in {"museum", "gallery"}:
        cats.add("museum_gallery")
    if tourism in {"attraction", "viewpoint"}:
        cats.add("landmark")
    if historic in {"monument", "memorial", "wayside_cross", "milestone"}:
        cats.add("monument_memorial")
    if memorial == "plaque":
        cats.add("historic_plaque")
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

    # include-all buckets (kept in full, filtered out of curated)
    if shop:
        cats.add("shop")
    if tourism in {"hotel", "hostel", "motel", "guest_house"}:
        cats.add("accommodation")
    if amenity in {"restaurant", "fast_food", "cafe", "bar", "food_court"}:
        cats.add("food_drink")

    return sorted(cats)


def is_curated(categories: List[str]) -> bool:
    excluded = {"shop", "accommodation", "food_drink"}
    if any(c in excluded for c in categories) and "pub" not in categories:
        return False

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


# ----------------------------
# Game tags taxonomy (fine tags)
# ----------------------------
def game_tags(tags: Dict[str, str], categories: List[str]) -> List[str]:
    """
    Return normalized game-facing tags derived from OSM tags.
    Keep these stable; the idea is your game UI can filter / query by these.
    """
    t = set()

    amenity = tags.get("amenity")
    tourism = tags.get("tourism")
    historic = tags.get("historic")
    memorial = tags.get("memorial")
    shop = tags.get("shop")
    leisure = tags.get("leisure")
    railway = tags.get("railway")
    public_transport = tags.get("public_transport")
    building = tags.get("building")
    man_made = tags.get("man_made")

    # Direct "type" tags
    if amenity == "pub": t.add("pub")
    if amenity == "bar": t.add("bar")
    if amenity == "cafe": t.add("cafe")
    if amenity == "restaurant": t.add("restaurant")
    if amenity == "library": t.add("library")
    if amenity == "courthouse": t.add("courthouse")
    if amenity == "townhall": t.add("townhall")
    if amenity == "place_of_worship": t.add("place_of_worship")

    if tourism == "museum": t.add("museum")
    if tourism == "gallery": t.add("gallery")
    if tourism == "attraction": t.add("attraction")
    if tourism == "viewpoint": t.add("viewpoint")
    if tourism in {"hotel","hostel","guest_house","motel"}: t.add("accommodation")

    if leisure in {"park","garden","common"}: t.add("park")

    if historic in {"monument"}: t.add("monument")
    if historic in {"memorial"}: t.add("memorial")
    if memorial in {"plaque"}: t.add("plaque")
    if memorial in {"war_memorial"}: t.add("war_memorial")
    if memorial in {"statue"}: t.add("statue")

    if railway == "station" or public_transport == "station": t.add("station")

    if man_made == "pier": t.add("pier")

    # Derived convenience tags
    if "historic_plaque" in categories:
        t.add("text_present")

    if shop:
        t.add("shop")  # broad; you can later add finer shop tags if you want

    # Category mirrors (helps when you want coarse filtering)
    for c in categories:
        t.add(f"cat:{c}")

    return sorted(t)


# ----------------------------
# Overpass query
# ----------------------------
def build_overpass_query(bbox: BBox) -> str:
    s, w, n, e = bbox.south, bbox.west, bbox.north, bbox.east

    # Broad-ish pull: includes shops/hotels/etc for POI.json
    return f"""
    [out:json][timeout:90];
    (
      // pubs
      node["amenity"="pub"]({s},{w},{n},{e});
      way["amenity"="pub"]({s},{w},{n},{e});
      relation["amenity"="pub"]({s},{w},{n},{e});

      // museums, galleries, attractions, viewpoints
      node["tourism"="museum"]({s},{w},{n},{e});
      way["tourism"="museum"]({s},{w},{n},{e});
      relation["tourism"="museum"]({s},{w},{n},{e});

      node["tourism"="gallery"]({s},{w},{n},{e});
      way["tourism"="gallery"]({s},{w},{n},{e});
      relation["tourism"="gallery"]({s},{w},{n},{e});

      node["tourism"="attraction"]({s},{w},{n},{e});
      way["tourism"="attraction"]({s},{w},{n},{e});
      relation["tourism"="attraction"]({s},{w},{n},{e});

      node["tourism"="viewpoint"]({s},{w},{n},{e});
      way["tourism"="viewpoint"]({s},{w},{n},{e});
      relation["tourism"="viewpoint"]({s},{w},{n},{e});

      // memorials/monuments/plaques
      node["historic"="memorial"]({s},{w},{n},{e});
      way["historic"="memorial"]({s},{w},{n},{e});
      relation["historic"="memorial"]({s},{w},{n},{e});

      node["historic"="monument"]({s},{w},{n},{e});
      way["historic"="monument"]({s},{w},{n},{e});
      relation["historic"="monument"]({s},{w},{n},{e});

      node["memorial"="plaque"]({s},{w},{n},{e});
      way["memorial"="plaque"]({s},{w},{n},{e});
      relation["memorial"="plaque"]({s},{w},{n},{e});

      // parks
      node["leisure"="park"]({s},{w},{n},{e});
      way["leisure"="park"]({s},{w},{n},{e});
      relation["leisure"="park"]({s},{w},{n},{e});

      // transport hubs
      node["railway"="station"]({s},{w},{n},{e});
      way["railway"="station"]({s},{w},{n},{e});
      relation["railway"="station"]({s},{w},{n},{e});

      node["public_transport"="station"]({s},{w},{n},{e});
      way["public_transport"="station"]({s},{w},{n},{e});
      relation["public_transport"="station"]({s},{w},{n},{e});

      // civic / worship
      node["amenity"="townhall"]({s},{w},{n},{e});
      way["amenity"="townhall"]({s},{w},{n},{e});
      relation["amenity"="townhall"]({s},{w},{n},{e});

      node["amenity"="courthouse"]({s},{w},{n},{e});
      way["amenity"="courthouse"]({s},{w},{n},{e});
      relation["amenity"="courthouse"]({s},{w},{n},{e});

      node["amenity"="library"]({s},{w},{n},{e});
      way["amenity"="library"]({s},{w},{n},{e});
      relation["amenity"="library"]({s},{w},{n},{e});

      node["amenity"="place_of_worship"]({s},{w},{n},{e});
      way["amenity"="place_of_worship"]({s},{w},{n},{e});
      relation["amenity"="place_of_worship"]({s},{w},{n},{e});

      // accommodation
      node["tourism"="hotel"]({s},{w},{n},{e});
      way["tourism"="hotel"]({s},{w},{n},{e});
      relation["tourism"="hotel"]({s},{w},{n},{e});

      node["tourism"="hostel"]({s},{w},{n},{e});
      way["tourism"="hostel"]({s},{w},{n},{e});
      relation["tourism"="hostel"]({s},{w},{n},{e});

      // food/drink (non-pub)
      node["amenity"="restaurant"]({s},{w},{n},{e});
      way["amenity"="restaurant"]({s},{w},{n},{e});
      relation["amenity"="restaurant"]({s},{w},{n},{e});

      node["amenity"="cafe"]({s},{w},{n},{e});
      way["amenity"="cafe"]({s},{w},{n},{e});
      relation["amenity"="cafe"]({s},{w},{n},{e});

      // shops (broad; named-only filter applied after)
      node["shop"]({s},{w},{n},{e});
      way["shop"]({s},{w},{n},{e});
      relation["shop"]({s},{w},{n},{e});
    );
    out center tags;
    """


def build_pois(name: str, bbox: BBox) -> Tuple[str, str, int, int]:
    q = build_overpass_query(bbox)
    raw = fetch_overpass(q)
    elements = raw.get("elements", [])

    full: List[Dict[str, Any]] = []
    curated: List[Dict[str, Any]] = []
    seen = set()

    for el in elements:
        tags = el.get("tags", {}) or {}
        poi_name = tags.get("name")
        if not poi_name:
            continue

        lat, lon = element_to_point(el)
        if lat is None or lon is None:
            continue

        osm_key = f'{el.get("type")}/{el.get("id")}'
        if osm_key in seen:
            continue
        seen.add(osm_key)

        categories = categorise(tags)
        tags_game = game_tags(tags, categories)

        poi = {
            "id": f"osm_{el['type']}_{el['id']}",
            "name": poi_name,
            "lat": lat,
            "lon": lon,
            "categories": categories,
            "tags": tags_game,
            "osm": {"type": el["type"], "id": el["id"]},
            "osm_tags": tags,
        }
        full.append(poi)
        if is_curated(categories):
            curated.append(poi)

    full.sort(key=lambda p: p["name"].lower())
    curated.sort(key=lambda p: p["name"].lower())

    full_path = f"{name}_POI.json"
    curated_path = f"{name}_POI_curated.json"

    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(full, f, ensure_ascii=False, indent=2)
    with open(curated_path, "w", encoding="utf-8") as f:
        json.dump(curated, f, ensure_ascii=False, indent=2)

    print(f"[poi] Wrote {full_path} ({len(full)} POIs)")
    print(f"[poi] Wrote {curated_path} ({len(curated)} POIs)")

    return full_path, curated_path, len(full), len(curated)


def write_config(name: str, bbox: BBox, poi_path: str, curated_path: str):
    cfg = {
        "name": name,
        "bbox": {
            "west": bbox.west,
            "south": bbox.south,
            "east": bbox.east,
            "north": bbox.north,
        },
        # Convenient copy/paste shape for the game config
        "app_js_BBOX": {
            "nw": {"lat": bbox.north, "lon": bbox.west},
            "se": {"lat": bbox.south, "lon": bbox.east},
        },
        "files": {
            "poi_full": poi_path,
            "poi_curated": curated_path,
        },
        "attribution": "© OpenStreetMap contributors",
        "notes": "Leaflet basemap; no map.png is generated by this script.",
    }

    out = f"{name}_config.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f"[cfg] Wrote {out}")


def parse_bbox_string(s: str) -> BBox:
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != 4:
        raise ValueError('bbox must be "west,south,east,north"')
    west, south, east, north = map(float, parts)
    return BBox(west=west, south=south, east=east, north=north)


def main():
    ap = argparse.ArgumentParser(description="Generate POI JSONs for a bbox (Leaflet basemap; no map.png).")
    ap.add_argument("--name", required=True, help="Output name prefix (e.g., liverpool_centre)")
    ap.add_argument("--lat", type=float, help="Centre latitude (used with --lon + --radius-km)")
    ap.add_argument("--lon", type=float, help="Centre longitude (used with --lat + --radius-km)")
    ap.add_argument("--radius-km", type=float, default=2.0, help="Radius in km (default: 2.0)")
    ap.add_argument("--bbox", type=str, help='Explicit bbox "west,south,east,north" (overrides lat/lon/radius)')
    args = ap.parse_args()

    if args.bbox:
        bbox = parse_bbox_string(args.bbox)
    else:
        if args.lat is None or args.lon is None:
            raise SystemExit("Either provide --bbox or provide --lat and --lon (and optional --radius-km).")
        bbox = bbox_from_center_radius(args.lat, args.lon, args.radius_km * 1000.0)

    poi_path, curated_path, full_n, curated_n = build_pois(args.name, bbox)
    write_config(args.name, bbox, poi_path, curated_path)

    print("\nDone.")
    print(f"  POIs: {poi_path} ({full_n})")
    print(f"  Curated: {curated_path} ({curated_n})")


if __name__ == "__main__":
    main()
