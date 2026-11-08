"""Field environment from NASA POWER, and the environmental analog index (kept apart from the similarity score).

    python -m analog.environment

Reads the raw NASA POWER Climatology API responses saved verbatim in
data/processed/environment/nasa_power/<site_id>.json and writes a compact file the website reads:

  data/processed/environment/environment.json   - canonical output (tracked in git)
  web/public/data/environment.json              - copy served by the frontend

Each raw file is the unmodified JSON answer to:

  https://power.larc.nasa.gov/api/temporal/climatology/point
      ?parameters=T2M,T2M_MAX,T2M_MIN,T2M_RANGE,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M
      &community=RE&longitude=<lon>&latitude=<lat>&format=JSON

Derived here, from the NASA values and nothing else:
  - precipitation per year  = PRECTOTCORR ANN (mm/day) x 365
  - the coolest three consecutive months (wrapping Dec -> Jan) by mean T2M
  - the environmental analog index (see env_index): how far a site's surface climate goes toward the
    three conditions an Earth site can share with Mars and the Moon - no rain, dry air and a large
    day-night temperature swing. It is reported next to the similarity index, never merged into it,
    so terrain/mineral scores stay comparable with earlier runs.

POWER values describe a coarse grid cell (about 0.5 deg x 0.625 deg for MERRA-2 meteorology, 1 deg for
solar), not the exact point. The cell elevation POWER reports is kept so the website can show the gap.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from . import DATA_DIR, REPO_DIR

RAW_DIR = DATA_DIR / "processed" / "environment" / "nasa_power"
OUT_FILE = DATA_DIR / "processed" / "environment" / "environment.json"
WEB_FILE = REPO_DIR / "web" / "public" / "data" / "environment.json"

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
PARAMETERS = ["T2M", "T2M_MAX", "T2M_MIN", "T2M_RANGE", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "RH2M", "WS2M"]
API_URL = (
    "https://power.larc.nasa.gov/api/temporal/climatology/point"
    "?parameters=" + ",".join(PARAMETERS) + "&community=RE&longitude={lon}&latitude={lat}&format=JSON"
)

# Sites with a NASA POWER file. Scored sites come from config/earth_sites.yaml; the others are the
# candidate and world analog sites of config/benchmark_sites.yaml, included when their raw file exists.
SCORED = ["samail_ophiolite", "umm_as_samim", "sharqiya_sands", "dhofar_amadee18", "jebel_shams"]
CANDIDATES = ["majlis_al_jinn"]
BENCHMARK_CONFIG = REPO_DIR / "analysis" / "config" / "benchmark_sites.yaml"

# Environmental analog index: each factor runs 0 (Earth-like) to 1 (as far as Earth climate goes toward
# Mars/Moon conditions). Mars and the Moon have no rain, almost no water vapour and day-night swings of
# tens to hundreds of degrees; Earth's driest deserts approach the first two and reach ~20 C swings.
ARID_MM = 250.0   # annual rain at or above this (the semi-arid boundary used in aridity classes) scores 0
SWING_C = 20.0    # mean daily range at or above this scores 1 (the top of Earth's desert range)
INDEX_WEIGHTS = {"aridity": 1 / 3, "dry_air": 1 / 3, "thermal_swing": 1 / 3}


def benchmark_ids() -> list[str]:
    """Ids from benchmark_sites.yaml (minus the candidates already listed) in file order."""
    import yaml

    cfg = yaml.safe_load(BENCHMARK_CONFIG.read_text(encoding="utf-8"))
    sites = cfg["sites"] if isinstance(cfg, dict) else cfg
    return [s["id"] for s in sites if s["id"] not in CANDIDATES]


def env_index(precip_mm: float, rh_pct: float, t_range_c: float) -> dict[str, float]:
    """Environmental analog index from annual rain (mm), mean relative humidity (%) and mean daily range (C)."""
    parts = {
        "aridity": 1 - min(max(precip_mm, 0.0), ARID_MM) / ARID_MM,
        "dry_air": 1 - min(max(rh_pct, 0.0), 100.0) / 100,
        "thermal_swing": min(max(t_range_c, 0.0), SWING_C) / SWING_C,
    }
    index = sum(INDEX_WEIGHTS[k] * v for k, v in parts.items())
    return {**{k: round(v, 3) for k, v in parts.items()}, "index": round(index, 3)}


def coolest_window(t2m: list[float], length: int = 3) -> list[int]:
    """Month indices (0 = Jan) of the coolest `length` consecutive months, wrapping around the year."""
    best_start, best = 0, float("inf")
    for start in range(12):
        total = sum(t2m[(start + i) % 12] for i in range(length))
        if total < best:
            best_start, best = start, total
    return [(best_start + i) % 12 for i in range(length)]


def summarise(site_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    lon, lat, cell_elev = raw["geometry"]["coordinates"]
    params = raw["properties"]["parameter"]
    fill = raw["header"].get("fill_value", -999.0)
    for name in PARAMETERS:
        if name not in params:
            raise ValueError(f"{site_id}: parameter {name} missing from the NASA POWER response")
        if any(v == fill for v in params[name].values()):
            raise ValueError(f"{site_id}: {name} contains the fill value {fill}")
    monthly = {name: [params[name][m] for m in MONTHS] for name in PARAMETERS}
    annual = {name: params[name]["ANN"] for name in PARAMETERS}
    return {
        "id": site_id,
        "scored": site_id in SCORED,
        "role": "scored" if site_id in SCORED else "candidate" if site_id in CANDIDATES else "benchmark",
        "lat": lat,
        "lon": lon,
        "cell_elevation_m": cell_elev,
        "monthly": monthly,
        "annual": annual,
        "derived": {
            "precip_mm_per_year": round(annual["PRECTOTCORR"] * 365),
            "coolest_months": coolest_window(monthly["T2M"]),
            "env_index": env_index(annual["PRECTOTCORR"] * 365, annual["RH2M"], annual["T2M_RANGE"]),
        },
        "request_url": API_URL.format(lon=lon, lat=lat),
    }


def build() -> dict[str, Any]:
    sites = []
    header = units = None
    extra = [b for b in benchmark_ids() if (RAW_DIR / f"{b}.json").exists()]
    for site_id in SCORED + CANDIDATES + extra:
        path = RAW_DIR / f"{site_id}.json"
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        if header is None:
            header = raw["header"]
            units = {k: {"units": v["units"], "longname": v["longname"]} for k, v in raw["parameters"].items()}
        elif raw["header"]["api"] != header["api"] or raw["header"]["range"] != header["range"]:
            raise ValueError(f"{site_id}: different API version or period from the other files")
        sites.append(summarise(site_id, raw))
    assert header is not None and units is not None
    return {
        "source": {
            "dataset": "NASA POWER",
            "provider": "NASA Langley Research Center (LaRC) POWER Project",
            "api": f"{header['api']['name']} {header['api']['version']}",
            "inputs": header["sources"],
            "period": header["range"],
            "time_standard": header["time_standard"],
            "community": "RE",
            "home": "https://power.larc.nasa.gov/",
            "raw_files": "data/processed/environment/nasa_power/",
        },
        "env_index": {
            "factors": {
                "aridity": f"1 - min(rain, {ARID_MM:g} mm/yr) / {ARID_MM:g}",
                "dry_air": "1 - RH2M / 100",
                "thermal_swing": f"min(T2M_RANGE, {SWING_C:g} C) / {SWING_C:g}",
            },
            "weights": INDEX_WEIGHTS,
            "note": "Reported next to the similarity index, not merged into it.",
        },
        "parameters": units,
        "months": MONTHS,
        "sites": sites,
    }


def main() -> None:
    out = build()
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    WEB_FILE.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT_FILE, WEB_FILE)
    for s in out["sites"]:
        months = ",".join(MONTHS[i] for i in s["derived"]["coolest_months"])
        print(f"{s['id']:<22} T2M {s['annual']['T2M']:>5} C  rain {s['derived']['precip_mm_per_year']:>4} mm/yr  env {s['derived']['env_index']['index']:.2f}  coolest {months}")
    print(f"wrote {OUT_FILE.relative_to(REPO_DIR)} and {WEB_FILE.relative_to(REPO_DIR)}")


if __name__ == "__main__":
    main()
