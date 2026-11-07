"""Mineral indices over an Oman site from NASA EMIT L2A reflectance (EMITL2ARFL v001).

Needs a NASA Earthdata Login (~/.netrc or EARTHDATA_USERNAME / EARTHDATA_PASSWORD). Granules are
~3.6 GB, so they are never downloaded: files are opened over HTTPS with earthaccess and only the
needed arrays are read with h5netcdf (lat/lon, the mask, and a few reflectance bands).

Scene selection is a fixed rule, decided before looking at any index value:
  1. candidates = granules whose footprint contains the whole window, lowest scene cloud cover
     first (ties: newest first), at most MAX_CANDIDATES;
  2. for each candidate count clear pixels in the window (EMIT_L2A_MASK "Aggregate Flag" == 0);
  3. keep up to MAX_SCENES scenes with the most clear pixels; the site value is the mean band depth
     over all their clear pixels together.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import numpy as np

from ..metrics.mineralogy import REQUIRED_WAVELENGTHS_UM, mineral_metrics
from ..provenance import Measured, Missing

SHORT_NAME, VERSION = "EMITL2ARFL", "001"
MAX_CANDIDATES = 5
MAX_SCENES = 3

_LOGGED_IN: bool | None = None
ENV_FILE = Path(__file__).resolve().parents[4] / ".env.local"
TOKEN_VARS = ("EARTHDATA_TOKEN", "ETHINA_LOGIN")  # ETHINA_LOGIN: the project's name for the EDL token


def _token_from_env_file() -> None:
    """Expose an Earthdata token kept in the repo's .env.local (git-ignored) as EARTHDATA_TOKEN."""
    if os.getenv("EARTHDATA_TOKEN"):
        return
    values = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.strip().startswith("#"):
                values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    token = next((values[k] for k in TOKEN_VARS if values.get(k)), None)
    if token:
        os.environ["EARTHDATA_TOKEN"] = token


def logged_in() -> bool:
    """True when earthaccess finds credentials in the environment or ~/.netrc (never prompts)."""
    global _LOGGED_IN
    if _LOGGED_IN is None:
        import earthaccess

        _token_from_env_file()

        _LOGGED_IN = False
        for strategy in ("environment", "netrc"):
            try:
                auth = earthaccess.login(strategy=strategy)
            except Exception:
                continue
            if auth is not None and getattr(auth, "authenticated", False):
                _LOGGED_IN = True
                break
    return _LOGGED_IN


