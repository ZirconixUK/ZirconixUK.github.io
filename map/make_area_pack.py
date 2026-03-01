import argparse
import io
import json
import math
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

# ----------------------------
# Config
# ----------------------------
TILE_SIZE = 256
TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

USER_AGENT = "MapGameAreaPack/1.0 (personal use)"

# Earth radius for spherical approximations
EARTH_RADIUS_M = 6371000.0


@dataclass
class BBox:
    west: float
    south: float
    east: float
    north: float


# ----------------------------
# Geo helpers
# ----------------------------
def clamp_lat(lat: float) -> float:
    # Web Mercator usable range (OSM tiles)
    return max(min(lat, 85.05112878), -85.05112878)


def bbox_from_center_radius(lat: float, lon: float, radius_m: float) -> BBox:
    """
    Approximate bbox around (lat, lon) with radius_m.
    Good enough for ~few km gameplay areas.
    """
    lat = clamp_lat(lat)
    dlat = (radius_m / EARTH_RADIUS_M) * (180.0 / math.pi)
    # Longitude degrees shrink by cos(latitude)
    dlon = (radius_m / (EARTH_RADIUS_M * math.cos(math.radians(lat)))) * (180.0 / math.pi)

    return BBox(
        west=lon - dlon,
        south=lat - dlat,
        east=lon + dlon,
        north=lat + dlat,
    )


# ----------------------------
# Slippy map / Web Mercator math
# ----------------------------
def lon_to_xtile(lon: float, z: int) -> int:
    return int((lon + 180.0) / 360.0 * (1 << z))


def lat_to_ytile(lat: float, z: int) -> int:
    lat = clamp_lat(lat)
    lat_rad = math.radians(lat)
    n = math.pi - math.log(math.tan(math.pi / 4.0 + lat_rad / 2.0))
    return int(n / math.pi / 2.0 * (1 << z))


def lonlat_to_global_px(lon: float, lat: float, z: int) -> Tuple[float, float]:
    """
    Convert lon/lat to *global pixel coordinates* at zoom z in Web Mercator.
    """
    lat = clamp_lat(lat)
    siny = math.sin(math.radians(lat))
    siny = min(max(siny, -0.9999), 0.9999)

    world = TILE_SIZE * (1 << z)
    x = (lon + 180.0) / 360.0 * world
    y = (0.5 - math.log((1 + siny) / (1 - siny)) / (4 * math.pi)) * world
    return x, y


def fetch_tile(z: int, x: int, y: int, retries: int = 3) -> Image.Image:
    url = TILE_URL.format(z=z, x=x, y=y)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            return Image.open(io.BytesIO(data)).convert("RGBA")
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.0)
    raise RuntimeError("Unreachable")


# ----------------------------
# Map builder (stitch + crop to exact bbox)
# ----------------------------
def build_map_png(name: str, bbox: BBox, zoom: int) -> Tuple[str, BBox, Tuple[int, int]]:
    """
    Produces a PNG that corresponds EXACTLY to bbox by:
      - stitching the covering tile rectangle
      - cropping to the exact bbox pixel bounds
    Returns (filepath, exact_bbox_used, (width,height)).
    """
    # tile rectangle that covers bbox
    x_min = lon_to_xtile(bbox.west, zoom)
    x_max = lon_to_xtile(bbox.east, zoom)
    y_min = lat_to_ytile(bbox.north, zoom)  # north = smaller y
    y_max = lat_to_ytile(bbox.south, zoom)

    cols = x_max - x_min + 1
    rows = y_max - y_min + 1

    print(f"[map] Zoom {zoom}: {cols} x {rows} tiles ({cols*rows} total)")

    stitched = Image.new("RGBA", (cols * TILE_SIZE, rows * TILE_SIZE))

    for ty in range(y_min, y_max + 1):
        for tx in range(x_min, x_max + 1):
            tile = fetch_tile(zoom, tx, ty)
            px = (tx - x_min) * TILE_SIZE
            py = (ty - y_min) * TILE_SIZE
            stitched.paste(tile, (px, py))
            time.sleep(0.05)  # polite-ish

    # crop stitched image to exact bbox
    # global px of bbox edges
    gx_w, gy_n = lonlat_to_global_px(bbox.west, bbox.north, zoom)
    gx_e, gy_s = lonlat_to_global_px(bbox.east, bbox.south, zoom)

    # global px of stitched top-left
    gx0 = x_min * TILE_SIZE
    gy0 = y_min * TILE_SIZE

    left = int(round(gx_w - gx0))
    top = int(round(gy_n - gy0))
    right = int(round(gx_e - gx0))
    bottom = int(round(gy_s - gy0))

    # clamp crop bounds
    left = max(0, min(left, stitched.width))
    right = max(0, min(right, stitched.width))
    top = max(0, min(top, stitched.height))
    bottom = max(0, min(bottom, stitched.height))

    if right <= left or bottom <= top:
        raise RuntimeError("Crop bounds invalid; check bbox/zoom.")

    cropped = stitched.crop((left, top, right, bottom))

    out_path = f"{name}_map.png"
    cropped.save(out_path)
    print(f"[map] Wrote {out_path} ({cropped.width}x{cropped.height})")

    # bbox is the exact bbox we requested (because we cropped to it)
    return out_path, bbox, (cropped.width, cropped.height)


