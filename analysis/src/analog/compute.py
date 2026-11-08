"""Compute metrics from real NASA data and write data/processed/metrics/<id>.json.

    python -m analog.compute                 # every site
    python -m analog.compute --site jezero_crater

Every feature in config/weights.yaml ends up either `measured` (value + provenance) or `missing`
(null + reason, see provenance.py). Only the window around each site is read, never whole scenes:

  Earth terrain   NASADEM_HGT v001 (30 m)              Planetary Computer mirror, no login
  Earth albedo    MODIS MCD43A4 v061 NBAR (500 m)       Planetary Computer, 12 monthly composites
  Earth minerals  EMIT L2A reflectance (60 m)           LP DAAC, needs Earthdata Login (download/emit.py)
  Mars terrain    MGS MOLA global DEM (463 m)           USGS Astrogeology
  Mars albedo     MGS TES Lambert albedo (7.4 km)       USGS Astrogeology
  Mars minerals   MRO CRISM MTRDR I/F (18 m)            PDS Geosciences via ODE (download/crism.py)
  Mars TI         THEMIS quantitative TI mosaic (100 m) USGS Astrogeology; TES 2007 nightside fallback
  Moon terrain    LRO LOLA LDEM_875S_20M (20 m)         PDS Geosciences Node

Earth thermal inertia and chloride indices are never estimated: there is no cited calibration.
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable

import numpy as np

from .download.sites import BODY_RADIUS_KM, bbox_for, load_sites
from .export import METRICS_DIR, load_config
from .metrics.mineralogy import REQUIRED_WAVELENGTHS_UM, mineral_metrics
from .metrics.terrain import terrain_metrics
from .provenance import Measured, Missing

PC_API = "https://planetarycomputer.microsoft.com/api"
MOLA_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
TES_ALBEDO_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_TES_Albedo_mosaic_global_7410m.tif"
LOLA_SOUTH_URL = ("https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/"
                  "polar/float_img/ldem_875s_20m_float.lbl")
THEMIS_TI_BASE = ("https://asc-astropedia.s3.us-west-2.amazonaws.com/Mars/Odyssey/"
                  "THEMIS-Global-Thermal-Inertia-Mosaic/Quantitative-32-Bit/")
TES_TI_LBL = "https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.lbl"

GDAL_ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MAX_RETRY": "4", "GDAL_HTTP_RETRY_DELAY": "2"}

TERRAIN = ("slope_deg", "roughness_m", "relief_m")
MINERALS = ("serpentine_index", "carbonate_index")

# Liang (2001) narrow-to-broadband shortwave albedo for MODIS bands 1-5 and 7.
LIANG_MODIS = {1: 0.160, 2: 0.291, 3: 0.243, 4: 0.116, 5: 0.112, 7: 0.081}
LIANG_OFFSET = -0.0015

EARTHDATA_NEEDED = ("EMIT mineral maps are free but need a NASA Earthdata login, which this computing run did not have. With one, the same pipeline adds the mineral part of the score for this site.")
# How to run with a login: see download/emit.py (~/.netrc, EARTHDATA_USERNAME/PASSWORD or EARTHDATA_TOKEN).
EARTHDATA_NEEDED_AR = ("خرائط المعادن من EMIT مجانية لكنها تتطلب حساب NASA Earthdata، ولم يكن متاحاً في عملية الحساب هذه. مع الحساب يضيف البرنامج نفسه جزء المعادن إلى درجة هذا الموقع.")


def liang_albedo(bands: dict[int, np.ndarray]) -> np.ndarray:
    """Broadband shortwave albedo from MODIS reflectances (Liang 2001)."""
    return sum(coef * bands[b] for b, coef in LIANG_MODIS.items()) + LIANG_OFFSET


# ---------- HTTP / STAC helpers ----------

def _json(url: str, body: dict | None = None) -> Any:
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.load(resp)


def pc_search(collection: str, bbox: tuple[float, float, float, float], datetime_range: str | None = None,
              limit: int = 20) -> list[dict]:
    body: dict[str, Any] = {"collections": [collection], "bbox": list(bbox), "limit": limit}
    if datetime_range:
        body["datetime"] = datetime_range
    return _json(f"{PC_API}/stac/v1/search", body)["features"]


_TOKENS: dict[str, str] = {}


def pc_signed(href: str) -> str:
    """Append a read-only SAS token for the blob container (anonymous, no account needed)."""
    account = href.split("//")[1].split(".")[0]
    container = href.split(".net/")[1].split("/")[0]
    key = f"{account}/{container}"
    if key not in _TOKENS:
        _TOKENS[key] = _json(f"{PC_API}/sas/v1/token/{key}")["token"]
    return f"{href}?{_TOKENS[key]}"


# ---------- local metric grid ----------

def local_crs(lat: float, lon: float, body: str):
    from rasterio.crs import CRS

    if body == "earth":
        return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs")
    radius = BODY_RADIUS_KM[body] * 1000
    return CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +R={radius} +units=m +no_defs")


def local_grid(lat: float, lon: float, half_km: float, body: str, res_m: float):
    """Azimuthal equidistant grid centred on the site, so pixels are square metres everywhere
    (including the lunar pole, where lat/lon grids collapse). Pixel size is exactly `res_m`."""
    from rasterio.transform import from_origin

    half = half_km * 1000
    n = int(round(2 * half / res_m))
    edge = n * res_m / 2
    return local_crs(lat, lon, body), from_origin(-edge, edge, res_m, res_m), (n, n)


def warp_into(dst: np.ndarray, src_path: str, dst_crs, dst_transform, band: int = 1, scale: float = 1.0,
              valid_min: float | None = None, valid_max: float | None = None, resampling: str = "bilinear") -> None:
    """Reproject one band of a (remote) raster into `dst`, keeping cells already filled."""
    import rasterio
    from rasterio.warp import Resampling, reproject

    with rasterio.Env(**GDAL_ENV), rasterio.open(src_path) as src:
        tmp = np.full(dst.shape, np.nan, dtype="float64")
        reproject(
            source=rasterio.band(src, band), destination=tmp,
            src_nodata=src.nodata, dst_nodata=np.nan,
            dst_transform=dst_transform, dst_crs=dst_crs, resampling=Resampling[resampling],
        )
    tmp *= scale
    if valid_min is not None:
        tmp[tmp < valid_min] = np.nan
    if valid_max is not None:
        tmp[tmp > valid_max] = np.nan
    fill = np.isnan(dst) & np.isfinite(tmp)
    dst[fill] = tmp[fill]


def average_to(dem: np.ndarray, crs, src_transform, dst_transform, shape: tuple[int, int]) -> np.ndarray:
    """Area-weighted average of a native-resolution local grid onto a coarser one (same CRS)."""
    from rasterio.warp import Resampling, reproject

    out = np.full(shape, np.nan)
    reproject(source=dem, destination=out, src_transform=src_transform, src_crs=crs, src_nodata=np.nan,
              dst_transform=dst_transform, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.average)
    return out


def _finite_median(a: np.ndarray) -> float:
    f = a[np.isfinite(a)]
    return float(np.median(f)) if f.size else float("nan")


def _bbox_deg(site: dict) -> tuple[float, float, float, float]:
    return bbox_for(site["lat"], site["lon"], site["bbox_km"], site["body"]).as_tuple()


def _unsigned(href: str) -> str:
    return href.split("?")[0]


# ---------- terrain ----------

def _dem(site: dict, native_res: float, fill: Callable[[np.ndarray, Any, Any], dict]) -> tuple[np.ndarray, float, dict]:
    """DEM on the native local grid, then area-averaged to exactly the common scale."""
    common = load_config()["common_terrain_scale_m"]
    crs, src_t, src_shape = local_grid(site["lat"], site["lon"], site["bbox_km"], site["body"], native_res)
    native = np.full(src_shape, np.nan)
    info = fill(native, crs, src_t)
    coverage = float(np.isfinite(native).mean())
    _, dst_t, dst_shape = local_grid(site["lat"], site["lon"], site["bbox_km"], site["body"], common)
    return average_to(native, crs, src_t, dst_t, dst_shape), coverage, info


def earth_dem(site: dict):
    items = pc_search("nasadem", _bbox_deg(site))

    def fill(dem, crs, t):
        for item in items:
            warp_into(dem, f"/vsicurl/{pc_signed(item['assets']['elevation']['href'])}", crs, t)
        return {
            "dataset": "NASADEM_HGT (NASA SRTM reprocessing), Microsoft Planetary Computer COG mirror",
            "version": "001",
            "products": [i["id"] for i in items],
            "urls": [_unsigned(i["assets"]["elevation"]["href"]) for i in items],
            "acquired": sorted({i["properties"]["datetime"][:10] for i in items}),
            "native_resolution_m": 30,
        }
    return _dem(site, 30.0, fill)


def mars_dem(site: dict):
    def fill(dem, crs, t):
        warp_into(dem, f"/vsicurl/{MOLA_URL}", crs, t)
        return {"dataset": "MGS MOLA DEM global mosaic 463 m (USGS Astrogeology, MOLA Team / GSFC)",
                "version": "edition 2003-03-21", "products": ["Mars_MGS_MOLA_DEM_mosaic_global_463m"],
                "urls": [MOLA_URL], "acquired": ["1999/2001 (MOLA mapping, per USGS product page)"],
                "native_resolution_m": 463}
    return _dem(site, 463.0, fill)


def moon_dem(site: dict):
    if site["lat"] > -87.5:
        raise ValueError("Only the LOLA 87.5S polar tile is wired up; add another tile for this latitude.")

    def fill(dem, crs, t):
        warp_into(dem, f"/vsicurl/{LOLA_SOUTH_URL}", crs, t, scale=1000.0)  # heights are in km
        return {"dataset": "LRO LOLA polar gridded DEM (LRO-L-LOLA-4-GDR-V1.0)", "version": "V2.1",
                "products": ["LDEM_875S_20M"], "urls": [LOLA_SOUTH_URL],
                "acquired": ["2009-07-13/2017-02-02"], "native_resolution_m": 20}
    return _dem(site, 20.0, fill)


DEM_SOURCES = {"earth": earth_dem, "mars": mars_dem, "moon": moon_dem}


def terrain(site: dict) -> list[Measured | Missing]:
    grid, coverage, info = DEM_SOURCES[site["body"]](site)
    if coverage < 0.9:
        return [Missing(f, "no_coverage", info["dataset"], "A DEM tile that covers the whole site window.",
                        "نموذج ارتفاع يغطي نافذة الموقع كاملة.", f"DEM covers {coverage:.0%} of the window",
                        f"يغطي {coverage:.0%} من النافذة") for f in TERRAIN]
    common = load_config()["common_terrain_scale_m"]
    values = terrain_metrics(grid, common)
    prov = {**info, "window_coverage": round(coverage, 4),
            "processing": (f"Reprojected to a site-centred azimuthal-equidistant grid at native resolution, "
                           f"area-averaged to exactly {common} m, then slope (central differences), "
                           f"RMS roughness (plane-detrended, ~1.4 km windows, median) and relief "
                           f"(max-min in 5 km windows, median).")}
    return [Measured(f, values[f], prov) for f in TERRAIN]


# ---------- albedo ----------

def earth_albedo(site: dict, year: int = 2023) -> list[Measured | Missing]:
    """Median of 12 monthly MODIS NBAR composites -> one broadband albedo per site."""
    crs, transform, shape = local_grid(site["lat"], site["lon"], site["bbox_km"], "earth", 500)
    bbox = _bbox_deg(site)
    monthly, used, dates, urls = [], [], [], []
    for month in range(1, 13):
        items = pc_search("modis-43A4-061", bbox, f"{year}-{month:02d}-10/{year}-{month:02d}-20", limit=1)
        if not items:
            continue
        item = items[0]
        bands = {}
        for b in LIANG_MODIS:
            arr = np.full(shape, np.nan)
            href = item["assets"][f"Nadir_Reflectance_Band{b}"]["href"]
            warp_into(arr, f"/vsicurl/{pc_signed(href)}", crs, transform, scale=1e-4, valid_max=1.0)
            bands[b] = arr
        value = _finite_median(liang_albedo(bands))
        if np.isfinite(value):
            monthly.append(value)
            used.append(item["id"])
            dates.append(f"{item['properties']['start_datetime'][:10]}/{item['properties']['end_datetime'][:10]}")
            urls += [_unsigned(item["assets"][f"Nadir_Reflectance_Band{b}"]["href"]) for b in LIANG_MODIS]
    if not monthly:
        return [Missing("albedo", "no_coverage", "MODIS MCD43A4 v061", "Valid MODIS NBAR composites for this window.",
                        "مركبات MODIS NBAR صالحة لهذه النافذة.")]
    return [Measured("albedo", float(np.median(monthly)), {
        "dataset": "MODIS MCD43A4 Nadir BRDF-Adjusted Reflectance (Terra+Aqua), Planetary Computer COGs",
        "version": "061", "products": used, "urls": urls, "acquired": dates, "native_resolution_m": 500,
        "monthly_values": [round(v, 4) for v in monthly],
        "processing": ("Liang (2001, Remote Sens. Environ. 76:213-238) narrow-to-broadband shortwave conversion "
                       "of NBAR bands 1-5 and 7; median over the window per composite, then median of the "
                       f"{len(monthly)} monthly composites of {year}. NBAR is nadir reflectance, not true albedo: "
                       "MCD43A3 albedo needs an Earthdata Login and HDF4 support."),
    })]


def mars_albedo(site: dict) -> list[Measured | Missing]:
    crs, transform, shape = local_grid(site["lat"], site["lon"], site["bbox_km"], "mars", 1000)
    arr = np.full(shape, np.nan)
    warp_into(arr, f"/vsicurl/{TES_ALBEDO_URL}", crs, transform, valid_max=1.0)
    value = _finite_median(arr)
    if not np.isfinite(value):
        return [Missing("albedo", "no_coverage", "MGS TES albedo", "TES albedo pixels over the window.",
                        "بكسلات ألبيدو TES فوق النافذة.")]
    return [Measured("albedo", value, {
        "dataset": "MGS TES Lambert albedo global mosaic (Christensen et al. 2001, JGR 106:23823), USGS Astrogeology",
        "version": "edition 2001", "products": ["GLOBAL_ALBEDO_8PPD"], "urls": [TES_ALBEDO_URL],
        "acquired": ["not stated in the product label or USGS record"], "native_resolution_m": 7410,
        "processing": "Bilinear reprojection to a 1 km site grid, median of valid pixels.",
    })]


# ---------- thermal inertia ----------

def themis_tiles(site: dict) -> list[str]:
    """Quantitative THEMIS TI tile names covering the window: 30x60 deg, e.g. 00N060E = 0..30N, 60..120E."""
    west, south, east, north = _bbox_deg(site)
    names = set()
    for lat in (south, north):
        for lon in (west, east):
            lat_band = int(math.floor(lat / 30.0) * 30)
            lon0 = int(math.floor((lon % 360) / 60.0) * 60)
            names.add(f"{abs(lat_band):02d}{'N' if lat_band >= 0 else 'S'}{lon0:03d}E")
    return sorted(names)


def mars_thermal_inertia(site: dict) -> list[Measured | Missing]:
    if abs(site["lat"]) > 60:
        return [Missing("thermal_inertia", "no_coverage", "THEMIS quantitative TI mosaic",
                        "A thermal inertia map poleward of 60 degrees.", "خريطة قصور حراري لما بعد خط عرض 60.")]
    crs, transform, shape = local_grid(site["lat"], site["lon"], site["bbox_km"], "mars", 100)
    arr = np.full(shape, np.nan)
    tiles = themis_tiles(site)
    urls = [f"{THEMIS_TI_BASE}THEMIS_TI_Mosaic_Quant_{t}_100mpp.cub" for t in tiles]
    for url in urls:
        warp_into(arr, f"/vsicurl/{url}", crs, transform, valid_min=1.0, resampling="nearest")
    coverage = float(np.isfinite(arr).mean())
    if coverage > 0:
        return [Measured("thermal_inertia", _finite_median(arr), {
            "dataset": ("Mars Odyssey THEMIS quantitative thermal inertia mosaic, USGS Astrogeology "
                        "(Fergason et al. 2006, JGR 111:E12004; Edwards et al. 2011, JGR 116:E10009)"),
            "version": "2014-05-30", "products": [f"THEMIS_TI_Mosaic_Quant_{t}_100mpp" for t in tiles],
            "urls": urls, "acquired": ["not stated per pixel; mosaic of THEMIS nighttime band 9 images"],
            "native_resolution_m": 100, "window_coverage": round(coverage, 4),
            "processing": "Nearest-neighbour reprojection to a 100 m site grid, median of valid pixels (absolute accuracy ~20 %).",
        })]
    arr = np.full(shape, np.nan)
    warp_into(arr, f"/vsicurl/{TES_TI_LBL}", crs, transform, valid_min=1.0, resampling="nearest")
    if not np.isfinite(arr).any():
        return [Missing("thermal_inertia", "no_coverage", "THEMIS quantitative TI and TES 2007 nightside TI",
                        "Thermal inertia coverage over the site window.", "تغطية قصور حراري فوق نافذة الموقع.")]
    return [Measured("thermal_inertia", _finite_median(arr), {
        "dataset": "MGS TES nightside thermal inertia map 2007 (Putzig & Mellon), PDS MGS-M-TES-5-TIMAP-V1.0",
        "version": "2007-01-30", "products": ["GLOBAL_TI_NIGHT_2007"], "urls": [TES_TI_LBL],
        "acquired": ["1999-02/2004-04 (TES mapping, per PDS dataset page)"], "native_resolution_m": 2960,
        "processing": "THEMIS mosaic had no valid pixels here; nearest-neighbour reprojection of TES TI, median.",
    })]


# ---------- minerals ----------

def _chloride_missing(body_source: str) -> Missing:
    return Missing(
        "chloride_index", "calibration_missing", body_source,
        "A published, cited chloride detection method that can be applied identically to Earth and Mars data "
        "(VSWIR brightness/slope thresholds or a thermal-infrared emissivity method).",
        "طريقة منشورة وموثّقة لرصد الكلوريد يمكن تطبيقها بالطريقة نفسها على بيانات الأرض والمريخ.",
        "chlorides have no diagnostic absorption between 0.4 and 2.5 µm",
        "لا يملك الكلوريد امتصاصاً مميزاً بين 0.4 و2.5 ميكرومتر")


def mars_minerals(site: dict) -> list[Measured | Missing]:
    from .download import crism

    out: list[Measured | Missing] = [_chloride_missing("MRO CRISM MTRDR I/F")]
    obs = crism.search(*_bbox_deg(site))
    if not obs:
        return out + [Missing(f, "no_coverage", "MRO CRISM MTRDR (map-projected targeted observations)",
                              "Move the window onto CRISM targeted coverage, or use CRISM multispectral (MRDR) mosaics.",
                              "نقل النافذة إلى منطقة مغطاة بمشاهدات CRISM أو استخدام فسيفساء CRISM متعددة الأطياف.")
                      for f in MINERALS]
    crs, transform, shape = local_grid(site["lat"], site["lon"], site["bbox_km"], "mars", 18.0)
    mosaic, wl, used, dates = None, None, [], []
    for o in obs:  # fixed order (product ID); first valid pixel wins
        hdr, band_wl, cube, start = crism.read_bands(o, REQUIRED_WAVELENGTHS_UM)
        local = crism.to_local_grid(cube, hdr, crs, transform, shape)
        if not np.isfinite(local).all(axis=0).any():
            continue
        if mosaic is None:
            mosaic, wl = local, band_wl
        else:
            fill = ~np.isfinite(mosaic).all(axis=0) & np.isfinite(local).all(axis=0)
            mosaic[:, fill] = local[:, fill]
        used.append(o)
        dates.append(start[:10])
    if mosaic is None:
        return out + [Missing(f, "no_coverage", "MRO CRISM MTRDR", "CRISM pixels inside the site window.",
                              "بكسلات CRISM داخل نافذة الموقع.") for f in MINERALS]
    valid = np.isfinite(mosaic).all(axis=0)
    mosaic[:, ~valid] = np.nan
    values = mineral_metrics(mosaic, wl)
    prov_base = {
        "dataset": "MRO CRISM map-projected targeted reduced data record (MTRDR), I/F corrected, PDS Geosciences Node",
        "version": "MRO-M-CRISM-5-RDR-MPTARGETED-V1.0", "products": [o.product_id for o in used],
        "urls": [o.img_url for o in used], "acquired": dates, "native_resolution_m": 18,
        "window_coverage": round(float(valid.mean()), 4),
        "wavelengths_um": [round(float(w), 4) for w in wl],
    }
    for f in MINERALS:
        value, n = values[f]
        prov = {**prov_base, "valid_pixels": n,
                "processing": ("Needed bands read by HTTP range from each I/F cube, nearest-neighbour reprojection "
                               "to an 18 m site grid, observations mosaicked in product-ID order (first valid pixel "
                               "wins); mean band depth over valid pixels (see metrics/mineralogy.py).")}
        out.append(Measured(f, value, prov))
    return out


def earth_minerals(site: dict) -> list[Measured | Missing]:
    from .download import emit

    out: list[Measured | Missing] = [_chloride_missing("NASA EMIT L2A reflectance")]
    if not emit.logged_in():
        return out + [Missing(f, "needs_login", "NASA EMIT L2A reflectance (EMITL2ARFL v001)",
                              EARTHDATA_NEEDED, EARTHDATA_NEEDED_AR) for f in MINERALS]
    return out + emit.mineral_values(site, _bbox_deg(site), MINERALS)


def earth_thermal_inertia(site: dict) -> list[Measured | Missing]:
    return [Missing(
        "thermal_inertia", "calibration_missing", "MODIS MOD11A1/MYD11A1 day/night land-surface temperature",
        "A cited calibration from apparent thermal inertia to thermal inertia (J m-2 K-1 s-1/2) for arid surfaces, "
        "or a surface energy-balance model with cited parameters fitted to MODIS LST.",
        "معايرة موثّقة لتحويل القصور الحراري الظاهري إلى قصور حراري بوحدة TIU للأسطح الجافة، "
        "أو نموذج توازن طاقة بمعاملات موثّقة يُطابق على حرارة سطح MODIS.",
        "only apparent thermal inertia (ATI) can be derived, which is not comparable with Mars thermal inertia",
        "يمكن حساب القصور الحراري الظاهري فقط، وهو غير قابل للمقارنة مع القصور الحراري للمريخ")]


def not_applicable(features: tuple[str, ...]) -> list[Missing]:
    return [Missing(f, "not_applicable", "", "Nothing: the Moon is compared on terrain only.",
                    "لا شيء: القمر يُقارن بالتضاريس فقط.", "lunar sites are compared on terrain only",
                    "مواقع القمر تُقارن بالتضاريس فقط") for f in features]


BLOCKS: dict[str, list[tuple[tuple[str, ...], Callable[[dict], list]]]] = {
    "earth": [(TERRAIN, terrain), (("albedo",), earth_albedo), (("thermal_inertia",), earth_thermal_inertia),
              (MINERALS + ("chloride_index",), earth_minerals)],
    "mars": [(TERRAIN, terrain), (("albedo",), mars_albedo), (("thermal_inertia",), mars_thermal_inertia),
             (MINERALS + ("chloride_index",), mars_minerals)],
    "moon": [(TERRAIN, terrain)],
}


def compute_site(site: dict, features: list[str]) -> dict[str, Any]:
    results: list[Measured | Missing] = []
    for block_features, fn in BLOCKS[site["body"]]:
        try:
            results += fn(site)
        except Exception as exc:  # one failing source must not hide the others
            results += [Missing(f, "download_failed", fn.__name__, "Re-run when the data server responds; see the error.",
                                "إعادة التشغيل عندما يستجيب خادم البيانات؛ راجع رسالة الخطأ.",
                                f"{type(exc).__name__}: {exc}"[:300], "خطأ أثناء القراءة") for f in block_features]
    if site["body"] == "moon":
        results += not_applicable(tuple(f for f in features if f not in TERRAIN))

    by_feature = {r.feature: r for r in results}
    if sorted(by_feature) != sorted(features) or len(by_feature) != len(results):
        raise RuntimeError(f"{site['id']}: features {sorted(by_feature)} do not match config {sorted(features)}")
    return {
        "site": site["id"],
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "measured": {f: r.to_json() for f, r in by_feature.items() if isinstance(r, Measured)},
        "missing": [r.to_json() for f, r in by_feature.items() if isinstance(r, Missing)],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", help="one site id (default: all)")
    args = parser.parse_args()

    features = [f for c in load_config()["criteria"].values() for f in c["features"]]
    sites = load_sites()
    ids = [args.site] if args.site else list(sites)
    METRICS_DIR.mkdir(parents=True, exist_ok=True)
    for sid in ids:
        result = compute_site(sites[sid], features)
        with open(METRICS_DIR / f"{sid}.json", "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=2)
        print(f"[{sid}]")
        for f, m in result["measured"].items():
            print(f"   {f:18s} {m['value']:<12.4g} {m['provenance']['dataset'][:60]} | {', '.join(m['provenance']['products'][:3])}")
        for m in result["missing"]:
            print(f"   {m['feature']:18s} null         {m['reason_code']}: {m['reason_en'][:90]}")


if __name__ == "__main__":
    main()
