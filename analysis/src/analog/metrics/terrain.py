"""Terrain metrics from a DEM (2-D numpy array of elevations in metres).

All functions are pure numpy so they work the same on NASADEM, MOLA or LOLA once the DEM has
been reprojected onto the common grid. compute.py does that with GDAL area-weighted averaging
straight to `common_terrain_scale_m` (exactly 463 m), because fine grids always look rougher and
a whole-pixel block factor (round(463/30) = 15 -> 450 m) would not land on the same spacing.
"""

from __future__ import annotations

import numpy as np


def slope_deg(dem: np.ndarray, res_m: float) -> np.ndarray:
    """Per-pixel slope in degrees using central differences."""
    dz_dy, dz_dx = np.gradient(dem.astype(float), res_m)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def _windows(dem: np.ndarray, size: int):
    """Yield non-overlapping square windows of `size` pixels."""
    for r in range(0, dem.shape[0] - size + 1, size):
        for c in range(0, dem.shape[1] - size + 1, size):
            yield dem[r:r + size, c:c + size]


def _detrend_plane(window: np.ndarray) -> np.ndarray:
    """Remove the best-fit plane so regional tilt does not count as roughness."""
    rows, cols = np.indices(window.shape)
    design = np.column_stack([rows.ravel(), cols.ravel(), np.ones(window.size)])
    values = window.ravel()
    ok = np.isfinite(values)
    coef, *_ = np.linalg.lstsq(design[ok], values[ok], rcond=None)
    return window - (design @ coef).reshape(window.shape)


def roughness_rms_m(dem: np.ndarray, res_m: float, window_m: float = 1400.0) -> float:
    """Median RMS height (m) after removing a plane in each window."""
    size = max(3, int(round(window_m / res_m)))
    rms = [float(np.sqrt(np.nanmean(_detrend_plane(w) ** 2))) for w in _windows(dem, size)]
    return float(np.median(rms)) if rms else float("nan")


def relief_m(dem: np.ndarray, res_m: float, window_m: float = 5000.0) -> float:
    """Median of (max - min) elevation inside windows of `window_m`."""
    size = max(2, int(round(window_m / res_m)))
    ranges = [float(np.nanmax(w) - np.nanmin(w)) for w in _windows(dem, size)]
    if not ranges:  # clip smaller than one window: use the whole tile
        return float(np.nanmax(dem) - np.nanmin(dem))
    return float(np.median(ranges))


def terrain_metrics(dem: np.ndarray, res_m: float) -> dict[str, float]:
    """Compute the three terrain features from a DEM already on the common grid."""
    return {
        "slope_deg": float(np.nanmean(slope_deg(dem, res_m))),
        "roughness_m": roughness_rms_m(dem, res_m),
        "relief_m": relief_m(dem, res_m),
    }
