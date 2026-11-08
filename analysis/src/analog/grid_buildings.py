"""Building footprints for the VEX Scout drone (network step, run once):

    python -m analog.grid_buildings   # -> web/public/grid/bld_NN.bin + data/processed/grid/buildings.json

Source: Microsoft Global ML Building Footprints (https://github.com/microsoft/GlobalMLBuildingFootprints,
ODbL 1.0), polygons detected by machine learning in Bing Maps imagery, some with an estimated height.

Each footprint is reduced to its oriented bounding rectangle (centre, length, width, angle) in the cell's
local metres (x east, z south from the cell centre), so the drone can draw it as a simple 3D block where it
really stands. Height: the dataset's estimate when present, otherwise 0 (the page then uses a typical one- or
two-storey height and says so).

Binary layout per building, little-endian, 10 bytes:
  int16 x, int16 z (m) | uint16 length, uint16 width (dm) | uint8 angle (0-179 deg) | uint8 height (0.5 m units)
Buildings are grouped by cell; buildings.json gives, per cell, the file, byte offset and count. 64 cells per file,
in the same order as the heightmap atlases.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import math
import struct
import urllib.request
from collections import defaultdict
from typing import Any

from . import DATA_DIR, REPO_DIR
from .grid import ATLAS_SIDE, CELL_DEG, OUT_FILE

LINKS = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
BLD_FILE = DATA_DIR / "processed" / "grid" / "buildings.json"
WEB_JSON = REPO_DIR / "web" / "public" / "data" / "buildings.json"
OUT_DIR = REPO_DIR / "web" / "public" / "grid"
M_PER_DEG = 111_320.0


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "vex-oman-analog"})
    return urllib.request.urlopen(req, timeout=600).read()


def oriented_box(ring: list[list[float]], lat0: float, lon0: float) -> tuple[float, float, float, float, float]:
    """Centre x, z (m from the cell centre), length, width (m), angle (deg) of a polygon's oriented bounding box."""
    cos0 = math.cos(math.radians(lat0))
    pts = [((lo - lon0) * M_PER_DEG * cos0, -(la - lat0) * M_PER_DEG) for lo, la in ring[:-1] or ring]
    best = None
    n = len(pts)
    for i in range(n):  # rotating calipers on the polygon edges (footprints are small, n is tiny)
        (x1, z1), (x2, z2) = pts[i], pts[(i + 1) % n]
        a = math.atan2(z2 - z1, x2 - x1)
        c, s = math.cos(a), math.sin(a)
        us = [x * c + z * s for x, z in pts]
        vs = [-x * s + z * c for x, z in pts]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best[0]:
            u0, v0 = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (area, u0 * c - v0 * s, u0 * s + v0 * c, max(us) - min(us), max(vs) - min(vs), math.degrees(a) % 180)
    _, cx, cz, length, width, ang = best
    return cx, cz, length, width, ang


def main() -> None:
    grid = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    cells = [c for c in grid["cells"] if c.get("heightmap")]
    h = CELL_DEG / 2
    rows = list(csv.DictReader(io.StringIO(get(LINKS).decode("utf-8"))))
    print("columns:", list(rows[0].keys()) if rows else None)
    locs = sorted({r.get("Location", "") for r in rows})
    print(len(locs), "locations; Gulf-like:", [l for l in locs if any(k in l.lower() for k in ("oman", "arab", "emirat", "yemen", "saudi", "qatar", "bahrain", "kuwait"))])
    urls = [r["Url"] for r in rows if r.get("Location", "").strip().lower() == "oman"]
    print(len(urls), "Oman files")
    # index cells by (floor(lat/CELL), floor(lon/CELL)) for a fast lookup
    key = lambda la, lo: (math.floor(la / CELL_DEG), math.floor(lo / CELL_DEG))  # noqa: E731
    by_key = {key(c["lat"], c["lon"]): c for c in cells}
    per_cell: dict[str, list[tuple]] = defaultdict(list)
    total = with_h = 0
    for u in urls:
        for line in gzip.decompress(get(u)).decode("utf-8").splitlines():
            if not line.strip():
                continue
            f = json.loads(line)
            geom = f["geometry"]
            ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
            lo = sum(p[0] for p in ring) / len(ring)
            la = sum(p[1] for p in ring) / len(ring)
            c = by_key.get(key(la, lo))
            if c is None or abs(la - c["lat"]) > h or abs(lo - c["lon"]) > h:
                continue
            cx, cz, length, width, ang = oriented_box(ring, c["lat"], c["lon"])
            hgt = float((f.get("properties") or {}).get("height") or -1)
            total += 1
            with_h += hgt > 0
            per_cell[c["id"]].append((cx, cz, length, width, ang, hgt))
    print(total, "buildings in the grid,", with_h, "with a height estimate")
    index: dict[str, Any] = {}
    per = ATLAS_SIDE * ATLAS_SIDE
    for k in range(0, len(cells), per):
        name = f"bld_{k // per:02d}.bin"
        buf = io.BytesIO()
        for c in cells[k:k + per]:
            items = per_cell.get(c["id"], [])
            off = buf.tell()
            for cx, cz, length, width, ang, hgt in items:
                buf.write(struct.pack("<hhHHBB", max(-32768, min(32767, round(cx))), max(-32768, min(32767, round(cz))),
                                      min(65535, round(length * 10)), min(65535, round(width * 10)), int(ang) % 180,
                                      0 if hgt <= 0 else min(255, round(hgt * 2))))
            if items:
                index[c["id"]] = {"file": name, "offset": off, "count": len(items)}
        (OUT_DIR / name).write_bytes(buf.getvalue())
    meta = {"source": "Microsoft Global ML Building Footprints (ODbL 1.0), " + LINKS, "total": total, "with_height": with_h,
            "layout": "<hhHHBB: x m, z m, length dm, width dm, angle deg, height 0.5 m (0 = unknown)", "cells": index}
    text = json.dumps(meta, separators=(",", ":")) + "\n"
    BLD_FILE.write_text(text, encoding="utf-8")
    WEB_JSON.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
