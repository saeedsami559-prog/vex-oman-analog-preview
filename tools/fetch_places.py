"""Oman border, governorates and towns with English and Arabic names, for VEX Scout's game-style map.

Sources: Natural Earth 1:10m admin-0 / admin-1 (v5.1.2, public domain) and GeoNames OM dump (CC BY 4.0).
Writes data/processed/places/oman_places.json (raw, small).
"""
import io, json, pathlib, re, urllib.request, zipfile

NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/"
GEONAMES = "https://download.geonames.org/export/dump/OM.zip"
AR = re.compile(r"[؀-ۿ]")

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "vex-oman-analog"}), timeout=300).read()

def rnd(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 4), round(coords[1], 4)]
    return [rnd(c) for c in coords]

out = {"sources": {"border": NE + "ne_10m_admin_0_countries.geojson", "governorates": NE + "ne_10m_admin_1_states_provinces.geojson",
                   "towns": GEONAMES, "licences": "Natural Earth: public domain; GeoNames: CC BY 4.0"}}
a0 = json.loads(get(NE + "ne_10m_admin_0_countries.geojson"))
oman = next(f for f in a0["features"] if f["properties"].get("ADM0_A3") == "OMN")
out["border"] = {"type": oman["geometry"]["type"], "coordinates": rnd(oman["geometry"]["coordinates"])}
a1 = json.loads(get(NE + "ne_10m_admin_1_states_provinces.geojson"))
govs = []
for f in a1["features"]:
    p = f["properties"]
    if p.get("adm0_a3") != "OMN":
        continue
    govs.append({"name_en": p.get("name_en") or p.get("name"), "name_ar": p.get("name_ar"), "lat": p.get("latitude"), "lon": p.get("longitude"),
                 "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}})
out["governorates"] = govs
z = zipfile.ZipFile(io.BytesIO(get(GEONAMES)))
towns = []
for line in z.read("OM.txt").decode("utf-8").splitlines():
    c = line.split("\t")
    if len(c) < 15 or c[6] != "P":
        continue
    ar = [n for n in c[3].split(",") if AR.search(n)] or None
    towns.append({"id": int(c[0]), "name_en": c[1], "name_ar": ar, "lat": float(c[4]), "lon": float(c[5]),
                  "code": c[7], "pop": int(c[14] or 0)})
out["towns"] = towns
p = pathlib.Path("data/processed/places"); p.mkdir(parents=True, exist_ok=True)
(p / "oman_places.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(govs), "governorates,", len(towns), "towns,", sum(1 for t in towns if t["name_ar"]), "with Arabic names")
