"""Mineral indices from reflectance cubes (EMIT L2A reflectance, CRISM MTRDR I/F).

A cube is a numpy array shaped (bands, rows, cols) with matching `wavelengths_um`.
The same code runs on Earth and Mars data so the two sides are processed identically.

Site index = mean band depth over all valid pixels in the window. There is deliberately no
detection threshold or saturation constant: we have no cited calibration for one, and a mean
depth already grows with both how much of the window shows the absorption and how strong it is.
The result is a spectral proxy, not a mineral abundance.

Band positions (centre, shoulders):
  serpentine  2.32 um Mg-OH combination band (Ehlmann et al. 2010, GRL 37, L06201)
  carbonate   2.30-2.34 um AND 2.50-2.55 um CO3 bands; requiring both separates carbonate from
              serpentine, which has no 2.5 um band (Ehlmann et al. 2008, Science 322, 1828)

Chlorides have no diagnostic absorption between 0.4 and 2.5 um; mapping them needs brightness and
slope thresholds for which we have no cited calibration, so no chloride index is computed.
"""

from __future__ import annotations

import numpy as np

# (center, left shoulder, right shoulder) in micrometres
SERPENTINE_BAND = (2.32, 2.25, 2.38)
CARBONATE_BAND = (2.33, 2.27, 2.40)
CARBONATE_BAND_2 = (2.50, 2.43, 2.56)

# Every wavelength the indices read; readers fetch only these bands.
REQUIRED_WAVELENGTHS_UM = sorted({w for band in (SERPENTINE_BAND, CARBONATE_BAND, CARBONATE_BAND_2) for w in band})


def _band(cube: np.ndarray, wavelengths_um: np.ndarray, target: float) -> np.ndarray:
    return cube[int(np.argmin(np.abs(wavelengths_um - target)))].astype(float)


def band_depth(cube: np.ndarray, wavelengths_um: np.ndarray, band: tuple[float, float, float]) -> np.ndarray:
    """Classic band depth: 1 - R_center / continuum, continuum interpolated between shoulders."""
    center, left, right = band
    r_c, r_l, r_r = (_band(cube, wavelengths_um, w) for w in (center, left, right))
    t = (center - left) / (right - left)
    continuum = (1 - t) * r_l + t * r_r
    with np.errstate(divide="ignore", invalid="ignore"):
        depth = 1.0 - r_c / continuum
    return np.clip(depth, 0.0, 1.0)


def mean_band_depth(depth: np.ndarray) -> tuple[float, int]:
    """Mean depth over finite pixels, and how many pixels that mean is based on."""
    valid = depth[np.isfinite(depth)]
    return (float(valid.mean()) if valid.size else float("nan")), int(valid.size)


def mineral_metrics(cube: np.ndarray, wavelengths_um: np.ndarray) -> dict[str, tuple[float, int]]:
    """{feature: (mean depth, valid pixel count)} for serpentine and carbonate."""
    carb_depth = np.minimum(
        band_depth(cube, wavelengths_um, CARBONATE_BAND),
        band_depth(cube, wavelengths_um, CARBONATE_BAND_2),
    )  # carbonates need BOTH bands; serpentine alone has no 2.5 um feature
    return {
        "serpentine_index": mean_band_depth(band_depth(cube, wavelengths_um, SERPENTINE_BAND)),
        "carbonate_index": mean_band_depth(carb_depth),
    }
