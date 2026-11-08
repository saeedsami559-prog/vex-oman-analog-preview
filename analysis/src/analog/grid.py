"""VEX Scout: screen the whole of Oman, cell by cell, for Mars and Moon terrain analogs.

    python -m analog.grid fetch     # NASA/ESA data -> data/processed/grid/cells_raw.json + heightmaps (needs network)
    python -m analog.grid power     # NASA POWER climatology for every cell -> data/processed/grid/nasa_power_cells.json
    python -m analog.grid score     # cells_raw.json -> data/processed/grid/oman_grid.json + web copy (offline,
                                    # then analog.scout_ai adds the AI second opinion, safe ground and climate)

The country is split into 0.25 deg x 0.25 deg cells (about 25-28 km on a side). For every cell that is at
least 30 % land inside Oman's border (Natural Earth admin-0, 1:10m), the fetch step reads:

  terrain      NASADEM_HGT v001 (30 m) on a cell-centred azimuthal-equidistant grid, area-averaged to the
               same 463 m common scale as the site analysis; slope, roughness and relief are computed with
               exactly the same code (metrics/terrain.py) as the sites.
  heightmap    the same DEM averaged to 128 x 128 pixels (~217 m) and stored Terrarium-encoded
               (height = R*256 + G + B/256 - 32768), 64 cells per atlas PNG (web/public/grid/atlas_NN.png),
               for the virtual drone.
  land cover   ESA WorldCover 10 m v200 (2021): share of built-up (class 50) and cropland (class 40) pixels,
               the human-footprint check. Read on a 100 m grid with nearest-neighbour sampling.

The score step compares every cell with every Mars and Moon target on TERRAIN ONLY (weights terrain 1,
mineralogy 0, surface 0), with the normalisation ranges fixed by the five Omani sites and the targets -
the same shared criteria the Atlas world ranking uses. Minerals (EMIT) are not screened country-wide:
EMIT does not cover every cell and needs an Earthdata login. A cell's score is therefore a screening
signal that says where to look; the site pages remain the full analysis.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import shutil
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from . import DATA_DIR, REPO_DIR
from .export import features_of, load_config, load_yaml, prepare_sites, scoring_config
from .similarity import similarity

GRID_DIR = DATA_DIR / "processed" / "grid"
RAW_FILE = GRID_DIR / "cells_raw.json"
OUT_FILE = GRID_DIR / "oman_grid.json"
WEB_FILE = REPO_DIR / "web" / "public" / "data" / "oman_grid.json"
HEIGHT_DIR = REPO_DIR / "web" / "public" / "grid" / "h"
ATLAS_DIR = REPO_DIR / "web" / "public" / "grid"
ATLAS_SIDE = 8  # heightmaps per atlas row/column: 64 cells per PNG, so the site ships a handful of files

CELL_DEG = 0.25
LAT_RANGE = (16.5, 26.5)
LON_RANGE = (51.75, 60.0)
MIN_LAND = 0.3
HEIGHT_PX = 128
MUSCAT = (23.5880, 58.3829)
BORDER_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/"
              "ne_10m_admin_0_countries.geojson")
TERRAIN_ONLY = {"terrain": 1.0, "mineralogy": 0.0, "surface": 0.0}


# ---------- helpers usable offline (tested) ----------

def cell_id(lat: float, lon: float) -> str:
    return f"c{lat:+06.2f}_{lon:06.2f}".replace("+", "n").replace("-", "s").replace(".", "")


def km_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in km (mean Earth radius 6371 km)."""
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def terrarium_encode(height_m: np.ndarray) -> np.ndarray:
    """Heights (m, NaN allowed -> 0) to an RGB uint8 array in the Terrarium encoding."""
    v = np.nan_to_num(height_m, nan=0.0) + 32768.0
    r = np.floor(v / 256.0)
    g = np.floor(v - r * 256.0)
    b = np.round((v - r * 256.0 - g) * 256.0)
    carry = b >= 256
    b[carry] = 0
    g[carry] += 1
    return np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)


