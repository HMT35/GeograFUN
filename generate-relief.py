#!/usr/bin/env python3
"""
generate-relief.py  --  fisier temporar, se poate sterge dupa rulare.

Genereaza assets/data/base/relief_ro.geojson: benzi hipsometrice (campie,
dealuri, podis, munte) pentru Romania, in stilul hartilor fizico-geografice.

Sursa DEM: AWS Terrain Tiles (terrarium PNG), publice, fara cont/API key.
    h = (R * 256 + G + B / 256) - 32768

Dependinte:
    pip install requests pillow numpy scipy shapely
Rulare:
    python generate-relief.py
"""

import io
import json
import math
import os
import sys

try:
    import requests
    import numpy as np
    from PIL import Image
    from scipy.ndimage import gaussian_filter
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    import rasterio.features
    from affine import Affine
except ImportError as e:
    sys.exit(
        "Lipseste o dependinta: %s\n"
        "Ruleaza: pip install requests pillow numpy scipy shapely rasterio affine" % e
    )

# ---------------------------------------------------------------- parametri

BBOX = (20.0, 43.5, 30.0, 48.4)      # min_lon, min_lat, max_lon, max_lat
ZOOM = 9                              # ~300 m/px la latitudinea Romaniei
SMOOTH_SIGMA = 2.0                    # netezire, ca sa nu iasa contururi zimtate
SIMPLIFY_DEG = 0.012                  # simplificare poligoane (grade)
MIN_AREA_DEG2 = 0.004                 # elimina petele minuscule
COORD_DECIMALS = 4                    # ~11 m; suficient pentru un fundal
CACHE = "_dem_cache.npy"              # evita re-descarcarea la reglaje

# praguri altitudinale (m) -> 5 benzi: 0,1,2,3,4
BREAKS = [200, 500, 800, 1500]

OUT = os.path.join("assets", "data", "base", "relief_ro.geojson")
COUNTRIES = os.path.join("assets", "data", "raw", "tari_export.json")
LAND = os.path.join("assets", "data", "base", "land.geojson")
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TILE = 256

# ---------------------------------------------------------------- tile math


def lon2x(lon, z):
    return int((lon + 180.0) / 360.0 * (2 ** z))


def lat2y(lat, z):
    r = math.radians(lat)
    return int((1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * (2 ** z))


def x2lon(x, z):
    return x / (2 ** z) * 360.0 - 180.0


def y2lat(y, z):
    n = math.pi - 2.0 * math.pi * y / (2 ** z)
    return math.degrees(math.atan(math.sinh(n)))


# ---------------------------------------------------------------- descarcare

def download_dem():
    x0, x1 = lon2x(BBOX[0], ZOOM), lon2x(BBOX[2], ZOOM)
    y0, y1 = lat2y(BBOX[3], ZOOM), lat2y(BBOX[1], ZOOM)
    nx, ny = x1 - x0 + 1, y1 - y0 + 1
    total = nx * ny

    west, north = x2lon(x0, ZOOM), y2lat(y0, ZOOM)
    east, south = x2lon(x1 + 1, ZOOM), y2lat(y1 + 1, ZOOM)

    if os.path.exists(CACHE):
        print("Folosesc DEM-ul din cache (%s)." % CACHE)
        return np.load(CACHE), (west, north, east, south)

    print("Descarc %d tile-uri (z=%d)..." % (total, ZOOM))

    elev = np.zeros((ny * TILE, nx * TILE), dtype=np.float32)
    sess = requests.Session()
    done = 0

    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            url = TILE_URL.format(z=ZOOM, x=tx, y=ty)
            try:
                r = sess.get(url, timeout=30)
                r.raise_for_status()
                img = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"),
                                 dtype=np.float32)
                h = img[:, :, 0] * 256.0 + img[:, :, 1] + img[:, :, 2] / 256.0 - 32768.0
            except Exception as ex:
                print("  ! tile %d/%d esuat (%s), umplut cu 0" % (tx, ty, ex))
                h = np.zeros((TILE, TILE), dtype=np.float32)

            ry, rx = (ty - y0) * TILE, (tx - x0) * TILE
            elev[ry:ry + TILE, rx:rx + TILE] = h

            done += 1
            if done % 25 == 0 or done == total:
                print("  %d/%d" % (done, total))

    np.save(CACHE, elev)
    return elev, (west, north, east, south)