def _inside(polygon: list[tuple[float, float]], lon: float, lat: float) -> bool:
    """Ray-casting point-in-polygon test on (lon, lat) vertices."""
    inside = False
    for (x1, y1), (x2, y2) in zip(polygon, polygon[1:] + polygon[:1]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _footprint(granule) -> list[tuple[float, float]]:
    geo = granule["umm"]["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"][0]
    return [(p["Longitude"], p["Latitude"]) for p in geo["Boundary"]["Points"]]


def _cloud(granule) -> float:
    return float(granule["umm"].get("CloudCover", 100.0))


def _granule_id(granule) -> str:
    return granule["umm"]["GranuleUR"]


def _links(granule) -> dict[str, str]:
    """https links of the RFL and MASK netCDF files of one granule."""
    out = {}
    for url in granule.data_links(access="external"):
        name = url.rsplit("/", 1)[-1]
        if name.startswith("EMIT_L2A_RFL_") and name.endswith(".nc"):
            out["rfl"] = url
        elif name.startswith("EMIT_L2A_MASK_") and name.endswith(".nc"):
            out["mask"] = url
    return out


def candidates(bbox: tuple[float, float, float, float]) -> list:
    import earthaccess

    west, south, east, north = bbox
    found = earthaccess.search_data(short_name=SHORT_NAME, version=VERSION, bounding_box=bbox, count=500)
    corners = [(west, south), (west, north), (east, south), (east, north)]
    full = [g for g in found if all(_inside(_footprint(g), *c) for c in corners)]
    full.sort(key=lambda g: (_cloud(g), [-ord(ch) for ch in _granule_id(g)]))
    return full[:MAX_CANDIDATES]


def _window_pixels(lat: np.ndarray, lon: np.ndarray, bbox) -> tuple[slice, slice, np.ndarray] | None:
    west, south, east, north = bbox
    inside = (lat >= south) & (lat <= north) & (lon >= west) & (lon <= east)
    rows, cols = np.nonzero(inside)
    if rows.size == 0:
        return None
    rs, cs = slice(rows.min(), rows.max() + 1), slice(cols.min(), cols.max() + 1)
    return rs, cs, inside[rs, cs]


def _scene(granule, bbox) -> dict[str, Any] | None:
    """Clear-pixel mask of the window plus where to read reflectance (no reflectance read yet)."""
    import earthaccess
    import h5netcdf

    links = _links(granule)
    mask_file, = earthaccess.open([links["mask"]])
    with h5netcdf.File(mask_file, "r") as f:
        lat, lon = f["location/lat"][:], f["location/lon"][:]
        win = _window_pixels(lat, lon, bbox)
        if win is None:
            return None
        rs, cs, inside = win
        names = [n.decode() if isinstance(n, bytes) else str(n) for n in f["sensor_band_parameters/mask_bands"][:]]
        agg = f["mask"][rs, cs, names.index("Aggregate Flag")]
    clear = inside & (agg == 0)
    return {"granule": granule, "links": links, "rows": rs, "cols": cs, "clear": clear,
            "n_clear": int(clear.sum()), "n_window": int(inside.sum())}


def _reflectance(scene: dict) -> tuple[np.ndarray, np.ndarray]:
    """Cube (bands, rows, cols) of the needed good bands, with non-clear pixels set to NaN."""
    import earthaccess
    import h5netcdf

    rfl_file, = earthaccess.open([scene["links"]["rfl"]])
    with h5netcdf.File(rfl_file, "r") as f:
        wl = f["sensor_band_parameters/wavelengths"][:] / 1000.0
        good = f["sensor_band_parameters/good_wavelengths"][:].astype(bool)
        good_idx = np.nonzero(good)[0]
        idx = sorted({int(good_idx[np.argmin(np.abs(wl[good_idx] - w))]) for w in REQUIRED_WAVELENGTHS_UM})
        data = f["reflectance"][scene["rows"], scene["cols"], idx].astype("float64")
    data[data <= -9999] = np.nan
    cube = np.moveaxis(data, -1, 0)
    cube[:, ~scene["clear"]] = np.nan
    return wl[idx], cube


def _with_retries(read, attempts: int = 3, wait_s: float = 5.0):
    """LP DAAC answers 502/503 now and then; try a few times before giving up on a scene."""
    for i in range(attempts):
        try:
            return read()
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(wait_s * (i + 1))


def mineral_values(site: dict, bbox: tuple[float, float, float, float], features: tuple[str, ...]) -> list[Measured | Missing]:
    cands = candidates(bbox)
    scenes, skipped = [], []
    for g in cands:
        try:
            sc = _with_retries(lambda: _scene(g, bbox))
        except Exception as exc:
            skipped.append({"granule": _granule_id(g), "error": f"{type(exc).__name__}: {exc}"[:200]})
            continue
        if sc and sc["n_clear"] > 0:
            scenes.append(sc)
    if cands and len(skipped) == len(cands):
        raise RuntimeError(f"all {len(cands)} EMIT masks failed to read; first error: {skipped[0]['error']}")
    scenes.sort(key=lambda s: -s["n_clear"])
    # Read reflectance in that order; a scene the server keeps failing on is skipped (and recorded),
    # and the next-ranked scene takes its place. The ranking rule itself does not change.
    read = []
    for s in scenes:
        if len(read) == MAX_SCENES:
            break
        try:
            read.append((s, _with_retries(lambda: _reflectance(s))))
        except Exception as exc:
            skipped.append({"granule": _granule_id(s["granule"]), "error": f"{type(exc).__name__}: {exc}"[:200]})
    if scenes and not read:
        raise RuntimeError(f"all {len(scenes)} EMIT scenes failed to read; first error: {skipped[0]['error']}")
    scenes = [s for s, _ in read]
    if not scenes:
        detail = f"{len(cands)} candidate scenes checked, no clear pixel in the window"
        return [Missing(f, "no_coverage", "NASA EMIT L2A reflectance (EMITL2ARFL v001)",
                        "A cloud-free EMIT acquisition over the window (or relaxing the cloud mask, which needs a cited justification).",
                        "مشهد EMIT خالٍ من الغيوم فوق النافذة.", detail, f"فُحص {len(cands)} مشهداً بلا بكسل صافٍ")
                for f in features]

    # Each scene keeps its own band centres (good-band lists differ slightly between granules), so
    # depths are computed per scene and pooled weighted by pixel count. Band depth is per pixel, so
    # this equals the mean over all clear pixels of all scenes together.
    per_scene, sums, counts = [], {}, {}
    for s, (wl, cube) in read:
        valid = np.isfinite(cube).all(axis=0)
        scene_vals = mineral_metrics(cube[:, valid][:, :, None], wl)
        for f, (mean, n) in scene_vals.items():
            if n:
                sums[f] = sums.get(f, 0.0) + mean * n
                counts[f] = counts.get(f, 0) + n
        per_scene.append({"granule": _granule_id(s["granule"]), "clear_pixels": int(valid.sum()),
                          "window_pixels": s["n_window"], "wavelengths_um": [round(float(w), 4) for w in wl],
                          **{f: round(v[0], 6) for f, v in scene_vals.items()}})
    values = {f: (sums[f] / counts[f] if counts.get(f) else float("nan"), counts.get(f, 0)) for f in scene_vals}
    granules = [s["granule"] for s in scenes]
    prov = {
        "dataset": "NASA EMIT L2A estimated surface reflectance, LP DAAC (CMR C2408750690-LPCLOUD)",
        "version": VERSION, "products": [_granule_id(g) for g in granules],
        "urls": [s["links"]["rfl"] for s in scenes],
        "acquired": [g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10] for g in granules],
        "native_resolution_m": 60, "scenes": per_scene, "skipped_scenes": skipped,
        "selection": (f"{len(cands)} candidates whose footprint contains the window (lowest scene cloud cover); "
                      f"kept the {len(scenes)} with most clear pixels (mask Aggregate Flag == 0)."),
    }
    out: list[Measured | Missing] = []
    for f in features:
        value, n = values[f]
        out.append(Measured(f, value, {**prov, "valid_pixels": n, "processing": (
            "Window pixels selected by EMIT per-pixel lat/lon (sensor geometry, no resampling), cloud/water "
            "pixels removed with the L2A mask, good wavelengths only; mean band depth over all clear pixels "
            "of the selected scenes (see metrics/mineralogy.py).")}))
    return out
