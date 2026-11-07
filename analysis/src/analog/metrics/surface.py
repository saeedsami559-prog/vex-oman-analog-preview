"""Surface physical properties: albedo and thermal inertia helpers.

Mars thermal inertia comes straight from published maps (THEMIS quantitative mosaic, TES), see
compute.py. For Earth, MODIS day/night land-surface temperature only gives apparent thermal
inertia (ATI). Converting ATI into thermal inertia (TIU, comparable with Mars) needs a calibration
for which we have no cited source, so Earth thermal inertia is reported as missing
(`calibration_missing`) rather than estimated. `apparent_thermal_inertia` is kept for the
methodology notebook only and never enters the score.
"""

from __future__ import annotations

import numpy as np


def summary(values: np.ndarray) -> float:
    """Robust site value: median of finite pixels."""
    finite = values[np.isfinite(values)]
    return float(np.median(finite)) if finite.size else float("nan")


def apparent_thermal_inertia(albedo: np.ndarray, t_day_k: np.ndarray, t_night_k: np.ndarray) -> np.ndarray:
    """ATI = (1 - albedo) / (T_day - T_night). Larger day/night swing -> lower inertia."""
    delta = t_day_k.astype(float) - t_night_k.astype(float)
    with np.errstate(divide="ignore", invalid="ignore"):
        ati = (1.0 - albedo) / delta
    ati[delta <= 0] = np.nan
    return ati
