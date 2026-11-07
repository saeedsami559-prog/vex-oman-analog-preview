"""Field-environment context from NASA POWER (shown on the site, NOT part of the similarity score).

    python -m analog.environment

Reads the raw NASA POWER Climatology API responses saved verbatim in
data/processed/environment/nasa_power/<site_id>.json and writes a compact file the website reads:

  data/processed/environment/environment.json   - canonical output (tracked in git)
  web/public/data/environment.json              - copy served by the frontend

Each raw file is the unmodified JSON answer to:

  https://power.larc.nasa.gov/api/temporal/climatology/point
      ?parameters=T2M,T2M_MAX,T2M_MIN,T2M_RANGE,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M
      &community=RE&longitude=<lon>&latitude=<lat>&format=JSON

Only two things are derived here, both from the NASA values and nothing else:
  - precipitation per year  = PRECTOTCORR ANN (mm/day) x 365
  - the coolest three consecutive months (wrapping Dec -> Jan) by mean T2M

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

# Sites with a NASA POWER file. Scored sites come from config/sites.yaml; the candidate is listed in the
# Analog Atlas (web/src/lib/atlas.ts) and is not scored.
SCORED = ["samail_ophiolite", "umm_as_samim", "sharqiya_sands", "dhofar_amadee18", "jebel_shams"]
CANDIDATES = ["majlis_al_jinn"]


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
        "lat": lat,
        "lon": lon,
        "cell_elevation_m": cell_elev,
        "monthly": monthly,
        "annual": annual,
        "derived": {
            "precip_mm_per_year": round(annual["PRECTOTCORR"] * 365),
            "coolest_months": coolest_window(monthly["T2M"]),
        },
        "request_url": API_URL.format(lon=lon, lat=lat),
    }


def build() -> dict[str, Any]:
    sites = []
    header = units = None
    for site_id in SCORED + CANDIDATES:
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
        print(f"{s['id']:<18} T2M {s['annual']['T2M']:>5} C  rain {s['derived']['precip_mm_per_year']:>4} mm/yr  coolest {months}")
    print(f"wrote {OUT_FILE.relative_to(REPO_DIR)} and {WEB_FILE.relative_to(REPO_DIR)}")


if __name__ == "__main__":
    main()
