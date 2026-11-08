import json, urllib.parse, urllib.request, pathlib
queries = ["Sayh al Uhaymir", "SaU 005", "Dhofar 019", "Dhofar meteorite", "Oman meteorite", "Martian meteorite Oman", "shergottite", "Mars meteorite"]
out = {}
for q in queries:
    url = "https://images-api.nasa.gov/search?media_type=image&q=" + urllib.parse.quote(q)
    d = json.load(urllib.request.urlopen(url, timeout=60))
    items = []
    for it in d["collection"]["items"][:25]:
        m = it["data"][0]
        items.append({"nasa_id": m.get("nasa_id"), "title": m.get("title"), "center": m.get("center"),
                      "date": m.get("date_created", "")[:10], "desc": (m.get("description") or "")[:300],
                      "thumb": (it.get("links") or [{}])[0].get("href")})
    out[q] = items
pathlib.Path("results").mkdir(exist_ok=True)
pathlib.Path("results/meteor_images.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
