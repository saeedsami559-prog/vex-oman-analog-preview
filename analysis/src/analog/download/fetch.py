"""Search and download small data samples around a site.

Earth products come from NASA Earthdata via `earthaccess` (needs a free Earthdata Login;
run `earthaccess.login()` once or set EARTHDATA_USERNAME / EARTHDATA_PASSWORD).
Mars/Moon products come from the PDS Geosciences Node ODE REST API (no login).

Examples:
    python -m analog.download.fetch --site samail_ophiolite --product NASADEM
    python -m analog.download.fetch --site jezero_crater --product CRISM --list-only
    python -m analog.download.fetch --all --list-only      # Phase 1 coverage check
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

from .. import DATA_DIR
from .sites import BBox, load_sites, site_bbox

RAW_DIR = DATA_DIR / "raw"

# Earthdata (CMR) collections
EARTHDATA_PRODUCTS = {
    "NASADEM": {"short_name": "NASADEM_HGT", "version": "001"},
    "EMIT": {"short_name": "EMITL2ARFL", "version": "001"},
    "ASTER": {"short_name": "AST_07XT", "version": "004"},
    "MODIS_ALBEDO": {"short_name": "MCD43A3", "version": "061"},
    "MODIS_LST": {"short_name": "MOD11A1", "version": "061"},
}

# PDS ODE queries (ihid = instrument host, iid = instrument, pt = product type)
ODE_PRODUCTS = {
    "CRISM": {"target": "mars", "ihid": "MRO", "iid": "CRISM", "pt": "MTRDR"},
    "HIRISE_DTM": {"target": "mars", "ihid": "MRO", "iid": "HIRISE", "pt": "DTM"},
    "THEMIS_TI": {"target": "mars", "ihid": "ODY", "iid": "THEMIS", "pt": "IRGEO"},
    "LOLA": {"target": "moon", "ihid": "LRO", "iid": "LOLA", "pt": "GDRDEM"},
    "DIVINER": {"target": "moon", "ihid": "LRO", "iid": "DLRE", "pt": "GDR"},
}
# Global mosaics are downloaded once and clipped locally rather than searched per site.
GLOBAL_PRODUCTS = {
    "MOLA": "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif",
}

ODE_URL = "https://oderest.rsl.wustl.edu/live2/"


def products_for(site: dict) -> list[str]:
    if site["body"] == "earth":
        return ["NASADEM", "EMIT", "MODIS_ALBEDO", "MODIS_LST"]
    if site["body"] == "mars":
        return ["MOLA", "CRISM", "THEMIS_TI"]
    return ["LOLA"]


def search_earthdata(product: str, bbox: BBox, limit: int = 20) -> list:
    import earthaccess  # optional dependency: pip install -e .[download]

    earthaccess.login()  # tries env vars, then ~/.netrc, then asks interactively
    spec = EARTHDATA_PRODUCTS[product]
    return earthaccess.search_data(
        short_name=spec["short_name"], version=spec["version"],
        bounding_box=bbox.as_tuple(), count=limit,
    )


def search_ode(product: str, bbox: BBox, limit: int = 20) -> list[dict]:
    spec = ODE_PRODUCTS[product]
    west, east = bbox.west % 360, bbox.east % 360  # ODE uses 0..360 east longitudes
    params = {
        "query": "product", "results": "fp", "output": "JSON", "limit": limit,
        "westlon": west, "eastlon": east, "minlat": bbox.south, "maxlat": bbox.north,
        **spec,
    }
    with urllib.request.urlopen(f"{ODE_URL}?{urllib.parse.urlencode(params)}", timeout=60) as resp:
        payload = json.load(resp)
    products = payload.get("ODEResults", {}).get("Products", {}) or {}
    items = products.get("Product", [])
    return items if isinstance(items, list) else [items]


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        urllib.request.urlretrieve(url, dest)
    return dest


def clip_raster(src_path: Path, bbox: BBox, dest: Path) -> Path:
    """Cut the site window out of a (possibly huge) GeoTIFF so only a few MB are kept."""
    import rasterio
    from rasterio.windows import from_bounds

    with rasterio.open(src_path) as src:
        window = from_bounds(*bbox.as_tuple(), transform=src.transform)
        data = src.read(window=window)
        profile = src.profile | {
            "height": data.shape[1], "width": data.shape[2],
            "transform": src.window_transform(window),
        }
    dest.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dest, "w", **profile) as out:
        out.write(data)
    return dest


def run(site_id: str, product: str, list_only: bool) -> int:
    site, bbox = site_bbox(site_id)
    out_dir = RAW_DIR / site_id / product.lower()
    if product in EARTHDATA_PRODUCTS:
        results = search_earthdata(product, bbox)
        print(f"[{site_id}] {product}: {len(results)} granules")
        if results and not list_only:
            import earthaccess
            earthaccess.download(results[:3], local_path=str(out_dir))
    elif product in ODE_PRODUCTS:
        results = search_ode(product, bbox)
        print(f"[{site_id}] {product}: {len(results)} products")
        for p in results[:5]:
            print("   ", p.get("pdsid"), p.get("UTCstart", ""))
    elif product in GLOBAL_PRODUCTS:
        results = [GLOBAL_PRODUCTS[product]]
        print(f"[{site_id}] {product}: global mosaic (clip locally)")
        if not list_only:
            mosaic = download(GLOBAL_PRODUCTS[product], RAW_DIR / "_global" / Path(GLOBAL_PRODUCTS[product]).name)
            clip_raster(mosaic, bbox, out_dir / f"{site_id}_{product.lower()}.tif")
    else:
        raise SystemExit(f"Unknown product {product}")
    return len(results)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", help="site id from config/*.yaml")
    parser.add_argument("--product", help="product key, e.g. NASADEM, EMIT, CRISM, MOLA, LOLA")
    parser.add_argument("--all", action="store_true", help="every site x its default products")
    parser.add_argument("--list-only", action="store_true", help="search only, no download")
    args = parser.parse_args()

    if args.all:
        coverage = {}
        for sid, site in load_sites().items():
            for prod in products_for(site):
                try:
                    coverage[f"{sid}:{prod}"] = run(sid, prod, args.list_only)
                except Exception as exc:  # keep going so the coverage table is complete
                    print(f"[{sid}] {prod}: ERROR {exc}")
                    coverage[f"{sid}:{prod}"] = None
        missing = [k for k, v in coverage.items() if not v]
        print("\nMissing coverage (decision point - change sites before building UI):", missing or "none")
    elif args.site and args.product:
        run(args.site, args.product, args.list_only)
    else:
        parser.error("use --site and --product, or --all")


if __name__ == "__main__":
    main()
