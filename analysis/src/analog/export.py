"""Build the JSON the website reads (run once after metrics are computed).

    python -m analog.export

Writes:
  data/processed/sites.json          - canonical output (tracked in git)
  web/public/data/sites.json         - copy served by the frontend
  analysis/tests/fixtures/parity_cases.json - inputs/outputs for the Python<->TS parity test

Only values from data/processed/metrics/<id>.json (written by `python -m analog.compute`) are used.
A feature without a measured value is null and carries the pipeline's reason.
"""

from __future__ import annotations

import json
import shutil
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from . import ANALYSIS_DIR, CONFIG_DIR, DATA_DIR, REPO_DIR
from .normalize import pooled_range
from .similarity import similarity

METRICS_DIR = DATA_DIR / "processed" / "metrics"
OUT_FILE = DATA_DIR / "processed" / "sites.json"
WEB_FILE = REPO_DIR / "web" / "public" / "data" / "sites.json"
PARITY_FILE = ANALYSIS_DIR / "tests" / "fixtures" / "parity_cases.json"

PARITY_WEIGHT_SETS = [
    None,
    {"terrain": 1.0, "mineralogy": 0.0, "surface": 0.0},
    {"terrain": 0.2, "mineralogy": 0.6, "surface": 0.2},
    {"terrain": 0.0, "mineralogy": 0.0, "surface": 0.0},
]