# ----------------------------
# Overpass POI builder
# ----------------------------
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

    # include-all buckets (filtered out of curated)
    if shop:
        cats.add("shop")
    if tourism in {"hotel", "hostel", "motel", "guest_house"}:
        cats.add("accommodation")
    if amenity in {"restaurant", "fast_food", "cafe", "bar", "food_court"}:
        cats.add("food_drink")

    return sorted(cats)


def is_curated(categories: List[str]) -> bool:
    # Exclude these categories from curated (but keep pubs even if food_drink gets tagged)
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

        poi = {
            "id": f"osm_{el['type']}_{el['id']}",
            "name": poi_name,
            "lat": lat,
            "lon": lon,
            "categories": categories,
            "tags": ["text_present"] if "historic_plaque" in categories else [],
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


def write_config(name: str, bbox: BBox, zoom: int, map_path: str, poi_path: str, curated_path: str):
    cfg = {
        "name": name,
        "zoom": zoom,
        "bbox": {
            "west": bbox.west,
            "south": bbox.south,
            "east": bbox.east,
            "north": bbox.north,
        },
        # Convenient copy/paste shape for app.js
        "app_js_BBOX": {
            "nw": {"lat": bbox.north, "lon": bbox.west},
            "se": {"lat": bbox.south, "lon": bbox.east},
        },
        "files": {
            "map": map_path,
            "poi_full": poi_path,
            "poi_curated": curated_path,
        },
        "attribution": "© OpenStreetMap contributors",
    }

    out = f"{name}_config.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f"[cfg] Wrote {out}")


def main():
    ap = argparse.ArgumentParser(description="Generate a map.png and POI JSONs for a radius around a point.")
    ap.add_argument("--name", required=True, help="Output name prefix (e.g., liverpool_centre, manchester_cc)")
    ap.add_argument("--lat", type=float, required=True, help="Centre latitude")
    ap.add_argument("--lon", type=float, required=True, help="Centre longitude")
    ap.add_argument("--radius-km", type=float, default=2.0, help="Radius in km (default: 2.0)")
    ap.add_argument("--zoom", type=int, default=17, help="Tile zoom (16 or 17 recommended)")
    args = ap.parse_args()

    bbox = bbox_from_center_radius(args.lat, args.lon, args.radius_km * 1000.0)

    # Build map first (so you can visually sanity-check bbox if needed)
    map_path, exact_bbox, size = build_map_png(args.name, bbox, args.zoom)

    # Build POIs within exact bbox
    poi_path, curated_path, full_n, curated_n = build_pois(args.name, exact_bbox)

    # Write config to paste into app.js
    write_config(args.name, exact_bbox, args.zoom, map_path, poi_path, curated_path)

    print("\nDone.")
    print(f"  Map: {map_path}  ({size[0]}x{size[1]})")
    print(f"  POIs: {poi_path} ({full_n})")
    print(f"  Curated: {curated_path} ({curated_n})")
    print(f"  BBOX for app.js is in {args.name}_config.json")


if __name__ == "__main__":
    main()