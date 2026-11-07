"""Read only the needed bands of CRISM MTRDR I/F cubes over a site window (no login).

Products are found with the PDS ODE REST API (`pt=MTRDR`, map-projected targeted reduced data
records, PDS Geosciences Node). MTRDR I/F cubes are band-sequential ENVI files, so each band is one
contiguous byte range: we read the ENVI header and the wavelength table, then fetch just the bands
the mineral indices use (about 25 MB per observation instead of ~1.3 GB).
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

import numpy as np

ODE_URL = "https://oderest.rsl.wustl.edu/live2/"
NODATA = 65535.0


@dataclass
class Observation:
    product_id: str
    img_url: str
    hdr_url: str
    lbl_url: str
    wv_url: str


def _get(url: str, byte_range: tuple[int, int] | None = None, timeout: int = 120, attempts: int = 4) -> bytes:
    """GET (optionally one byte range), retrying dropped connections before giving up."""
    for attempt in range(attempts):
        req = urllib.request.Request(url)
        if byte_range:
            req.add_header("Range", f"bytes={byte_range[0]}-{byte_range[1]}")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
        except (ConnectionError, TimeoutError, urllib.error.URLError):
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))
            continue
        if byte_range and len(data) != byte_range[1] - byte_range[0] + 1:
            raise IOError(f"range request returned {len(data)} bytes for {url}")
        return data
    raise AssertionError("unreachable")


def search(west: float, south: float, east: float, north: float, limit: int = 100) -> list[Observation]:
    """MTRDR I/F products whose footprint intersects the box (longitudes in 0..360 E)."""
    params = {
        "query": "product", "results": "fp", "output": "JSON", "limit": limit,
        "target": "mars", "ihid": "MRO", "iid": "CRISM", "pt": "MTRDR",
        "westlon": west % 360, "eastlon": east % 360, "minlat": south, "maxlat": north,
    }
    payload = json.loads(_get(f"{ODE_URL}?{urllib.parse.urlencode(params)}"))["ODEResults"]
    products = payload.get("Products")
    if not isinstance(products, dict):  # "No Products Found"
        return []
    items = products.get("Product", [])
    out = []
    for p in items if isinstance(items, list) else [items]:
        files = p["Product_files"]["Product_file"]
        files = files if isinstance(files, list) else [files]
        urls = {f["FileName"].lower(): f["URL"] for f in files}
        pid = p["pdsid"].lower()  # e.g. frt000047a3_07_if166j_mtr3
        if "_if" not in pid:
            continue
        wv = pid.replace("_if", "_wv")
        need = [f"{pid}.img", f"{pid}.hdr", f"{pid}.lbl", f"{wv}.tab"]
        if all(n in urls for n in need):
            out.append(Observation(pid, *(urls[n] for n in need)))
    return sorted(out, key=lambda o: o.product_id)


def parse_envi_header(text: str) -> dict:
    """samples, lines, bands, byte order, data type, map info and WKT from an ENVI .hdr."""
    def field(name: str) -> str:
        m = re.search(rf"^{name}\s*=\s*(\{{.*?\}}|[^\n]+)", text, re.M | re.S)
        if not m:
            raise ValueError(f"ENVI header lacks '{name}'")
        return m.group(1).strip().strip("{}").strip()

    hdr = {k: int(field(k)) for k in ("samples", "lines", "bands", "data type", "byte order", "header offset")}
    if field("interleave").lower() != "bsq" or hdr["data type"] != 4:
        raise ValueError("expected band-sequential float32 cube")
    info = [x.strip() for x in field("map info").split(",")]
    # map info: name, ref pixel x, ref pixel y, easting, northing, pixel size x, pixel size y, ...
    hdr["transform"] = (float(info[3]), float(info[4]), float(info[5]), float(info[6]),
                        float(info[1]), float(info[2]))
    hdr["wkt"] = field("coordinate system string")
    return hdr


def parse_wavelengths(text: str) -> np.ndarray:
    """Band-ordered wavelengths in micrometres from the MTRDR WV table (column 3 is nm)."""
    rows = [line.split(",") for line in text.strip().splitlines()]
    return np.array([float(r[2]) / 1000.0 for r in rows])


def acquisition_time(lbl_text: str) -> str:
    m = re.search(r"START_TIME\s*=\s*(\S+)", lbl_text)
    return m.group(1) if m else ""


def read_bands(obs: Observation, wanted_um: list[float]) -> tuple[dict, np.ndarray, np.ndarray, str]:
    """Header, wavelengths of the fetched bands, cube (bands, rows, cols) and start time."""
    hdr = parse_envi_header(_get(obs.hdr_url).decode("latin-1"))
    all_wl = parse_wavelengths(_get(obs.wv_url).decode("latin-1"))
    if all_wl.size != hdr["bands"]:
        raise ValueError(f"{obs.product_id}: {all_wl.size} wavelengths for {hdr['bands']} bands")
    idx = sorted({int(np.argmin(np.abs(all_wl - w))) for w in wanted_um})
    band_bytes = hdr["samples"] * hdr["lines"] * 4
    dtype = "<f4" if hdr["byte order"] == 0 else ">f4"
    cube = np.empty((len(idx), hdr["lines"], hdr["samples"]), dtype="float64")
    for i, b in enumerate(idx):
        start = hdr["header offset"] + b * band_bytes
        raw = np.frombuffer(_get(obs.img_url, (start, start + band_bytes - 1)), dtype=dtype)
        band = raw.reshape(hdr["lines"], hdr["samples"]).astype("float64")
        band[(band >= NODATA) | ~np.isfinite(band) | (band <= 0)] = np.nan
        cube[i] = band
    return hdr, all_wl[idx], cube, acquisition_time(_get(obs.lbl_url).decode("latin-1"))


def to_local_grid(cube: np.ndarray, hdr: dict, dst_crs, dst_transform, shape: tuple[int, int]) -> np.ndarray:
    """Nearest-neighbour reprojection of every band onto the site grid (keeps spectra intact)."""
    from rasterio.crs import CRS
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject

    e, n, dx, dy, ref_x, ref_y = hdr["transform"]
    # ENVI reference pixel is 1-based and refers to the pixel's upper-left corner.
    src_transform = Affine(dx, 0, e - (ref_x - 1) * dx, 0, -dy, n + (ref_y - 1) * dy)
    out = np.full((cube.shape[0], *shape), np.nan)
    for i in range(cube.shape[0]):
        reproject(source=cube[i], destination=out[i], src_transform=src_transform,
                  src_crs=CRS.from_wkt(hdr["wkt"]), src_nodata=np.nan, dst_transform=dst_transform,
                  dst_crs=dst_crs, dst_nodata=np.nan, resampling=Resampling.nearest)
    return out