def terrarium_decode(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype("float64")
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


# ---------- fetch (network) ----------

def oman_border():
    from shapely.geometry import shape

    gj = json.load(urllib.request.urlopen(BORDER_URL, timeout=120))
    for f in gj["features"]:
        if f["properties"].get("ADM0_A3") == "OMN":
            return shape(f["geometry"]), f["properties"].get("NAME", "Oman")
    raise RuntimeError("Oman not found in Natural Earth admin-0")


def land_cells(border) -> list[dict[str, Any]]:
    from shapely.geometry import box

    cells = []
    lat = LAT_RANGE[0] + CELL_DEG / 2
    while lat < LAT_RANGE[1]:
        lon = LON_RANGE[0] + CELL_DEG / 2
        while lon < LON_RANGE[1]:
            cell = box(lon - CELL_DEG / 2, lat - CELL_DEG / 2, lon + CELL_DEG / 2, lat + CELL_DEG / 2)
            frac = cell.intersection(border).area / cell.area
            if frac >= MIN_LAND:
                cells.append({"id": cell_id(lat, lon), "lat": round(lat, 3), "lon": round(lon, 3),
                              "land_frac": round(frac, 3)})
            lon += CELL_DEG
        lat += CELL_DEG
    return cells


def fetch_cell(cell: dict[str, Any]) -> dict[str, Any]:
    from PIL import Image

    from .compute import average_to, local_grid, pc_search, pc_signed, warp_into
    from .metrics.terrain import terrain_metrics

    common = load_config()["common_terrain_scale_m"]
    half_km = CELL_DEG * 111.32 / 2  # half the N-S extent of a cell
    lat, lon = cell["lat"], cell["lon"]
    d = CELL_DEG / 2 + 0.02
    bbox = (lon - d, lat - d, lon + d, lat + d)
    out = dict(cell)
    try:
        items = pc_search("nasadem", bbox)
        crs, src_t, shape = local_grid(lat, lon, half_km, "earth", 30.0)
        native = np.full(shape, np.nan)
        for item in items:
            warp_into(native, f"/vsicurl/{pc_signed(item['assets']['elevation']['href'])}", crs, src_t)
        coverage = float(np.isfinite(native).mean())
        _, dst_t, dst_shape = local_grid(lat, lon, half_km, "earth", common)
        dem = average_to(native, crs, src_t, dst_t, dst_shape)
        hm_res = 2 * half_km * 1000 / HEIGHT_PX
        _, hm_t, hm_shape = local_grid(lat, lon, half_km, "earth", hm_res)
        hm = average_to(native, crs, src_t, hm_t, hm_shape)
        out["dem_coverage"] = round(coverage, 3)
        if coverage >= 0.5:
            out.update({k: round(float(v), 4) for k, v in terrain_metrics(dem, common).items()})
            out["elev_min"] = round(float(np.nanmin(hm)), 1)
            out["elev_max"] = round(float(np.nanmax(hm)), 1)
            out["elev_mean"] = round(float(np.nanmean(hm)), 1)
            HEIGHT_DIR.mkdir(parents=True, exist_ok=True)
            buf = io.BytesIO()
            Image.fromarray(terrarium_encode(hm), "RGB").save(buf, "PNG", optimize=True)
            (HEIGHT_DIR / f"{cell['id']}.png").write_bytes(buf.getvalue())
            out["heightmap"] = {"px": HEIGHT_PX, "res_m": round(hm_res, 2), "size_km": round(2 * half_km, 3)}
        out["nasadem_products"] = [i["id"] for i in items]
    except Exception as e:  # noqa: BLE001 - record the failure, keep going
        out["terrain_error"] = str(e)[:200]

    try:
        items = pc_search("esa-worldcover", bbox, limit=4)
        crs, t, shape = local_grid(lat, lon, half_km, "earth", 100.0)
        lc = np.full(shape, np.nan)
        for item in items:
            warp_into(lc, f"/vsicurl/{pc_signed(item['assets']['map']['href'])}", crs, t, resampling="nearest")
        valid = np.isfinite(lc) & (lc > 0)
        n = int(valid.sum())
        if n:
            out["built_pct"] = round(100 * float((lc[valid] == 50).sum()) / n, 2)
            out["crop_pct"] = round(100 * float((lc[valid] == 40).sum()) / n, 2)
            out["worldcover_products"] = [i["id"] for i in items]
    except Exception as e:  # noqa: BLE001
        out["landcover_error"] = str(e)[:200]
    return out


def fetch() -> None:
    border, name = oman_border()
    cells = land_cells(border)
    print(f"{len(cells)} cells of {CELL_DEG} deg with >= {MIN_LAND:.0%} land in {name}")
    with ThreadPoolExecutor(max_workers=8) as pool:
        done = list(pool.map(fetch_cell, cells))
    GRID_DIR.mkdir(parents=True, exist_ok=True)
    RAW_FILE.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cell_deg": CELL_DEG, "min_land": MIN_LAND,
        "border": f"Natural Earth admin-0 1:10m v5.1.2 ({BORDER_URL})",
        "terrain_source": "NASADEM_HGT v001, Microsoft Planetary Computer COG mirror",
        "landcover_source": "ESA WorldCover 10 m 2021 v200, Microsoft Planetary Computer",
        "cells": done,
    }, indent=1), encoding="utf-8")
    raw = pack(json.loads(RAW_FILE.read_text(encoding="utf-8")))
    RAW_FILE.write_text(json.dumps(raw, indent=1), encoding="utf-8")
    ok = sum(1 for c in done if "slope_deg" in c)
    print(f"terrain for {ok}/{len(done)} cells; land cover for {sum(1 for c in done if 'built_pct' in c)}")