# ---------------------------------------------------------------- masca tarii

def load_clip():
    """Poligonul Romaniei, intersectat cu uscatul, ca sa nu ramana relief
    peste apele teritoriale din Marea Neagra."""
    with open(COUNTRIES, encoding="utf-8") as f:
        data = json.load(f)

    parts = []
    for feat in data.get("features", []):
        props = feat.get("properties") or {}
        names = [str(props.get(k, "")) for k in ("name", "name:ro", "name:en")]
        iso = props.get("ISO3166-1") or props.get("ISO3166-1:alpha2")
        if iso == "RO" or any("omân" in n or "omania" in n for n in names):
            if feat.get("geometry"):
                parts.append(shape(feat["geometry"]).buffer(0))

    if not parts:
        print("ATENTIE: nu am gasit Romania in %s; relieful ramane netaiat." % COUNTRIES)
        return None

    romania = unary_union(parts)

    try:
        with open(LAND, encoding="utf-8") as f:
            land = json.load(f)
        land_geoms = [shape(x["geometry"]).buffer(0)
                      for x in land.get("features", []) if x.get("geometry")]
        if land_geoms:
            romania = romania.intersection(unary_union(land_geoms).buffer(0))
    except Exception as ex:
        print("  (fara decupare pe linia coastei: %s)" % ex)

    return romania.buffer(0)


# ---------------------------------------------------------------- vectorizare

def build_geojson(elev, bounds, clip=None):
    west, north, east, south = bounds
    h, w = elev.shape

    print("Netezire...")
    elev = gaussian_filter(elev, sigma=SMOOTH_SIGMA)

    print("Clasificare in %d benzi..." % (len(BREAKS) + 1))
    bands = np.zeros(elev.shape, dtype=np.int16)
    for i, b in enumerate(BREAKS):
        bands[elev >= b] = i + 1
    bands[elev <= 0] = -1                      # marea / sub nivelul marii

    # transformare pixel -> lon/lat (grila Web Mercator aproximata liniar in y;
    # rasterio are nevoie doar de un affine, iar la aceasta scara e acceptabil)
    transform = Affine.translation(west, north) * Affine.scale(
        (east - west) / w, (south - north) / h
    )

    features = []
    for band_id in range(len(BREAKS) + 1):
        mask = (bands == band_id).astype(np.uint8)
        if not mask.any():
            continue
        print("  banda %d: vectorizare..." % band_id)
        geoms = [
            shape(g)
            for g, v in rasterio.features.shapes(mask, mask=mask.astype(bool),
                                                 transform=transform)
            if v == 1
        ]
        if not geoms:
            continue
        merged = unary_union(geoms)
        merged = merged.simplify(SIMPLIFY_DEG, preserve_topology=True)
        merged = merged.buffer(0)

        # decupare pe granita
        if clip is not None:
            merged = merged.intersection(clip).buffer(0)
            if merged.is_empty:
                continue

        parts = list(merged.geoms) if merged.geom_type.startswith("Multi") else [merged]
        parts = [p for p in parts if p.area >= MIN_AREA_DEG2]
        if not parts:
            continue
        geom = unary_union(parts)

        features.append({
            "type": "Feature",
            "properties": {"band": band_id},
            "geometry": round_coords(mapping(geom))
        })

    return {"type": "FeatureCollection", "features": features}


def round_coords(obj):
    """Rotunjeste recursiv coordonatele, ca sa scada mult dimensiunea JSON."""
    if isinstance(obj, dict):
        return {k: (round_coords(v) if k == "coordinates" else v)
                for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(v), COORD_DECIMALS) for v in obj]
        return [round_coords(v) for v in obj]
    return obj


def main():
    elev, bounds = download_dem()
    print("Incarc masca de decupare (granita Romaniei)...")
    clip = load_clip()
    gj = build_geojson(elev, bounds, clip)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(gj, f, separators=(",", ":"))

    size = os.path.getsize(OUT) / 1024.0
    print("\nScris %s (%d benzi, %.0f KB)" % (OUT, len(gj["features"]), size))
    if size > 1500:
        print("ATENTIE: fisier mare. Creste SIMPLIFY_DEG sau MIN_AREA_DEG2.")


if __name__ == "__main__":
    main()
