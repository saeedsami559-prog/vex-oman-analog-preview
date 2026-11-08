"""Save NASA POWER climatology (raw JSON) for the centre of every VEX Scout grid cell."""
import json, pathlib, time, urllib.request

PARAMS = "T2M,T2M_RANGE,PRECTOTCORR,RH2M,WS10M,WS2M"
URL = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=" + PARAMS +
       "&community=RE&longitude={lon}&latitude={lat}&format=JSON")
grid = json.load(open("web/public/data/oman_grid.json", encoding="utf-8"))
out_dir = pathlib.Path("data/processed/grid/nasa_power")
out_dir.mkdir(parents=True, exist_ok=True)
for c in grid["cells"]:
    out = out_dir / f"{c['id']}.json"
    if out.exists():
        continue
    url = URL.format(lon=c["lon"], lat=c["lat"])
    for attempt in range(5):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "vex-oman-analog"}), timeout=120).read()
            json.loads(data)
            out.write_bytes(data)
            print("saved", c["id"], flush=True)
            break
        except Exception as e:  # noqa: BLE001
            print("retry", c["id"], e, flush=True)
            time.sleep(15)
    time.sleep(1)