def pack(raw: dict[str, Any]) -> dict[str, Any]:
    """Pack the per-cell heightmap PNGs into a few atlas PNGs (8 x 8 cells each) and record where each is."""
    from PIL import Image

    cells = [c for c in raw["cells"] if c.get("heightmap")]
    per = ATLAS_SIDE * ATLAS_SIDE
    for k in range(0, len(cells), per):
        group = cells[k:k + per]
        atlas = Image.new("RGB", (ATLAS_SIDE * HEIGHT_PX, ATLAS_SIDE * HEIGHT_PX), (128, 0, 0))  # 0 m
        name = f"atlas_{k // per:02d}.png"
        for j, c in enumerate(group):
            col, row = j % ATLAS_SIDE, j // ATLAS_SIDE
            atlas.paste(Image.open(HEIGHT_DIR / f"{c['id']}.png").convert("RGB"), (col * HEIGHT_PX, row * HEIGHT_PX))
            c["heightmap"] = {**c["heightmap"], "atlas": name, "col": col, "row": row}
        atlas.save(ATLAS_DIR / name, "PNG", optimize=True)
    shutil.rmtree(HEIGHT_DIR, ignore_errors=True)
    return raw


POWER_PARAMS = "T2M,T2M_RANGE,PRECTOTCORR,RH2M,WS10M,WS2M"
POWER_URL = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=" + POWER_PARAMS +
             "&community=RE&longitude={lon}&latitude={lat}&format=JSON")


def fetch_power() -> None:
    """Raw NASA POWER climatology response for every cell centre, saved in one file keyed by cell id."""
    import time

    from .scout_ai import POWER_FILE

    cells = json.loads(RAW_FILE.read_text(encoding="utf-8"))["cells"]
    out: dict[str, Any] = json.loads(POWER_FILE.read_text(encoding="utf-8")) if POWER_FILE.exists() else {}
    for c in cells:
        if c["id"] in out:
            continue
        url = POWER_URL.format(lon=c["lon"], lat=c["lat"])
        for _ in range(5):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "vex-oman-analog"})
                out[c["id"]] = json.loads(urllib.request.urlopen(req, timeout=120).read())
                break
            except Exception as e:  # noqa: BLE001 - network hiccups: retry
                print("retry", c["id"], e)
                time.sleep(15)
        time.sleep(1)
    POWER_FILE.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"NASA POWER saved for {len(out)} of {len(cells)} cells")


# ---------- score (offline) ----------