def load_yaml(name: str) -> Any:
    with open(CONFIG_DIR / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_config() -> dict[str, Any]:
    return load_yaml("weights.yaml")


def features_of(config: dict[str, Any]) -> list[str]:
    return [f for c in config["criteria"].values() for f in c["features"]]


def load_measured(site_id: str) -> dict[str, Any]:
    """Pipeline output from `python -m analog.compute`, or {} if the site has not been run."""
    path = METRICS_DIR / f"{site_id}.json"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _not_run(feature: str) -> dict[str, Any]:
    return {
        "feature": feature, "status": "unavailable", "reason_code": "not_implemented",
        "reason_en": "The data pipeline has not been run for this site yet.",
        "reason_ar": "لم يُشغَّل خط معالجة البيانات لهذا الموقع بعد.",
        "needed": "Run `python -m analog.compute --site <id>`.",
        "needed_ar": "تشغيل ‎python -m analog.compute --site <id>‎.",
    }


def prepare_sites(raw_sites: list[dict[str, Any]], config: dict[str, Any], body: str | None = None) -> list[dict[str, Any]]:
    """Attach measured values (with provenance) and missing reasons to each configured site."""
    features = features_of(config)
    sites = []
    for s in raw_sites:
        result = load_measured(s["id"])
        measured = result.get("measured", {})
        missing = {m["feature"]: m for m in result.get("missing", [])}
        site = dict(s)
        site.setdefault("body", body)
        site["raw"] = {f: measured[f]["value"] if f in measured else None for f in features}
        site["provenance"] = {f: measured[f]["provenance"] for f in features if f in measured}
        site["missing"] = [missing.get(f) or _not_run(f) for f in features if f not in measured]
        site["measured"] = sorted(site["provenance"])
        site["resolution_m"] = resolutions(site["provenance"], config)
        site["sources"] = {c: sorted({site["provenance"][f]["dataset"] for f in spec["features"] if f in site["provenance"]})
                           for c, spec in config["criteria"].items()}
        sites.append(site)
    return sites


def resolutions(provenance: dict[str, Any], config: dict[str, Any]) -> dict[str, float | None]:
    """Per-criterion resolution used by the confidence penalty.

    Terrain is compared on the common grid, so it gets the common scale on every site (no
    penalty). Other criteria use the coarsest native resolution among their measured features.
    """
    out: dict[str, float | None] = {}
    for name, spec in config["criteria"].items():
        if name == "terrain":
            out[name] = config["common_terrain_scale_m"] if any(f in provenance for f in spec["features"]) else None
            continue
        res = [provenance[f]["native_resolution_m"] for f in spec["features"] if f in provenance]
        out[name] = max(res) if res else None
    return out


def scoring_config(config: dict[str, Any], sites: list[dict[str, Any]]) -> dict[str, Any]:
    """Config with data-driven normalisation ranges (pooled min..max of measured values)."""
    scales = config.get("feature_scale") or {}
    ranges = {f: pooled_range((s["raw"][f] for s in sites), scales.get(f)) for f in features_of(config)}
    bodies = sorted({s.get("body") for s in sites if s.get("body")})
    by_body = {
        f: {b: pooled_range((s["raw"][f] for s in sites if s.get("body") == b), scales.get(f)) for b in bodies}
        for f in config.get("body_relative_features") or []
    }
    return {**config, "feature_scale": scales, "feature_ranges": ranges, "feature_ranges_by_body": by_body}


def score_pairs(earth: list[dict], targets: list[dict], config: dict) -> list[dict[str, Any]]:
    scores = []
    for e in earth:
        for t in targets:
            result = similarity(e["raw"], t["raw"], e["resolution_m"], t["resolution_m"], config,
                                body_a=e["body"], body_b=t["body"])
            scores.append({"earth": e["id"], "target": t["id"], **result})
    return scores


def validation_summary(earth: list[dict], targets: list[dict], scores: list[dict]) -> dict[str, Any]:
    """Does the expert-chosen AMADEE-18 site score well against Mars? (methodology check)"""
    mars_ids = {t["id"] for t in targets if t["body"] == "mars"}
    mean_mars = {}
    for e in earth:
        vals = [s["overall"] for s in scores if s["earth"] == e["id"] and s["target"] in mars_ids and s["overall"] is not None]
        mean_mars[e["id"]] = sum(vals) / len(vals) if vals else None
    ranking = sorted((k for k, v in mean_mars.items() if v is not None), key=lambda k: -mean_mars[k])
    ref = next((e["id"] for e in earth if e.get("role") == "reference"), None)
    best = {}
    for e in earth:
        mars = [s for s in scores if s["earth"] == e["id"] and s["target"] in mars_ids and s["overall"] is not None]
        best[e["id"]] = max(mars, key=lambda s: s["overall"])["target"] if mars else None
    return {
        "reference_site": ref,
        "mean_mars_similarity": mean_mars,
        "ranking": ranking,
        "reference_rank": ranking.index(ref) + 1 if ref in ranking else None,
        "best_mars_target": best,
    }


def coverage_summary(sites: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    """How many site x feature values are measured, unavailable, or not applicable."""
    by_feature = {}
    for f in features_of(config):
        m = sum(f in s["provenance"] for s in sites)
        na = sum(1 for s in sites for x in s["missing"] if x["feature"] == f and x["status"] == "not_applicable")
        by_feature[f] = {"measured": m, "unavailable": len(sites) - m - na, "not_applicable": na}
    measured = sum(v["measured"] for v in by_feature.values())
    na = sum(v["not_applicable"] for v in by_feature.values())
    applicable = len(sites) * len(by_feature) - na
    return {
        "measured": measured,
        "unavailable": applicable - measured,
        "not_applicable": na,
        "share": round(measured / applicable, 4) if applicable else 0.0,
        "by_feature": by_feature,
    }


def score_spread(scores: list[dict[str, Any]]) -> float | None:
    vals = [s["overall"] for s in scores if s["overall"] is not None]
    return round(statistics.pstdev(vals), 4) if len(vals) > 1 else None


def write_parity_fixtures(earth: list[dict], targets: list[dict], config: dict) -> None:
    cases = []
    for weights in PARITY_WEIGHT_SETS:
        for e in earth:
            for t in targets:
                cases.append({
                    "earth": e["id"],
                    "target": t["id"],
                    "raw_a": e["raw"], "raw_b": t["raw"],
                    "res_a": e["resolution_m"], "res_b": t["resolution_m"],
                    "weights": weights,
                    "body_a": e["body"], "body_b": t["body"],
                    "expected": similarity(e["raw"], t["raw"], e["resolution_m"], t["resolution_m"], config, weights,
                                           e["body"], t["body"]),
                })
    PARITY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PARITY_FILE, "w", encoding="utf-8") as fh:
        json.dump({"config": config, "cases": cases}, fh, ensure_ascii=False, indent=1)


def build() -> dict[str, Any]:
    base = load_config()
    earth = prepare_sites(load_yaml("earth_sites.yaml")["sites"], base, body="earth")
    targets = prepare_sites(load_yaml("target_sites.yaml")["sites"], base)
    config = scoring_config(base, earth + targets)
    scores = score_pairs(earth, targets, config)
    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "coverage": coverage_summary(earth + targets, config),
        "score_spread": score_spread(scores),
        "config": config,
        "earth_sites": earth,
        "targets": targets,
        "scores": scores,
        "validation": validation_summary(earth, targets, scores),
    }


def main() -> None:
    dataset = build()
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(dataset, fh, ensure_ascii=False, indent=2)
    WEB_FILE.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT_FILE, WEB_FILE)
    write_parity_fixtures(dataset["earth_sites"], dataset["targets"], dataset["config"])

    v, c = dataset["validation"], dataset["coverage"]
    print(f"Wrote {OUT_FILE.relative_to(REPO_DIR)} and {WEB_FILE.relative_to(REPO_DIR)}")
    print(f"{len(dataset['scores'])} pairs scored; measured {c['measured']}, unavailable {c['unavailable']}, "
          f"not applicable {c['not_applicable']} (share of applicable values measured: {c['share']:.0%})")
    print(f"Score spread (std of overall): {dataset['score_spread']}")
    print(f"Validation: reference '{v['reference_site']}' ranks {v['reference_rank']} of {len(v['ranking'])} by mean Mars similarity")


if __name__ == "__main__":
    main()
