"""Save the raw NASA POWER climatology response for every benchmark site that lacks one."""
import json, pathlib, time, urllib.request, yaml

PARAMS = "T2M,T2M_MAX,T2M_MIN,T2M_RANGE,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M"
URL = ("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=" + PARAMS +
       "&community=RE&longitude={lon}&latitude={lat}&format=JSON")
raw_dir = pathlib.Path("data/processed/environment/nasa_power")
cfg = yaml.safe_load(open("analysis/config/benchmark_sites.yaml", encoding="utf-8"))
sites = cfg["sites"] if isinstance(cfg, dict) and "sites" in cfg else cfg
for s in sites:
    sid = s["id"]
    out = raw_dir / f"{sid}.json"
    if out.exists():
        continue
    url = URL.format(lon=s["lon"], lat=s["lat"])
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "vex-oman-analog"}), timeout=120).read()
            json.loads(data)
            out.write_bytes(data)
            print("saved", sid)
            break
        except Exception as e:  # noqa: BLE001
            print("retry", sid, e)
            time.sleep(10)
    time.sleep(2)
