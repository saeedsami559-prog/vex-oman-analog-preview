"""Unit/scale normalisation shared by the similarity index.

Ranges are not hand-picked: export.py sets each feature's range to the min..max of the values
measured at all sites (Earth, Mars and Moon pooled), after the feature's scale transform.
Features spanning orders of magnitude (roughness, relief) use log10 so a few extreme sites do not
squeeze every other site into the bottom of the range.

Mirrors web/src/lib/similarity.ts - keep the two in sync (tests/test_parity.py checks it).
"""

from __future__ import annotations

import math
from typing import Iterable, Mapping, Optional, Sequence

Raw = Mapping[str, Optional[float]]


def transform(value: float, scale: Optional[str]) -> float:
    """Apply the feature's scale (None = linear, "log10")."""
    if scale is None or scale == "linear":
        return float(value)
    if scale == "log10":
        if value <= 0:
            raise ValueError(f"log10 scale needs positive values, got {value}")
        return math.log10(value)
    raise ValueError(f"unknown scale {scale}")


def normalize_value(value: Optional[float], value_range: Optional[Sequence[float]],
                    scale: Optional[str] = None) -> Optional[float]:
    """Map a raw value to 0..1 with a fixed range (in transformed units), clipping outliers.

    None stays None; a feature without a range (fewer than two measured sites) is not compared.
    """
    if value is None or (isinstance(value, float) and math.isnan(value)) or value_range is None:
        return None
    lo, hi = value_range
    if hi == lo:
        return None
    t = (transform(value, scale) - lo) / (hi - lo)
    return min(1.0, max(0.0, t))


def range_for(config: Mapping, feature: str, body: Optional[str] = None) -> Optional[Sequence[float]]:
    """Normalisation range for one site's value.

    Features listed in `body_relative_features` are measured by different instruments on each body
    (EMIT on Earth, CRISM on Mars) whose absolute band depths are not on one scale, so each body gets
    its own range: a site is placed relative to the other sites seen by the same instrument.
    Without a body (old callers, unit tests) the pooled range is used.
    """
    by_body = (config.get("feature_ranges_by_body") or {}).get(feature)
    if by_body is not None and body is not None:
        return by_body.get(body)
    return config["feature_ranges"].get(feature)


def pooled_range(values: Iterable[Optional[float]], scale: Optional[str] = None) -> Optional[list[float]]:
    """min..max of the measured values after the scale transform; None if fewer than two differ."""
    xs = [transform(v, scale) for v in values if v is not None]
    if len(xs) < 2 or min(xs) == max(xs):
        return None
    return [min(xs), max(xs)]


def resolution_factor(res_a: Optional[float], res_b: Optional[float], k: float, min_factor: float) -> float:
    """1.0 when both datasets share a resolution, falling as the ratio grows (floored)."""
    if not res_a or not res_b:
        return 1.0
    return max(min_factor, 1.0 - k * abs(math.log2(res_a / res_b)))