def score(raw: dict[str, Any]) -> dict[str, Any]:
    base = load_config()
    earth = prepare_sites(load_yaml("earth_sites.yaml")["sites"], base, body="earth")
    targets = prepare_sites(load_yaml("target_sites.yaml")["sites"], base)
    config = scoring_config(base, earth + targets)
    feats = features_of(config)
    scales = config.get("feature_scale") or {}
    common = config["common_terrain_scale_m"]
    mars = [t for t in targets if t["body"] == "mars"]
    moon = [t for t in targets if t["body"] == "moon"]

    def vs(cell_raw: dict, t: dict) -> float | None:
        res_cell = {"terrain": common, "mineralogy": None, "surface": None}
        r = similarity(cell_raw, t["raw"], res_cell, t["resolution_m"], config, TERRAIN_ONLY, "earth", t["body"])
        return None if r["overall"] is None else round(r["overall"], 4)

    cells = []
    for c in raw["cells"]:
        if "slope_deg" not in c:
            continue
        # A perfectly flat cell (open water, a salt flat) can measure exactly 0 roughness or relief;
        # log-scaled features need a positive value, so 0 is read as "below 1 mm" (clamped to the range anyway).
        cell_raw = {f: (max(c[f], 1e-3) if scales.get(f) == "log10" and c.get(f) is not None else c.get(f)) for f in feats}
        m = {t["id"]: vs(cell_raw, t) for t in mars}
        best = max((k for k in m if m[k] is not None), key=lambda k: m[k], default=None)
        cells.append({
            "id": c["id"], "lat": c["lat"], "lon": c["lon"], "land_frac": c["land_frac"],
            "slope_deg": c["slope_deg"], "roughness_m": c["roughness_m"], "relief_m": c["relief_m"],
            "elev_min": c.get("elev_min"), "elev_max": c.get("elev_max"), "elev_mean": c.get("elev_mean"),
            "built_pct": c.get("built_pct"), "crop_pct": c.get("crop_pct"),
            "km_muscat": round(km_between((c["lat"], c["lon"]), MUSCAT)),
            "mars": m, "mars_best": best, "mars_score": m[best] if best else None,
            "moon_score": vs(cell_raw, moon[0]) if moon else None,
            "heightmap": c.get("heightmap"),
        })

    def rank(key: str) -> None:
        order = sorted((x for x in cells if x[key] is not None), key=lambda x: -x[key])
        for i, x in enumerate(order, 1):
            x[key.replace("_score", "_rank")] = i

    rank("mars_score")
    rank("moon_score")
    sites = []
    for s in earth:
        near = min(cells, key=lambda x: km_between((x["lat"], x["lon"]), (s["lat"], s["lon"])), default=None)
        sites.append({"id": s["id"], "lat": s["lat"], "lon": s["lon"], "cell": near["id"] if near else None})
    return {
        "generated": raw["generated"],
        "method": {
            "cell_deg": raw["cell_deg"], "min_land": raw["min_land"], "border": raw["border"],
            "terrain_source": raw["terrain_source"], "landcover_source": raw["landcover_source"],
            "criteria": "terrain only (slope, roughness, relief); same code, common 463 m scale and "
                        "normalisation ranges as the site analysis",
            "heightmap_encoding": "Terrarium RGB: height_m = R*256 + G + B/256 - 32768",
        },
        "targets": [{"id": t["id"], "body": t["body"], "name": t["name"]} for t in targets],
        "sites": sites,
        "cells": cells,
    }


def write_scores() -> dict[str, Any]:
    from .scout_ai import enrich

    raw = json.loads(RAW_FILE.read_text(encoding="utf-8"))
    out = enrich(score(raw))
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    WEB_FILE.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT_FILE, WEB_FILE)
    top = sorted(out["cells"], key=lambda x: -(x["mars_score"] or 0))[:5]
    print(f"{len(out['cells'])} cells scored; top Mars cells:",
          ", ".join(f"{c['id']} {c['mars_score']:.2f}" for c in top))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("step", choices=["fetch", "pack", "power", "score"])
    args = ap.parse_args()
    if args.step == "fetch":
        fetch()
    elif args.step == "power":
        fetch_power()
    elif args.step == "pack":  # one-off for grids fetched before packing existed
        raw = pack(json.loads(RAW_FILE.read_text(encoding="utf-8")))
        RAW_FILE.write_text(json.dumps(raw, indent=1), encoding="utf-8")
    write_scores()


if __name__ == "__main__":
    main()
