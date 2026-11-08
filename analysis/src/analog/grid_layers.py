"""Extra per-cell layers for the VEX Scout drone and the AI explanations.

    python -m analog.grid_layers      # network (Microsoft Planetary Computer); writes data + web atlases

For every grid cell, on the same cell-centred azimuthal-equidistant grid the heightmaps use:

  landcover   ESA WorldCover 10 m v200 (2021), majority class per ~217 m pixel  -> the "what is on the
              ground" lens (water, bare/sand, shrubs, grass, crops, built-up, mangroves ...)
  water       JRC Global Surface Water v1.4 occurrence (% of Landsat observations 1984-2021 with water),
              maximum per ~217 m pixel  -> wadi / flood-risk warnings and the water lens
  hd height   NASADEM 30 m averaged to 256 x 256 (~109 m) for a sharper drone terrain (drawing only; all
              analysis keeps the 128 px / 463 m grids)

and per cell, for the mission log:

  lst         NASA MODIS MOD11A2 v061 land-surface temperature (8-day, 1 km), one composite per month of
              2024, mean of the cell: daytime and night-time ground temperature (not air temperature)

Layers are packed like the heightmaps: 64 cells per atlas PNG (8 x 8), same order and atlas positions.
  web/public/grid/layers_NN.png   R = WorldCover class code (0 = no data), G = water occurrence 0-100
  web/public/grid/hd_NN.png       Terrarium-encoded 256 px heights
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import numpy as np

from . import DATA_DIR, REPO_DIR
from .grid import ATLAS_DIR, ATLAS_SIDE, CELL_DEG, HEIGHT_PX, OUT_FILE, terrarium_encode

LAYERS_FILE = DATA_DIR / "processed" / "grid" / "cell_layers.json"
LAYERS_WEB = REPO_DIR / "web" / "public" / "data" / "cell_layers.json"
HD_PX = 256
MONTHS_2024 = [f"2024-{m:02d}" for m in range(1, 13)]


def _retry(fn, tries: int = 6):
    """Planetary Computer answers 429 (too many requests) under load: back off and try again."""
    import time

    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1 or "429" not in str(e) and "Timeout" not in str(e) and "timed out" not in str(e):
                raise
            time.sleep(8 * (i + 1))


def _cell_layers(cell: dict[str, Any]) -> dict[str, Any]:
    from .compute import average_to, local_grid, pc_search, pc_signed, warp_into

    lat, lon = cell["lat"], cell["lon"]
    half_km = CELL_DEG * 111.32 / 2
    d = CELL_DEG / 2 + 0.02
    bbox = (lon - d, lat - d, lon + d, lat + d)
    res = 2 * half_km * 1000 / HEIGHT_PX
    out: dict[str, Any] = {"id": cell["id"]}
    crs, t, shape = local_grid(lat, lon, half_km, "earth", res)
    def landcover():
        lc = np.full(shape, np.nan)
        for item in pc_search("esa-worldcover", bbox, limit=4):
            warp_into(lc, f"/vsicurl/{pc_signed(item['assets']['map']['href'])}", crs, t, resampling="mode")
        return np.nan_to_num(lc, nan=0).astype(np.uint8)

    def water():
        occ = np.full(shape, np.nan)
        for item in pc_search("jrc-gsw", bbox, limit=4):
            warp_into(occ, f"/vsicurl/{pc_signed(item['assets']['occurrence']['href'])}", crs, t,
                      resampling="max", valid_max=100)
        return np.nan_to_num(occ, nan=0).clip(0, 100).astype(np.uint8)

    def hd():
        crs30, t30, shape30 = local_grid(lat, lon, half_km, "earth", 30.0)
        native = np.full(shape30, np.nan)
        for item in pc_search("nasadem", bbox):
            warp_into(native, f"/vsicurl/{pc_signed(item['assets']['elevation']['href'])}", crs30, t30)
        hd_res = 2 * half_km * 1000 / HD_PX
        _, hd_t, hd_shape = local_grid(lat, lon, half_km, "earth", hd_res)
        return average_to(native, crs30, t30, hd_t, hd_shape), round(hd_res, 2)

    try:
        out["landcover"] = _retry(landcover)
    except Exception as e:  # noqa: BLE001
        out["landcover_error"] = str(e)[:200]
    try:
        out["water"] = _retry(water)
    except Exception as e:  # noqa: BLE001
        out["water_error"] = str(e)[:200]
    try:
        out["hd"], out["hd_res_m"] = _retry(hd)
    except Exception as e:  # noqa: BLE001
        out["hd_error"] = str(e)[:200]
    return out


def _lst(cells: list[dict[str, Any]]) -> dict[str, dict[str, list[float | None]]]:
    """Monthly MODIS day/night land-surface temperature (deg C) at every cell, from one 8-day composite a month."""
    import rasterio
    from rasterio.warp import Resampling, reproject
    from rasterio.transform import from_origin

    from .compute import GDAL_ENV, pc_search, pc_signed

    step = 0.01
    lon0, lat1 = 51.7, 26.6
    nx, ny = int((60.1 - lon0) / step), int((lat1 - 16.4) / step)
    dst_t = from_origin(lon0, lat1, step, step)
    res: dict[str, dict[str, list[float | None]]] = {c["id"]: {"day": [], "night": []} for c in cells}
    for month in MONTHS_2024:
        items = pc_search("modis-11A2-061", (52.0, 16.6, 59.9, 26.4), datetime_range=f"{month}-08/{month}-16", limit=20)
        grids = {}
        for key, asset in (("day", "LST_Day_1km"), ("night", "LST_Night_1km")):
            g = np.full((ny, nx), np.nan)
            for item in items:
                if asset not in item["assets"]:
                    continue
                with rasterio.Env(**GDAL_ENV), rasterio.open(pc_signed(item["assets"][asset]["href"])) as src:
                    tmp = np.full((ny, nx), np.nan)
                    reproject(source=rasterio.band(src, 1), destination=tmp, src_nodata=0, dst_nodata=np.nan,
                              dst_transform=dst_t, dst_crs="EPSG:4326", resampling=Resampling.nearest)
                fill = np.isnan(g) & np.isfinite(tmp)
                g[fill] = tmp[fill]
            grids[key] = g * 0.02 - 273.15  # MOD11A2 scale factor 0.02 K
        for c in cells:
            r0 = int((lat1 - (c["lat"] + CELL_DEG / 2)) / step)
            c0 = int(((c["lon"] - CELL_DEG / 2) - lon0) / step)
            n = int(CELL_DEG / step)
            for key in ("day", "night"):
                block = grids[key][max(r0, 0):r0 + n, max(c0, 0):c0 + n]
                v = block[np.isfinite(block)]
                res[c["id"]][key].append(round(float(v.mean()), 1) if v.size >= 10 else None)
        print("LST", month, len(items), "items")
    return res


def _pack(cells: list[dict[str, Any]], layers: dict[str, dict[str, Any]]) -> None:
    from PIL import Image

    atlases: dict[str, Any] = {}
    for c in cells:
        hm = c.get("heightmap")
        if not hm:
            continue
        name = hm["atlas"].replace("atlas_", "")
        lay = layers.get(c["id"], {})
        for kind, px in (("layers", HEIGHT_PX), ("hd", HD_PX)):
            key = f"{kind}_{name}"
            if key not in atlases:
                atlases[key] = Image.new("RGB", (ATLAS_SIDE * px,) * 2, (0, 0, 0) if kind == "layers" else (128, 0, 0))
            if kind == "layers" and "landcover" in lay:
                rgb = np.zeros((px, px, 3), np.uint8)
                rgb[..., 0] = lay["landcover"]
                if "water" in lay:
                    rgb[..., 1] = lay["water"]
                atlases[key].paste(Image.fromarray(rgb, "RGB"), (hm["col"] * px, hm["row"] * px))
            elif kind == "hd" and "hd" in lay:
                atlases[key].paste(Image.fromarray(terrarium_encode(lay["hd"]), "RGB"), (hm["col"] * px, hm["row"] * px))
    for key, img in atlases.items():
        img.save(ATLAS_DIR / key, "PNG", optimize=True)


def main() -> None:
    grid = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    cells = [c for c in grid["cells"] if c.get("heightmap")]
    with ThreadPoolExecutor(max_workers=4) as pool:
        done = list(pool.map(_cell_layers, cells))
    layers = {d["id"]: d for d in done}
    for p in ATLAS_DIR.glob("layers_*.png"):
        p.unlink()
    for p in ATLAS_DIR.glob("hd_*.png"):
        p.unlink()
    _pack(cells, layers)
    try:
        lst = _lst(cells)
    except Exception as e:  # noqa: BLE001
        print("LST failed:", e)
        lst = {}
    stats = {}
    for c in cells:
        d = layers[c["id"]]
        s: dict[str, Any] = {}
        if "landcover" in d:
            lc = d["landcover"]
            valid = lc > 0
            n = max(int(valid.sum()), 1)
            s["landcover_pct"] = {str(k): round(100 * float((lc == k).sum()) / n, 1) for k in np.unique(lc[valid]).tolist()}
        if "water" in d:
            w = d["water"]
            s["water_any_pct"] = round(100 * float((w > 0).mean()), 2)
            s["water_seasonal_pct"] = round(100 * float(((w > 0) & (w < 75)).mean()), 2)
            s["water_permanent_pct"] = round(100 * float((w >= 75).mean()), 2)
        if "hd" in d:
            s["hd"] = {"px": HD_PX, "res_m": d["hd_res_m"]}
        if c["id"] in lst:
            s["lst_day"] = lst[c["id"]]["day"]
            s["lst_night"] = lst[c["id"]]["night"]
        for k in ("landcover_error", "water_error", "hd_error"):
            if k in d:
                s[k] = d[k]
        stats[c["id"]] = s
    LAYERS_FILE.write_text(json.dumps({
        "sources": {
            "landcover": "ESA WorldCover 10 m 2021 v200 (Microsoft Planetary Computer), majority per ~217 m pixel",
            "water": "JRC Global Surface Water v1.4 occurrence 1984-2021 (Microsoft Planetary Computer), max per ~217 m pixel",
            "hd": "NASADEM_HGT v001 averaged to 256 px (~109 m)",
            "lst": "NASA MODIS MOD11A2 v061 8-day land-surface temperature, 1 km, one composite per month of 2024",
        },
        "cells": stats,
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    LAYERS_WEB.write_text(LAYERS_FILE.read_text(encoding="utf-8"), encoding="utf-8")
    ok = sum(1 for s in stats.values() if "landcover_pct" in s), sum(1 for s in stats.values() if "water_any_pct" in s), sum(1 for s in stats.values() if "hd" in s), sum(1 for s in stats.values() if s.get("lst_day"))
    print(f"layers for {len(cells)} cells: landcover {ok[0]}, water {ok[1]}, hd {ok[2]}, lst {ok[3]}")


if __name__ == "__main__":
    main()
