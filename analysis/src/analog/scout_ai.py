"""VEX Scout AI: a second opinion learned from places space agencies already train in.

    Runs automatically at the end of `python -m analog.grid score` (offline); `python -m analog.scout_ai`
    re-runs it on its own and rewrites oman_grid.json.

What it is
----------
An instance-based (k-nearest-neighbour) model. It is given *examples* - Earth places that space
agencies and analog programmes actually chose for Moon or Mars work (the 16 international benchmark
sites of the Atlas plus AMADEE-18 in Dhofar) - and for every Omani grid cell it answers:
"how much does this place look like the places the experts picked?".

It never sees the five Omani study sites during training, so they serve as a hidden check.

Features (6, every one a real measurement, nothing guessed):
  terrain      slope (deg), log10 roughness (m), log10 relief (m)     NASADEM, 463 m common scale
  climate      aridity, dry air, thermal swing (0..1, see environment.py)  NASA POWER climatology

Every feature is put on a common scale (z-score over examples + cells). The distance between a cell and
an example is the root-mean-square z difference over the six features. Similarity to one example is
exp(-d^2 / 2); a cell's AI score is the mean similarity to its k = 3 nearest examples, as a percentage.

Why a cell gets its score is stored with it: the signed z difference per feature against its
neighbours (weighted by similarity). The web page turns the smallest differences into "why it matches"
and the largest into "why it does not" - an explainable model, not a black box.

Rules that are not about likeness (slope safety, human footprint, distance) stay in the rule-based
decision; the page shows both opinions side by side.

Also stored per cell for the virtual drone and the mission log:
  safe_pct     share of the cell's 217 m heightmap pixels with slope < 10 deg (same rule as the page)
  env          NASA POWER annual rain, humidity, daily range, 10 m wind (annual + monthly), coolest months
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from . import DATA_DIR, REPO_DIR
from .environment import coolest_window, env_index
from .grid import OUT_FILE, WEB_FILE, ATLAS_DIR, terrarium_decode

# Raw NASA POWER responses for every cell centre, keyed by cell id (python -m analog.grid power).
POWER_FILE = DATA_DIR / "processed" / "grid" / "nasa_power_cells.json"
SITES_FILE = REPO_DIR / "web" / "public" / "data" / "sites.json"
ENV_FILE = REPO_DIR / "web" / "public" / "data" / "environment.json"
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

FEATURES = ["slope", "roughness", "relief", "aridity", "dry_air", "thermal_swing"]
K = 3
SAFE_DEG = 10.0

# Places chosen by space agencies / analog programmes, by body. AMADEE-18 (Austrian Space Forum, 2018)
# is the one Omani place that hosted a real Mars analog mission, so it is a training example too.
EXTRA_EXAMPLES = {"dhofar_amadee18": ["mars"]}


def _log(v: float) -> float:
    return math.log10(max(v, 1e-3))


def vector(terrain: dict[str, float], env: dict[str, float]) -> list[float]:
    return [terrain["slope_deg"], _log(terrain["roughness_m"]), _log(terrain["relief_m"]),
            env["aridity"], env["dry_air"], env["thermal_swing"]]


def similarity(z_cell: np.ndarray, z_examples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-example similarity (0..1) and signed per-feature z differences (cell - example)."""
    diff = z_cell[None, :] - z_examples
    d2 = np.mean(diff ** 2, axis=1)
    return np.exp(-d2 / 2), diff


def predict(z_cell: np.ndarray, z_examples: np.ndarray, k: int = K) -> dict[str, Any]:
    sim, diff = similarity(z_cell, z_examples)
    order = np.argsort(-sim)[:k]
    w = sim[order]
    score = float(np.mean(w))
    contrib = (diff[order] * w[:, None]).sum(axis=0) / max(float(w.sum()), 1e-9)
    return {"score": score, "nn": [int(i) for i in order], "nn_sim": [float(x) for x in w], "z": contrib}


