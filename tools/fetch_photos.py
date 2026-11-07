"""Download the NASA Image Library photos used on site pages and store web-sized copies in the repo,
so the site does not depend on images-assets.nasa.gov being reachable from the visitor's network."""
import io, json, re, urllib.request, pathlib
from PIL import Image

src = pathlib.Path("web/src/lib/photos.ts").read_text(encoding="utf-8")
entries = re.findall(r"(\w+): \{\s*nasaId: '([^']+)',\s*file: '([^']+)'", src)
out = pathlib.Path("web/public/photos"); out.mkdir(parents=True, exist_ok=True)
report = {}
for site, nid, f in entries:
    url = f"https://images-assets.nasa.gov/image/{nid}/{nid}{f}"
    data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "vex-oman-analog"}), timeout=60).read()
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((1280, 1280))
    im.save(out / f"{site}.jpg", "JPEG", quality=82, optimize=True, progressive=True)
    report[site] = {"nasa_id": nid, "source": url, "size": im.size}
    print(site, im.size)
(out / "photos.json").write_text(json.dumps(report, indent=2))
