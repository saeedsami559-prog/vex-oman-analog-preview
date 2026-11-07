"""Similarity index between an Earth site and a planetary target.

score_c    = mean over features measured on both sides of (1 - |norm_a - norm_b|)   (0..1)
             (signal_floor features are skipped when both sides are below the floor: no shared signal)
overall    = sum(w_c * score_c) / sum(w_c)   over criteria with at least one shared feature
coverage   = sum(w_c * shared_c / n_c) / sum(w_c with w_c > 0)   (a missing feature lowers it)
res_mean   = sum(w_c * resfactor_c) / sum(w_c)   over criteria with data
confidence = coverage * res_mean

Mirrors web/src/lib/similarity.ts operation-for-operation so both give the same numbers.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from .normalize import normalize_value, range_for, resolution_factor


def similarity(
    raw_a: Mapping[str, Optional[float]],
    raw_b: Mapping[str, Optional[float]],
    res_a: Mapping[str, Optional[float]],
    res_b: Mapping[str, Optional[float]],
    config: Mapping[str, Any],
    weights: Optional[Mapping[str, float]] = None,
    body_a: Optional[str] = None,
    body_b: Optional[str] = None,
) -> dict[str, Any]:
    criteria = config["criteria"]
    scales = config.get("feature_scale") or {}
    conf_cfg = config["confidence"]
    k = conf_cfg["resolution_k"]
    min_factor = conf_cfg["resolution_min_factor"]
    floor_cfg = config.get("signal_floor") or {}
    floor = floor_cfg.get("floor")
    floor_features = set(floor_cfg.get("features") or [])

    per_criterion: dict[str, Optional[float]] = {}
    num = 0.0
    den = 0.0
    total = 0.0
    cov_num = 0.0
    res_num = 0.0

    for name, spec in criteria.items():
        w = float(weights[name]) if weights and name in weights else float(spec["weight"])
        if w > 0:
            total += w

        diffs_sum = 0.0
        count = 0
        for feature in spec["features"]:
            scale = scales.get(feature)
            na = normalize_value(raw_a.get(feature), range_for(config, feature, body_a), scale)
            nb = normalize_value(raw_b.get(feature), range_for(config, feature, body_b), scale)
            if na is None or nb is None:
                continue
            if floor is not None and feature in floor_features and na < floor and nb < floor:
                continue
            diffs_sum += 1.0 - abs(na - nb)
            count += 1

        if count == 0:
            per_criterion[name] = None
            continue

        score = diffs_sum / count
        per_criterion[name] = score
        if w > 0:
            num += w * score
            den += w
            cov_num += w * count / len(spec["features"])
            res_num += w * resolution_factor(res_a.get(name), res_b.get(name), k, min_factor)

    overall = num / den if den > 0 else None
    coverage = cov_num / total if total > 0 else 0.0
    res_mean = res_num / den if den > 0 else 0.0
    return {
        "overall": overall,
        "confidence": coverage * res_mean,
        "coverage": coverage,
        "resolution_factor": res_mean,
        "per_criterion": per_criterion,
    }