def safe_share(heights: np.ndarray, res_m: float) -> float:
    # Central differences with clamped edges, exactly like slopeField() in web/src/lib/scout.ts.
    h = np.pad(heights.astype(np.float64), 1, mode="edge")
    gx = (h[1:-1, 2:] - h[1:-1, :-2]) / (2 * res_m)
    gy = (h[2:, 1:-1] - h[:-2, 1:-1]) / (2 * res_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    return float(np.mean(slope < SAFE_DEG))


def heightmap(cell: dict[str, Any], atlases: dict[str, np.ndarray]) -> np.ndarray | None:
    from PIL import Image

    hm = cell.get("heightmap")
    if not hm:
        return None
    if hm["atlas"] not in atlases:
        atlases[hm["atlas"]] = np.asarray(Image.open(ATLAS_DIR / hm["atlas"]).convert("RGB"))
    px = hm["px"]
    tile = atlases[hm["atlas"]][hm["row"] * px:(hm["row"] + 1) * px, hm["col"] * px:(hm["col"] + 1) * px]
    return terrarium_decode(tile)


def cell_env(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not raw:
        return None
    p = raw["properties"]["parameter"]
    fill = raw["header"].get("fill_value", -999.0)
    if any(v == fill for name in ("PRECTOTCORR", "RH2M", "T2M_RANGE", "T2M", "WS10M") for v in p[name].values()):
        return None
    rain = p["PRECTOTCORR"]["ANN"] * 365
    idx = env_index(rain, p["RH2M"]["ANN"], p["T2M_RANGE"]["ANN"])
    t2m = [p["T2M"][m] for m in MONTHS]
    return {
        "rain_mm": round(rain), "rh": round(p["RH2M"]["ANN"], 1), "t_range": round(p["T2M_RANGE"]["ANN"], 1),
        "t2m": round(p["T2M"]["ANN"], 1), "t2m_monthly": [round(x, 1) for x in t2m],
        "wind_ms": round(p["WS10M"]["ANN"], 2), "wind_monthly": [round(p["WS10M"][m], 2) for m in MONTHS],
        "coolest": coolest_window(t2m),
        "aridity": idx["aridity"], "dry_air": idx["dry_air"], "thermal_swing": idx["thermal_swing"],
        "index": idx["index"],
    }


def examples() -> list[dict[str, Any]]:
    sites = json.loads(SITES_FILE.read_text(encoding="utf-8"))
    env = {s["id"]: s["derived"]["env_index"] for s in json.loads(ENV_FILE.read_text(encoding="utf-8"))["sites"]}
    pool = [(b, b.get("analog_for") or []) for b in sites["benchmarks"] if b.get("role") == "benchmark"]
    pool += [(s, EXTRA_EXAMPLES[s["id"]]) for s in sites["earth_sites"] if s["id"] in EXTRA_EXAMPLES]
    out = []
    for s, bodies in pool:
        r = s["raw"]
        if s["id"] not in env or any(r.get(f) is None for f in ("slope_deg", "roughness_m", "relief_m")):
            continue
        out.append({"id": s["id"], "name": s["name"], "bodies": list(bodies), "lat": s["lat"], "lon": s["lon"],
                    "x": vector(r, env[s["id"]])})
    return out


def enrich(grid: dict[str, Any]) -> dict[str, Any]:
    """Add safe_pct, env and the AI opinion to every cell of a scored grid (in place) and the model summary."""
    ex = examples()
    atlases: dict[str, np.ndarray] = {}
    power = json.loads(POWER_FILE.read_text(encoding="utf-8")) if POWER_FILE.exists() else {}
    cells = grid["cells"]
    for c in cells:
        c["env"] = cell_env(power.get(c["id"]))
        h = heightmap(c, atlases)
        c["safe_pct"] = None if h is None else round(100 * safe_share(h, c["heightmap"]["res_m"]), 1)
    usable = [c for c in cells if c["env"]]
    X_cells = np.array([vector(c, c["env"]) for c in usable])
    X_ex = np.array([e["x"] for e in ex])
    allx = np.vstack([X_cells, X_ex])
    mean, std = allx.mean(axis=0), np.maximum(allx.std(axis=0), 1e-6)
    z = lambda X: (X - mean) / std  # noqa: E731
    Zc, Ze = z(X_cells), z(X_ex)

    model: dict[str, Any] = {"features": FEATURES, "k": K, "mean": mean.round(4).tolist(), "std": std.round(4).tolist(),
                             "examples": {}, "validation": {}}
    for body in ("moon", "mars"):
        idx = [i for i, e in enumerate(ex) if body in e["bodies"]]
        Zb = Ze[idx]
        ids = [ex[i]["id"] for i in idx]
        model["examples"][body] = [{"id": ex[i]["id"], "name": ex[i]["name"], "lat": ex[i]["lat"], "lon": ex[i]["lon"],
                                    "x": [round(v, 3) for v in ex[i]["x"]]} for i in idx]
        scores = []
        for c, zc in zip(usable, Zc):
            p = predict(zc, Zb)
            c.setdefault("ai", {})[body] = {"p": round(100 * p["score"], 1), "nn": [ids[j] for j in p["nn"]],
                                            "z": [round(float(v), 2) for v in p["z"]]}
            scores.append(p["score"])
        order = sorted(usable, key=lambda c: -c["ai"][body]["p"])
        for r, c in enumerate(order, 1):
            c["ai"][body]["rank"] = r
        # Leave-one-out: hide each example, score it with the others, see where it would rank among the cells.
        loo = []
        cell_scores = np.array(scores)
        for j in range(len(idx)):
            rest = np.delete(Zb, j, axis=0)
            s = predict(Zb[j], rest)["score"]
            loo.append({"id": ids[j], "p": round(100 * s, 1), "beats_pct": round(100 * float(np.mean(cell_scores < s)), 1)})
        # Hidden check: the Omani study sites the model never saw.
        hidden = []
        for site in grid.get("sites", []):
            c = next((x for x in usable if x["id"] == site["cell"]), None)
            if c:
                hidden.append({"id": site["id"], "cell": c["id"], "p": c["ai"][body]["p"], "rank": c["ai"][body]["rank"]})
        model["validation"][body] = {"leave_one_out": loo, "omani_sites": hidden, "cells": len(usable),
                                     "median_p": round(100 * float(np.median(cell_scores)), 1)}
    model["note"] = ("k-nearest-neighbour similarity to places space agencies chose for analog work; "
                     "terrain from NASADEM, climate from NASA POWER. A second opinion next to the rule-based decision.")
    grid["ai"] = model
    # where each cell is, in words (governorate + nearest town), when the place names have been built
    from .places import WEB as PLACES_WEB, place_of

    if PLACES_WEB.exists():
        places = json.loads(PLACES_WEB.read_text(encoding="utf-8"))
        for c in cells:
            c["place"] = place_of(c["lat"], c["lon"], places)

    grid["method"]["climate_source"] = ("NASA POWER Climatology API (RE community), 2001-2025 monthly & annual, "
                                        "cell centre; POWER's native grid is coarser (0.5 x 0.625 deg) than the cells")
    return grid


def main() -> None:
    from .grid import RAW_FILE, score

    grid = enrich(score(json.loads(RAW_FILE.read_text(encoding="utf-8"))))
    text = json.dumps(grid, ensure_ascii=False, separators=(",", ":")) + "\n"
    OUT_FILE.write_text(text, encoding="utf-8")
    Path(WEB_FILE).write_text(text, encoding="utf-8")
    for body in ("moon", "mars"):
        top = sorted((c for c in grid["cells"] if c.get("ai")), key=lambda c: -c["ai"][body]["p"])[:5]
        print(body, "top:", ", ".join(f"{c['id']} {c['ai'][body]['p']}" for c in top))
        print(body, "validation:", json.dumps(grid["ai"]["validation"][body], ensure_ascii=False))


if __name__ == "__main__":
    main()
