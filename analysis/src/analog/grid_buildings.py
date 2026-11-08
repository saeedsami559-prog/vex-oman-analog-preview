"""Building footprints for the VEX Scout drone (network step, run once):

    python -m analog.grid_buildings   # -> web/public/grid/bld_NN.bin + data/processed/grid/buildings.json

Source: Overture Maps Foundation buildings theme (ODbL 1.0), which merges OpenStreetMap, Microsoft Global ML
Building Footprints, Google Open Buildings and Esri Community Maps; heights come from OpenStreetMap (height or
building:levels x 3 m) where mappers recorded them. Falls back to Microsoft's own files if Overture is unreachable.

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


def overture_features(bbox: tuple[float, float, float, float]):
    """(ring, height m or -1, source dataset) for every Overture building whose bbox lies in `bbox`."""
    import subprocess

    import duckdb

    out = subprocess.run(["aws", "s3", "ls", "--no-sign-request", "s3://overturemaps-us-west-2/release/"],
                         capture_output=True, text=True, check=True).stdout
    release = sorted(l.split()[-1].strip("/") for l in out.splitlines() if l.strip().startswith("PRE"))[-1]
    print("Overture release", release)
    con = duckdb.connect()
    for q in ("INSTALL spatial", "LOAD spatial", "INSTALL httpfs", "LOAD httpfs", "SET s3_region='us-west-2'"):
        con.execute(q)
    x0, y0, x1, y1 = bbox
    rows = con.execute(f"""
        SELECT ST_AsGeoJSON(geometry), height, num_floors, sources[1].dataset
        FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*', hive_partitioning=1)
        WHERE bbox.xmin > {x0} AND bbox.xmax < {x1} AND bbox.ymin > {y0} AND bbox.ymax < {y1}
    """).fetchall()
    print(len(rows), "Overture buildings in the bbox")
    for gj, height, floors, src in rows:
        g = json.loads(gj)
        ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
        hgt = float(height) if height else float(floors) * 3.0 if floors else -1.0
        yield ring, hgt, src or "?"
    global SOURCE
    SOURCE = f"Overture Maps Foundation buildings, release {release} (ODbL 1.0): OpenStreetMap, Microsoft, Google, Esri"


SOURCE = "Microsoft Global ML Building Footprints (ODbL 1.0), " + LINKS


def microsoft_features():
    rows = list(csv.DictReader(io.StringIO(get(LINKS).decode("utf-8"))))
    urls = [r["Url"] for r in rows if r.get("Location", "").strip().lower() in ("sultanateofoman", "oman")]
    print(len(urls), "Microsoft files for Oman")
    for u in urls:
        for line in gzip.decompress(get(u)).decode("utf-8").splitlines():
            if not line.strip():
                continue
            f = json.loads(line)
            geom = f["geometry"]
            ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
            yield ring, float((f.get("properties") or {}).get("height") or -1), "Microsoft"


def main() -> None:
    grid = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    cells = [c for c in grid["cells"] if c.get("heightmap")]
    h = CELL_DEG / 2
    key = lambda la, lo: (math.floor(la / CELL_DEG), math.floor(lo / CELL_DEG))  # noqa: E731
    by_key = {key(c["lat"], c["lon"]): c for c in cells}
    per_cell: dict[str, list[tuple]] = defaultdict(list)
    total = with_h = 0
    sources: dict[str, int] = defaultdict(int)
    lats = [c["lat"] for c in cells]
    lons = [c["lon"] for c in cells]
    bbox = (min(lons) - h, min(lats) - h, max(lons) + h, max(lats) + h)
    try:
        feats = list(overture_features(bbox))
    except Exception as e:  # noqa: BLE001
        print("Overture unavailable, using Microsoft:", str(e)[:300])
        feats = list(microsoft_features())
    for ring, hgt, src in feats:
        lo = sum(p[0] for p in ring) / len(ring)
        la = sum(p[1] for p in ring) / len(ring)
        c = by_key.get(key(la, lo))
        if c is None or abs(la - c["lat"]) > h or abs(lo - c["lon"]) > h or len(ring) < 4:
            continue
        cx, cz, length, width, ang = oriented_box(ring, c["lat"], c["lon"])
        total += 1
        with_h += hgt > 0
        sources[src] += 1
        per_cell[c["id"]].append((cx, cz, length, width, ang, hgt))
    print(dict(sources))
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
    meta = {"source": SOURCE, "by_dataset": dict(sources), "total": total, "with_height": with_h,
            "layout": "<hhHHBB: x m, z m, length dm, width dm, angle deg, height 0.5 m (0 = unknown)", "cells": index}
    text = json.dumps(meta, separators=(",", ":")) + "\n"
    BLD_FILE.write_text(text, encoding="utf-8")
    WEB_JSON.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
