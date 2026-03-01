import math
import io
import time
import urllib.request
from PIL import Image

# === YOUR BBOX (west, south, east, north) ===
WEST  = -3.004395961761475
SOUTH = 53.391042000000000
EAST  = -2.9498720169067387
NORTH = 53.414046000000000


ZOOM = 17  # set to 16 if you want less detail but fewer tiles

TILE_SIZE = 256
TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
USER_AGENT = "MapGamePOIBuilder/1.0 (personal use)"

def lon_to_xtile(lon, z):
    return int((lon + 180.0) / 360.0 * (1 << z))

def lat_to_ytile(lat, z):
    lat_rad = math.radians(lat)
    n = math.pi - math.log(math.tan(math.pi/4 + lat_rad/2))
    return int(n / math.pi / 2 * (1 << z))

def fetch_tile(z, x, y, retries=3):
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
            
def xtile_to_lon(x, z):
    return x / (2**z) * 360.0 - 180.0

def ytile_to_lat(y, z):
    n = math.pi - (2.0 * math.pi * y) / (2**z)
    return math.degrees(math.atan(math.sinh(n)))

def main():
    x_min = lon_to_xtile(WEST, ZOOM)
    x_max = lon_to_xtile(EAST, ZOOM)
    y_min = lat_to_ytile(NORTH, ZOOM)  # north is smaller y
    y_max = lat_to_ytile(SOUTH, ZOOM)

    # --- Trim one tile off the east edge (your request) ---
    x_max -= 3

    cols = x_max - x_min + 1
    rows = y_max - y_min + 1

    print(f"Zoom {ZOOM}: {cols} x {rows} tiles ({cols*rows} total)")
    out = Image.new("RGBA", (cols * TILE_SIZE, rows * TILE_SIZE))

    for y in range(y_min, y_max + 1):
        for x in range(x_min, x_max + 1):
            tile = fetch_tile(ZOOM, x, y)
            px = (x - x_min) * TILE_SIZE
            py = (y - y_min) * TILE_SIZE
            out.paste(tile, (px, py))
            time.sleep(0.05)  # be polite

    out.save("map.png")
    print("Wrote map.png")

    # --- Compute the *actual* bbox of the stitched tile rectangle ---
    west  = xtile_to_lon(x_min, ZOOM)
    east  = xtile_to_lon(x_max + 1, ZOOM)   # +1 because right edge of the last tile
    north = ytile_to_lat(y_min, ZOOM)
    south = ytile_to_lat(y_max + 1, ZOOM)   # +1 because bottom edge of the last tile

    print("\nUse this BBOX in app.js (tile-aligned):")
    print(f"  west  = {west}")
    print(f"  south = {south}")
    print(f"  east  = {east}")
    print(f"  north = {north}")

if __name__ == "__main__":
    main()
    
