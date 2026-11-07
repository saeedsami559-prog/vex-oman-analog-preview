"""Map layers from the same DEMs the scores use: elevation (hypsometric tint + hillshade), slope,
and a topographic drainage network with closed depressions.

    python -m analog.layers            # all Earth and Mars sites
    python -m analog.layers --site jezero_crater

Output (small PNGs + one JSON per site) goes to web/public/layers/<site>/ and is read by the maps.

The grid is geographic (plate carree) over a context window larger than the scoring window, so
images line up exactly with the Leaflet maps. Slopes use the metric pixel size at each latitude.

Drainage is *topographic*: it shows where water would flow and pond given today's surface, not
where water is now (Earth) or ever was (Mars, where the surface has changed since valleys formed).
  1. Depressions filled with Priority-Flood + epsilon (Barnes et al. 2014, Computers & Geosciences
     62, 117-127, doi:10.1016/j.cageo.2013.04.024), so every cell drains to the window edge.
  2. D8 flow direction (O'Callaghan & Mark 1984, CVGIP 28, 323-344, doi:10.1016/S0734-189X(84)80011-0).
  3. Flow accumulation in upstream area; a cell is a channel when that area exceeds STREAM_KM2.
  4. Closed depressions = cells raised by the fill by more than DEPRESSION_M.
The Moon is skipped: there is no drainage, and a lat/lon image at 89.9 S cannot be overlaid on
the equirectangular map without severe distortion.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import CONFIG_DIR
from .compute import MOLA_URL, _bbox_deg, _unsigned, average_to, pc_search, pc_signed, warp_into
from .download.sites import BODY_RADIUS_KM, bbox_for, load_sites

OUT_DIR = CONFIG_DIR.parents[1] / "web" / "public" / "layers"

# Share of the window below 2 degrees above which DEM noise (a few metres in NASADEM) can steer the
# computed channels; the legend then warns that lines on flat ground are indicative only.
FLAT_SHARE = 0.6

# Context window half-width (km) and native pixel size (m) per body.
LAYER = {
    "earth": {"half_km": lambda s: max(2 * s["bbox_km"], 20), "res_m": 30.0},
    "mars": {"half_km": lambda s: 60, "res_m": 463.0},
}
STREAM_KM2 = {"earth": 5.0, "mars": 200.0}  # upstream area that starts a channel
DEPRESSION_M = {"earth": 2.0, "mars": 20.0}  # fill depth that marks a closed basin

# Like-for-like numbers: slope and drainage depend on pixel size, so every site is also measured on
# the scoring grid (DEM area-averaged to exactly 463 m, as compute.py does) with one set of
# thresholds. Mars is already at 463 m, so its "common" numbers equal its native ones.
COMMON = {"res_m": 463.0, "stream_km2": 200.0, "depression_m": 20.0}


# ---------- DEM on a geographic grid ----------

def geo_grid(site: dict, half_km: float, res_m: float):
    from rasterio.crs import CRS
    from rasterio.transform import from_bounds

    b = bbox_for(site["lat"], site["lon"], half_km, site["body"])
    km_per_deg = math.pi * BODY_RADIUS_KM[site["body"]] / 180.0
    rows = int(round((b.north - b.south) * km_per_deg * 1000 / res_m))
    cols = int(round((b.east - b.west) * km_per_deg * math.cos(math.radians(site["lat"])) * 1000 / res_m))
    if site["body"] == "earth":
        crs = CRS.from_epsg(4326)
    else:
        crs = CRS.from_proj4(f"+proj=longlat +R={BODY_RADIUS_KM[site['body']] * 1000} +no_defs")
    return b, crs, from_bounds(b.west, b.south, b.east, b.north, cols, rows), (rows, cols)


def read_dem(site: dict) -> tuple[np.ndarray, object, dict]:
    spec = LAYER[site["body"]]
    half = spec["half_km"](site)
    b, crs, t, shape = geo_grid(site, half, spec["res_m"])
    dem = np.full(shape, np.nan)
    if site["body"] == "earth":
        ctx = {**site, "bbox_km": half}
        items = pc_search("nasadem", _bbox_deg(ctx))
        for item in items:
            warp_into(dem, f"/vsicurl/{pc_signed(item['assets']['elevation']['href'])}", crs, t)
        source = {"dataset": "NASADEM_HGT v001 (Microsoft Planetary Computer COG mirror)",
                  "products": [i["id"] for i in items],
                  "urls": [_unsigned(i["assets"]["elevation"]["href"]) for i in items], "native_resolution_m": 30}
    else:
        warp_into(dem, f"/vsicurl/{MOLA_URL}", crs, t)
        source = {"dataset": "MGS MOLA DEM global mosaic 463 m (USGS Astrogeology)",
                  "products": ["Mars_MGS_MOLA_DEM_mosaic_global_463m"], "urls": [MOLA_URL], "native_resolution_m": 463}
    meta = {"bounds": [[b.south, b.west], [b.north, b.east]], "half_km": half, "shape": list(shape), "source": source}
    return dem, t, meta


def pixel_size_m(site: dict, transform, rows: int) -> tuple[np.ndarray, float]:
    """(dx per row, dy) in metres for a geographic grid."""
    m_per_deg = math.pi * BODY_RADIUS_KM[site["body"]] * 1000 / 180.0
    lat = transform.f + (np.arange(rows) + 0.5) * transform.e
    return np.abs(transform.a) * m_per_deg * np.cos(np.radians(lat)), abs(transform.e) * m_per_deg


# ---------- hydrology ----------

OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def priority_flood(dem: np.ndarray, eps: float = 1e-3) -> np.ndarray:
    """Fill depressions so every cell has a downhill path to the edge (Barnes et al. 2014)."""
    rows, cols = dem.shape
    filled = np.where(np.isfinite(dem), dem, -np.inf)  # nodata acts as an outlet
    done = np.zeros(dem.shape, dtype=bool)
    heap: list[tuple[float, int, int]] = []
    for r in range(rows):
        for c in (0, cols - 1):
            heap.append((filled[r, c], r, c)); done[r, c] = True
    for c in range(1, cols - 1):
        for r in (0, rows - 1):
            heap.append((filled[r, c], r, c)); done[r, c] = True
    heapq.heapify(heap)
    while heap:
        z, r, c = heapq.heappop(heap)
        for dr, dc in OFFSETS:
            rr, cc = r + dr, c + dc
            if 0 <= rr < rows and 0 <= cc < cols and not done[rr, cc]:
                done[rr, cc] = True
                if filled[rr, cc] <= z:
                    filled[rr, cc] = z + eps
                heapq.heappush(heap, (filled[rr, cc], rr, cc))
    return filled


def d8_accumulation(filled: np.ndarray, dx: np.ndarray, dy: float) -> np.ndarray:
    """Upstream area (m^2) per cell, routing each cell to its steepest-descent neighbour."""
    rows, cols = filled.shape
    pad = np.pad(filled, 1, constant_values=-np.inf)
    best = np.zeros(filled.shape)
    receiver = np.full(filled.shape, -1, dtype=np.int64)
    idx = np.arange(rows * cols).reshape(rows, cols)
    for dr, dc in OFFSETS:
        nb = pad[1 + dr:1 + dr + rows, 1 + dc:1 + dc + cols]
        dist = np.sqrt((dc * dx[:, None]) ** 2 + (dr * dy) ** 2)
        with np.errstate(invalid="ignore"):
            drop = (filled - nb) / dist
        rr, cc = np.clip(np.arange(rows)[:, None] + dr, 0, rows - 1), np.clip(np.arange(cols)[None, :] + dc, 0, cols - 1)
        inside = (np.arange(rows)[:, None] + dr >= 0) & (np.arange(rows)[:, None] + dr < rows) & \
                 (np.arange(cols)[None, :] + dc >= 0) & (np.arange(cols)[None, :] + dc < cols)
        take = (drop > best) & inside
        best[take] = drop[take]
        receiver[take] = idx[rr, cc][take]
    area = np.repeat(dx * dy, cols).astype(float)
    recv = receiver.ravel()
    for i in np.argsort(-filled.ravel(), kind="stable"):
        j = recv[i]
        if j >= 0:
            area[j] += area[i]
    return area.reshape(rows, cols)


# ---------- rendering ----------

def hillshade(dem: np.ndarray, dx: np.ndarray, dy: float, azimuth: float = 315, altitude: float = 45) -> np.ndarray:
    z = np.where(np.isfinite(dem), dem, np.nanmean(dem))
    gy, gx = np.gradient(z, dy, axis=0), np.gradient(z, axis=1) / dx[:, None]
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(360 - azimuth + 90), math.radians(altitude)
    return np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)


def slope_deg(dem: np.ndarray, dx: np.ndarray, dy: float) -> np.ndarray:
    gy, gx = np.gradient(dem, dy, axis=0), np.gradient(dem, axis=1) / dx[:, None]
    return np.degrees(np.arctan(np.hypot(gx, gy)))


MAX_PX = 1000  # images are shrunk to at most this many pixels a side; analysis stays at native resolution


def save_rgba(path: Path, rgba: np.ndarray, pool: str = "mean", palette: bool = False) -> None:
    """Shrink by an integer factor (block mean, or block max so thin channels survive) and write a
    PNG. `palette`: opaque 256-colour image (quantizing drops alpha; the map sets the opacity)."""
    from PIL import Image

    k = math.ceil(max(rgba.shape[:2]) / MAX_PX)
    if k > 1:
        r, c = (rgba.shape[0] // k) * k, (rgba.shape[1] // k) * k
        blocks = rgba[:r, :c].reshape(r // k, k, c // k, k, 4)
        rgba = blocks.max(axis=(1, 3)) if pool == "max" else blocks.mean(axis=(1, 3))
    img = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
    if palette:
        img = img.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT)
    img.save(path, optimize=True)


ELEV_CMAP = "terrain"
SLOPE_BINS = [0, 2, 5, 10, 20, 30, 90]  # degrees; classes shown in the legend
SLOPE_COLORS = ["#1a9850", "#91cf60", "#d9ef8b", "#fee08b", "#fc8d59", "#d73027"]


def slope_classes(s: np.ndarray) -> np.ndarray:
    return np.clip(np.digitize(s, SLOPE_BINS[1:-1]), 0, len(SLOPE_COLORS) - 1)


def slope_share(s: np.ndarray, valid: np.ndarray) -> dict[str, float]:
    # np.digitize puts NaN in the top class, so cells whose slope is undefined (next to nodata) are dropped
    ok = valid & np.isfinite(s)
    cls = slope_classes(s)
    return {f"{SLOPE_BINS[i]}-{SLOPE_BINS[i + 1]}": round(float((cls[ok] == i).mean()), 4) for i in range(len(SLOPE_COLORS))}


def drainage_stats(dem: np.ndarray, dx: np.ndarray, dy: float, stream_km2: float, depression_m: float):
    """(stats dict, upstream area km2, stream mask, basin mask) for one DEM and threshold set."""
    valid = np.isfinite(dem)
    filled = priority_flood(dem)
    area_km2 = d8_accumulation(filled, dx, dy) / 1e6
    depth = np.where(valid, filled - dem, 0)
    basin = depth > depression_m
    stream = (area_km2 >= stream_km2) & valid
    cell_km2 = (dx[:, None] * dy / 1e6) * np.ones(dem.shape[1])[None, :]  # true cell area per row
    stats = {"stream_km2": stream_km2, "depression_m": depression_m,
             "channel_share": round(float(stream[valid].mean()), 4),
             "depression_km2": round(float(cell_km2[basin].sum()), 2),
             "max_upstream_km2": round(float(area_km2[valid].max()), 1)}
    return stats, area_km2, stream, basin


def common_scale_stats(site: dict, dem: np.ndarray, t, meta: dict) -> dict:
    """Slope classes and drainage on the 463 m scoring grid with the common thresholds."""
    if meta["source"]["native_resolution_m"] >= COMMON["res_m"]:
        coarse, ct = dem, t
    else:
        _, crs, _, _ = geo_grid(site, meta["half_km"], LAYER[site["body"]]["res_m"])
        _, _, ct, shape = geo_grid(site, meta["half_km"], COMMON["res_m"])
        coarse = average_to(dem, crs, t, ct, shape)
    valid = np.isfinite(coarse)
    dx, dy = pixel_size_m(site, ct, coarse.shape[0])
    stats, *_ = drainage_stats(coarse, dx, dy, COMMON["stream_km2"], COMMON["depression_m"])
    return {"res_m": COMMON["res_m"], "shape": list(coarse.shape),
            "slope_share": slope_share(slope_deg(coarse, dx, dy), valid), "drainage": stats}


def render(site: dict) -> dict:
    import matplotlib

    dem, t, meta = read_dem(site)
    valid = np.isfinite(dem)
    if valid.mean() < 0.9:
        raise RuntimeError(f"{site['id']}: DEM covers only {valid.mean():.0%} of the layer window")
    dx, dy = pixel_size_m(site, t, dem.shape[0])
    out = OUT_DIR / site["id"]
    out.mkdir(parents=True, exist_ok=True)

    # elevation: 2-98 % stretch so a single peak does not wash out the tint
    lo, hi = (float(v) for v in np.nanpercentile(dem, [2, 98]))
    tint = matplotlib.colormaps[ELEV_CMAP]((np.clip((dem - lo) / (hi - lo), 0, 1) * 0.75 + 0.22))  # skip sea blues
    shade = hillshade(dem, dx, dy)[..., None]
    rgba = tint.copy()
    rgba[..., :3] = tint[..., :3] * (0.45 + 0.55 * shade)
    rgba[..., 3] = valid
    save_rgba(out / "elevation.png", rgba, palette=True)

    # slope classes
    s = slope_deg(dem, dx, dy)
    palette = np.array([matplotlib.colors.to_rgba(c) for c in SLOPE_COLORS])
    rgba = palette[slope_classes(s)]
    rgba[..., 3] = np.where(valid & np.isfinite(s), 0.85, 0)
    save_rgba(out / "slope.png", rgba, palette=True)
    share = slope_share(s, valid)

    # drainage
    drain, area_km2, stream, basin = drainage_stats(dem, dx, dy, STREAM_KM2[site["body"]], DEPRESSION_M[site["body"]])
    strength = np.clip(np.log10(np.maximum(area_km2, 1e-9) / STREAM_KM2[site["body"]]) / 3, 0, 1)
    rgba = np.zeros(dem.shape + (4,))
    rgba[basin] = (0.30, 0.85, 0.95, 0.45)
    rgba[stream, 0], rgba[stream, 1], rgba[stream, 2] = 0.10, 0.45 + 0.2 * strength[stream], 1.0
    rgba[stream, 3] = 0.65 + 0.35 * strength[stream]
    save_rgba(out / "drainage.png", rgba, pool="max")

    common = common_scale_stats(site, dem, t, meta)
    meta.update({
        "site": site["id"], "body": site["body"],
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "elevation_m": {"min": round(float(np.nanmin(dem)), 1), "max": round(float(np.nanmax(dem)), 1),
                        "p2": round(lo, 1), "p98": round(hi, 1), "cmap": ELEV_CMAP},
        "slope": {"bins_deg": SLOPE_BINS, "colors": SLOPE_COLORS, "share": share},
        "drainage": {**drain, "flat": share["0-2"] > FLAT_SHARE},
        "common": common,
        "method": "Priority-Flood fill (Barnes et al. 2014) + D8 flow direction (O'Callaghan & Mark 1984)",
    })
    with open(out / "meta.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", help="one site id (default: all Earth and Mars sites)")
    args = parser.parse_args()
    sites = load_sites()
    ids = [args.site] if args.site else [k for k, s in sites.items() if s["body"] in LAYER]
    index = {}
    for sid in ids:
        m = render(sites[sid])
        print(f"[{sid}] {m['shape']} elev {m['elevation_m']['min']}..{m['elevation_m']['max']} m, "
              f"channels {m['drainage']['channel_share']:.1%}, basins {m['drainage']['depression_km2']} km2")
    for d in sorted(OUT_DIR.iterdir()):
        if (d / "meta.json").exists():
            index[d.name] = True
    with open(OUT_DIR / "index.json", "w", encoding="utf-8") as fh:
        json.dump(sorted(index), fh)


if __name__ == "__main__":
    main()
