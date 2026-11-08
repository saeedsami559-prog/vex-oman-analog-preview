"""Run with: pip install shapely && python tools/fetch_places.py

Oman place names for VEX Scout: border, governorates (Natural Earth 10m v5.1.2) and towns/landmarks (GeoNames)."""
import csv, io, json, pathlib, urllib.request, zipfile
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union

UA = {"User-Agent": "vex-oman-analog"}
def get(url): return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()

NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/"
adm0 = json.loads(get(NE + "ne_10m_admin_0_countries.geojson"))
adm1 = json.loads(get(NE + "ne_10m_admin_1_states_provinces.geojson"))
oman = next(f for f in adm0["features"] if f["properties"].get("ADM0_A3") == "OMN")
oman_geom = shape(oman["geometry"])

def rnd(geom, tol):
    g = geom.simplify(tol, preserve_topology=True)
    m = mapping(g)
    def r(c):
        return [round(c[0], 4), round(c[1], 4)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": m["type"], "coordinates": r(m["coordinates"])}

# Governorate names written out (Natural Earth still carries some pre-2011 names), keyed by its iso_3166_2 code
GOV_NAMES = {
    "OM-MU": ("Musandam", "مسندم"), "OM-BA": ("North Al Batinah", "شمال الباطنة"), "OM-BU": ("Al Buraimi", "البريمي"),
    "OM-ZA": ("Ad Dhahirah", "الظاهرة"), "OM-ZU": ("Dhofar", "ظفار"), "OM-WU": ("Al Wusta", "الوسطى"),
    "OM-SH": ("South Ash Sharqiyah", "جنوب الشرقية"), "OM-SS": ("North Ash Sharqiyah", "شمال الشرقية"),
    "OM-MA": ("Muscat", "مسقط"), "OM-BJ": ("South Al Batinah", "جنوب الباطنة"), "OM-DA": ("Ad Dakhiliyah", "الداخلية"),
}
govs = []
for f in adm1["features"]:
    p = f["properties"]
    if p.get("adm0_a3") != "OMN":
        continue
    g = shape(f["geometry"])
    c = g.representative_point()
    en, ar = GOV_NAMES.get(p.get("iso_3166_2"), (p.get("name_en") or p.get("name"), p.get("name_ar") or p.get("name")))
    govs.append({"name": {"en": en, "ar": ar},
                 "iso": p.get("iso_3166_2"), "label": [round(c.y, 3), round(c.x, 3)], "geometry": rnd(g, 0.01)})

# GeoNames: towns and named landforms, with Arabic names from the alternate-names table
rows = list(csv.reader(io.TextIOWrapper(zipfile.ZipFile(io.BytesIO(get("https://download.geonames.org/export/dump/OM.zip"))).open("OM.txt"), "utf-8"), delimiter="\t"))
alt = {}
az = zipfile.ZipFile(io.BytesIO(get("https://download.geonames.org/export/dump/alternatenames/OM.zip")))
for r in csv.reader(io.TextIOWrapper(az.open("OM.txt"), "utf-8"), delimiter="\t"):
    # alternateNameId, geonameid, isolanguage, alternate name, isPreferredName, isShortName, isColloquial, isHistoric, from, to
    is_arabic = len(r) > 3 and any("\u0600" <= ch <= "\u06ff" for ch in r[3])
    if len(r) > 3 and r[2] == "ar" and is_arabic and not (len(r) > 7 and r[7] == "1"):
        pref = len(r) > 4 and r[4] == "1"
        if r[1] not in alt or pref:
            alt[r[1]] = r[3]
LAND = {"MT", "MTS", "PK", "PKS", "WAD", "DUNE", "DUNES", "PLAT", "CRTR", "CAVE", "SBKH", "HLL"}
towns, landmarks = [], []
for r in rows:
    gid, name, lat, lon, fcl, fcode, pop = r[0], r[2] or r[1], float(r[4]), float(r[5]), r[6], r[7], int(r[14] or 0)
    # English: GeoNames' ASCII name (Salalah, not Şalālah); Arabic: only a name written in Arabic script
    item = {"n": {"en": name, "ar": alt.get(gid, name)}, "lat": round(lat, 4), "lon": round(lon, 4)}
    if fcl == "P":
        item["pop"] = pop
        item["k"] = "city" if fcode in ("PPLC", "PPLA") or pop >= 50000 else "town" if fcode == "PPLA2" or pop >= 5000 else "village"
        towns.append(item)
    elif fcode in LAND and gid in alt:
        item["k"] = fcode.lower()
        landmarks.append(item)

# GeoNames lacks an Arabic name for these towns; written by the team. Stray quote marks at the ends are dropped.
AR_FIX = {"Sufalat Sama'il": "سفالة سمائل", "Saham": "صحم", "'Ibri": "عبري", "Dib Dibba": "دبا", "Bidbid": "بدبد",
          "Badiyah": "بدية", "Bayt al `Awabi": "العوابي"}
for lst in (towns, landmarks):
    for t in lst:
        en = t["n"]["en"]
        if en in AR_FIX:
            t["n"]["ar"] = AR_FIX[en]
        t["n"]["en"] = en.strip("'`")
        if t["n"]["ar"] == en:
            t["n"]["ar"] = t["n"]["en"]

out = {
    "sources": {
        "border": "Natural Earth admin-0 countries 1:10m v5.1.2",
        "governorates": "Natural Earth admin-1 states/provinces 1:10m v5.1.2 (name_en, name_ar)",
        "places": "GeoNames OM.txt and alternate names (Arabic), CC BY 4.0, https://www.geonames.org/",
        "overrides": "Arabic names for 7 towns GeoNames lists without one (Saham, Ibri, Dibba, Bidbid, Badiyah, Al Awabi, Sufalat Sama'il) written by the team",
    },
    "border": rnd(oman_geom, 0.01),
    "governorates": govs,
    "towns": towns,
    "landmarks": landmarks,
}
pathlib.Path("web/public/data").mkdir(parents=True, exist_ok=True)
pathlib.Path("web/public/data/oman_places.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(govs), "governorates,", len(towns), "towns,", len(landmarks), "landmarks; arabic names", sum(1 for t in towns if t["n"]["ar"] != t["n"]["en"]))
