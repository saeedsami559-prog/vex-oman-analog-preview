"""Place names for VEX Scout: Oman's border, its 11 governorates and its towns, in English and Arabic.

    python -m analog.places        # data/processed/places/oman_places.json -> web/public/data/oman_places.json

Raw input (fetched once): Natural Earth 1:10m admin-0 / admin-1 v5.1.2 (public domain) and the GeoNames
OM dump (CC BY 4.0). The page uses this file for the game-style overview map and to say where the drone is
("over Wadi X, 4 km from Al Hamra, Ad Dakhiliyah") instead of bare coordinates.

Cleaning, all mechanical:
  * English town names are folded to plain ASCII (Nizwá -> Nizwa, Barkā' -> Barka).
  * The Arabic name is the shortest GeoNames alternate name written only in Arabic letters (other scripts
    that share the Arabic block, e.g. Urdu letters, are rejected); "ولاية" prefixes are dropped.
  * Abandoned (PPLQ), historical (PPLH) and town-section (PPLX) entries are left out.
  * Governorate names follow Oman's 11 governorates (Royal Decree 114/2011); Natural Earth's polygons are kept.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from typing import Any

from . import DATA_DIR, REPO_DIR

RAW = DATA_DIR / "processed" / "places" / "oman_places.json"
WEB = REPO_DIR / "web" / "public" / "data" / "oman_places.json"
SKIP = {"PPLQ", "PPLH", "PPLX", "PPLW"}
ARABIC_ONLY = re.compile(r"^[ء-غف-ي٠-٩\s\-]+$")
GOVERNORATES = {
    "Musandam": ("Musandam", "مسندم"),
    "Al Batinah North": ("North Al Batinah", "شمال الباطنة"),
    "Al Buraimi": ("Al Buraimi", "البريمي"),
    "Ad Dhahirah": ("Ad Dhahirah", "الظاهرة"),
    "Dhofar": ("Dhofar", "ظفار"),
    "Al Wusta": ("Al Wusta", "الوسطى"),
    "Ash Sharqiyah": ("South Al Sharqiyah", "جنوب الشرقية"),
    "Ash Sharqiyah North": ("North Al Sharqiyah", "شمال الشرقية"),
    "Muscat": ("Muscat", "مسقط"),
    "Al Batinah South": ("South Al Batinah", "جنوب الباطنة"),
    "Ad Dakhiliyah": ("Ad Dakhiliyah", "الداخلية"),
}


# GeoNames' Arabic alternates can include misspellings; for these well-known towns the spelling is fixed by hand.
ARABIC_FIX = {"Salalah": "صلالة", "Saham": "صحم", "Badiyah": "بدية", "Bidbid": "بدبد", "Hayma": "هيماء",
              "Sufalat Samail": "سفالة سمائل", "Duqm": "الدقم", "Thumrayt": "ثمريت", "Mirbat": "مرباط", "Taqah": "طاقة",
              "Adam": "أدم", "Al Hamra": "الحمراء", "Bahla": "بهلاء", "Masirah": "مصيرة", "Haima": "هيماء"}


def ascii_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("‘", "").replace("’", "").replace("'", "").replace("`", "")
    return re.sub(r"\s+", " ", s).strip()


def arabic_name(candidates: list[str] | str | None) -> str | None:
    if not candidates:
        return None
    if isinstance(candidates, str):
        candidates = [candidates]
    ok = []
    for c in candidates:
        c = re.sub(r"^(ولاية|والاية|بلدة|قرية)\s+", "", c.strip())
        if c and ARABIC_ONLY.match(c):
            ok.append(c)
    return min(ok, key=len) if ok else None


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = math.pi / 180
    dlat, dlon = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dlat / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_geometry(lon: float, lat: float, geom: dict[str, Any]) -> bool:
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, hole) for hole in poly[1:]):
            return True
    return False


def clean(raw: dict[str, Any]) -> dict[str, Any]:
    govs = []
    for g in raw["governorates"]:
        en, ar = GOVERNORATES.get(g["name_en"], (g["name_en"], g.get("name_ar")))
        govs.append({"en": en, "ar": ar, "lat": g["lat"], "lon": g["lon"], "geometry": g["geometry"]})
    towns = []
    for t in raw["towns"]:
        if t["code"] in SKIP:
            continue
        en = ascii_name(t["name_en"])
        ar = ARABIC_FIX.get(en) or arabic_name(t.get("name_ar"))
        # rank: 3 capital / governorate seat, 2 town with a known population, 1 village, 0 locality
        rank = 3 if t["code"] in ("PPLC", "PPLA") else 2 if t.get("pop", 0) >= 5000 else 1 if t.get("pop", 0) > 0 else 0
        towns.append({"en": en, "ar": ar, "lat": round(t["lat"], 4), "lon": round(t["lon"], 4), "r": rank, "pop": t.get("pop", 0)})
    towns.sort(key=lambda x: (-x["r"], -x["pop"]))
    return {
        "sources": raw["sources"],
        "note": "Names: GeoNames (CC BY 4.0), cleaned as described in analysis/src/analog/places.py; "
                "border and governorate polygons: Natural Earth 1:10m (public domain).",
        "border": raw["border"],
        "governorates": govs,
        "towns": [[t["en"], t["ar"], t["lat"], t["lon"], t["r"]] for t in towns],
    }


def place_of(lat: float, lon: float, places: dict[str, Any]) -> dict[str, Any]:
    """Governorate containing the point and the nearest named town (preferring towns with people)."""
    gov = next((g for g in places["governorates"] if in_geometry(lon, lat, g["geometry"])), None)
    if gov is None:  # on the coast, a cell centre can fall just outside the 1:10m polygons
        gov = min(places["governorates"], key=lambda g: km((lat, lon), (g["lat"], g["lon"])))
    near = None
    for min_rank in (1, 0):
        cands = [t for t in places["towns"] if t[4] >= min_rank]
        if cands:
            t = min(cands, key=lambda t: km((lat, lon), (t[2], t[3])))
            d = km((lat, lon), (t[2], t[3]))
            if d <= 25 or min_rank == 0:
                near = (t, d)
                break
    out = {"gov_en": gov["en"], "gov_ar": gov["ar"]}
    if near:
        t, d = near
        out.update({"town_en": t[0], "town_ar": t[1] or t[0], "town_km": round(d, 1)})
    return out


def build() -> dict[str, Any]:
    out = clean(json.loads(RAW.read_text(encoding="utf-8")))
    WEB.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return out


if __name__ == "__main__":
    p = build()
    print(len(p["governorates"]), "governorates,", len(p["towns"]), "towns,",
          sum(1 for t in p["towns"] if t[1]), "with Arabic names")
