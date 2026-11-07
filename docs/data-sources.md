# Data sources

Owner: Abdulmunim. Every metric value in `data/processed/sites.json` comes from
`python -m analog.compute`, which reads only a small window around each site (`bbox_km` in the site
YAML) and never downloads whole scenes. Each value carries its provenance (dataset, version, product
IDs, URLs, acquisition dates, native resolution, processing). A value the pipeline cannot compute is
`null` with a reason code (`no_coverage`, `needs_login`, `not_implemented`, `calibration_missing`,
`not_applicable`, `download_failed`), bilingual text and what would fix it. Nothing is filled in by hand.

All sources below were checked live (STAC / CMR / PDS ODE / S3 listings) on 2026-10-31.

## What is measured

| Metric | Earth (Oman) | Mars | Moon |
|---|---|---|---|
| Slope, roughness, relief | NASADEM_HGT v001, 30 m (Planetary Computer COG mirror) | MGS MOLA DEM 463 m global mosaic (USGS, edition 2003-03-21) | LRO LOLA `LDEM_875S_20M` (PDS Geosciences, V2.1) |
| Albedo | MODIS MCD43A4 v061 NBAR → Liang (2001) broadband, median of 12 monthly composites (2023) | MGS TES Lambert albedo, 7.4 km (Christensen et al. 2001; USGS mosaic) | `not_applicable` |
| Serpentine, carbonate index | EMIT L2A reflectance `EMITL2ARFL` v001, 60 m, window only (needs Earthdata Login: token in `.env.local`) | MRO CRISM MTRDR I/F, 18 m (PDS ODE `pt=MTRDR`), needed bands only | `not_applicable` |
| Chloride index | `calibration_missing` | `calibration_missing` | `not_applicable` |
| Thermal inertia | `calibration_missing` (see below) | THEMIS quantitative TI mosaic, 100 m (Fergason et al. 2006; Edwards et al. 2011; USGS 2014); TES 2007 nightside TI (Putzig & Mellon, PDS `MGS-M-TES-5-TIMAP-V1.0`) only where THEMIS has no pixel | `not_applicable` |

### Access details

| Source | Where | How only the window is read |
|---|---|---|
| NASADEM | `planetarycomputer.microsoft.com` STAC `nasadem` (anonymous SAS token) | GDAL `/vsicurl/` range reads on COG tiles |
| MCD43A4 | Planetary Computer STAC `modis-43A4-061` | COG range reads, bands 1–5, 7 |
| MOLA, TES albedo | `asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/` | range reads on global GeoTIFFs |
| LOLA | `pds-geosciences.wustl.edu/lro/.../ldem_875s_20m_float.lbl` | PDS3 label + range reads |
| THEMIS TI | `asc-astropedia.s3.us-west-2.amazonaws.com/Mars/Odyssey/THEMIS-Global-Thermal-Inertia-Mosaic/Quantitative-32-Bit/THEMIS_TI_Mosaic_Quant_<tile>_100mpp.cub` (24 tiles, 30°×60°, ±60°) | ISIS3 cube tiled 128×128 → range reads |
| TES TI (fallback) | `pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.lbl` | PDS3 label + range reads |
| CRISM MTRDR | PDS ODE REST `oderest.rsl.wustl.edu/live2/?query=product&pt=MTRDR` → PDS Geosciences files | band-sequential ENVI cube: each needed band is one HTTP byte range (~2.7 MB), 9 bands per observation |
| EMIT L2A | NASA CMR `C2408750690-LPCLOUD`, files on `data.lpdaac.earthdatacloud.nasa.gov` | `earthaccess.open` + `h5netcdf`: lat/lon, mask, and the needed reflectance bands for window pixels only |

### Why some values are missing

* **Chloride (all bodies).** Chlorides have no diagnostic absorption between 0.4 and 2.5 µm. Mapping
  them from VSWIR needs brightness/slope thresholds, and we have no cited calibration for any. The old
  proxy (R₁.₆ > 0.35, no 2.3 µm band) was removed.
* **Earth thermal inertia.** MODIS LST (MOD11A1/MYD11A1, available on Planetary Computer without login)
  gives apparent thermal inertia (ATI). Converting ATI into thermal inertia in TIU, comparable with
  Mars, needs a calibration we have no cited source for. We therefore do not estimate it.
* **Earth minerals.** EMIT granules are LP DAAC protected data, read with an Earthdata user token
  (`EARTHDATA_TOKEN` in `.env.local`). Measured for Samail, Umm as Samim, Sharqiya and Jebel Shams
  (2026-11-06). **Dhofar is `no_coverage`**: none of its candidate scenes has a clear pixel in the window.
  LP DAAC reads fail now and then (HTTP 502, DNS); each read is retried, and a scene that still fails is
  skipped and listed under `skipped_scenes` in the provenance. A skip changes which scenes are averaged,
  so re-run a site whose provenance lists skipped scenes. Coverage was checked: 25–39 EMIT granules per Oman site.
  Scene-level cloud cover is low (≤10 %) for Samail, Jebel Shams and Sharqiya, but ≥28 % for Umm as
  Samim and ≥80 % for Dhofar. The pipeline judges clear pixels per pixel from the L2A mask, so a
  scene-level number is not decisive.

### Earth albedo: why MCD43A4 NBAR and not MCD43A3

MCD43A3 (true white/black-sky albedo) is not on Planetary Computer. The LP DAAC copy needs an
Earthdata Login and is HDF4, which the rasterio build used here cannot read. We therefore use MCD43A4
nadir BRDF-adjusted reflectance with the Liang (2001) narrow-to-broadband conversion. NBAR is nadir
reflectance, not hemispheric albedo, so the value is an approximation. The provenance of every Earth
albedo value says so. Once a login is set up, MCD43A3 via the LP DAAC OPeNDAP service (netCDF
subset) should replace it.

## Candidate products not used for any score

| Dataset | Body | Why not used |
|---|---|---|
| ASTER AST_07XT v004 | Earth | EMIT covers all sites; mixing multispectral and hyperspectral indices would break comparability |
| Copernicus DEM GLO-30 | Earth | NASADEM covers all sites |
| MRO HiRISE DTM | Mars | Only small, scattered footprints; terrain is compared at 463 m anyway |
| LRO Diviner | Moon | The Moon is compared on terrain only by design |

## Base maps (website only, never scored)

NASA Solar System Treks WMTS (Viking MDIM 2.1, MOLA shaded relief, LRO WAC, LOLA shaded relief);
Esri World Imagery and OpenTopoMap for Earth.
