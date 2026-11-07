# Methodology

Owner: Abdulrahman · Status: v0.2, measured data only (weights still to be reviewed with a geologist)

## 1. Principle

Python computes raw metrics once per site from real datasets (`python -m analog.compute`); the
website reads JSON only. **No metric value is ever written by hand.** A value is either measured,
with provenance (dataset, version, product IDs, URLs, dates, resolution, processing), or `null` with
a reason (see `docs/data-sources.md`). The similarity index is implemented twice,
`analysis/src/analog/similarity.py` and `web/src/lib/similarity.ts`, and
`analysis/tests/test_parity.py` + `web/src/lib/similarity.test.ts` run identical cases through both.

## 2. Criteria and features

Defined in `analysis/config/weights.yaml`.

| Criterion | Weight | Features | Scale |
|---|---|---|---|
| Terrain | 0.4 | mean slope (°), RMS roughness (m, ~1.4 km windows, plane-detrended), local relief (m, 5 km windows) | linear, log10, log10 |
| Mineralogy | 0.4 | serpentine, carbonate (mean band depth), chloride (not computed, see §5) | linear |
| Surface | 0.2 | albedo, thermal inertia (TIU) | linear |

Moon targets: terrain only (minerals and surface are `not_applicable`).

## 3. Common spatial scale

Every DEM is first reprojected to a site-centred azimuthal-equidistant grid at its native resolution.
It is then area-averaged (GDAL `average`) to **exactly 463 m** (`common_terrain_scale_m`, MOLA's grid)
before slope, roughness and relief are computed (`compute.py::_dem`). The previous whole-pixel block
factor, round(463/30) = 15, produced a 450 m grid while slope used 463 m spacing. That biased the slope
by ~3 %, and it has been removed. Fine grids always look rougher, so comparing 30 m NASADEM with
463 m MOLA directly would be misleading.

## 4. Formula

```
x'           = log10(x) for roughness_m and relief_m, x otherwise
norm(x)      = clip((x' − min) / (max − min), 0, 1)
               min, max = lowest / highest measured x' over ALL sites (Earth + Mars + Moon)
score_c      = mean over features measured on both sides of (1 − |norm_a − norm_b|)
               (mineral features: skipped when both sides are below `signal_floor` = 0.2 of their body's range)
overall      = Σ w_c · score_c / Σ w_c                 over criteria with ≥ 1 shared feature
coverage     = Σ w_c · (shared_c / n_c) / Σ w_c        over all criteria with w > 0
res_factor_c = max(0.5, 1 − 0.1 · |log2(res_a / res_b)|)   native resolutions from provenance
confidence   = coverage × (Σ w_c · res_factor_c / Σ w_c)
```

Confidence levels in the UI: high ≥ 0.70, medium ≥ 0.45, low otherwise.

**Normalisation ranges (data-justified).** The old fixed ranges (roughness 0–150 m, relief
0–2000 m, …) were much wider than anything measured (maximum roughness ≈ 34 m), so every pair looked
similar. Ranges are now the pooled min..max of the measured values, recomputed by `export.py` and
written into `sites.json`, so Python and the browser use identical numbers. Roughness and relief span
about two orders of magnitude (≈ 0.5–34 m, ≈ 13–1800 m), and on a linear scale the two extreme sites
(Jebel Shams, lunar pole) would push every other site into the bottom tenth of the range. Hence log10.
A feature measured at fewer than two sites gets no range and is not compared. Consequence: adding or
removing a site changes the ranges, and so the scores. Ranges are therefore published with each export.

**Mineral indices are scaled within each body.** Serpentine and carbonate band depths come from EMIT
surface reflectance on Earth and CRISM I/F on Mars. Their absolute values are not on one scale
(Earth 0.04–0.12, every Mars target below 0.004), so a pooled range put all of Mars at ≈ 0. Mineralogy
then rewarded Earth sites for having *little* serpentine: the salt flat scored as more Jezero-like than
the serpentinised Samail ophiolite. `body_relative_features` in `config/weights.yaml` makes these
features use per-body ranges (`feature_ranges_by_body` in `sites.json`). With that change Samail ranks
first by mean Mars similarity and matches Nili Fossae best, and Umm as Samim matches the Terra Sirenum
chlorides. Limitation: with four measured Mars targets the per-body scale is coarse; the weakest
target is always 0 and the strongest 1.

**Coverage counts missing features.** Coverage used to count a criterion as fully covered when any
one of its features was shared (albedo alone gave full surface coverage). Coverage is now
feature-weighted, so every missing value, including chloride everywhere and Earth thermal inertia,
lowers confidence.

**No terrain resolution penalty.** Terrain is compared on the common 463 m grid, so `export.py` sets the
terrain resolution of every site to 463 m and the factor is 1. Mineralogy (EMIT 60 m vs CRISM 18 m)
and surface (MODIS 500 m / TES 7.4 km / THEMIS 100 m) keep the penalty. It uses the coarsest native
resolution among the criterion's measured features.

## 5. Mineral indices (`metrics/mineralogy.py`)

**Shared absence is not similarity (`signal_floor` in `weights.yaml`).** Mineral indices are scaled
within each body, so the weakest Earth site and the weakest Mars target both land near 0. Before this
rule, Umm as Samim vs Terra Sirenum scored 100% on minerals although neither shows serpentine or
carbonate. A mineral feature is now compared only when at least one site reaches 0.2 of its body's
range; otherwise it is skipped for that pair and coverage drops. Effect: Umm as Samim vs Terra Sirenum
86.9% → 78.2% (minerals not compared, confidence 65% → 44%); the ranking of the Omani sites is unchanged.


* **Band depth** `BD = 1 − R_center / R_continuum`, continuum linear between shoulders.
* Serpentine: 2.32 µm Mg-OH band (Ehlmann et al. 2010). Carbonate: requires **both** 2.33 µm and
  2.50 µm bands, taking the smaller of the two depths (Ehlmann et al. 2008). Serpentine has no 2.5 µm
  feature, which separates the two.
* **Site index = mean band depth over all valid pixels in the window.** The former detection threshold
  (0.02) and saturation (0.15) had no cited source and were removed. The mean still grows with both
  the exposed fraction and the band strength. These are spectral proxies, not abundances.
* The same code runs on EMIT surface reflectance (Earth) and CRISM MTRDR I/F (Mars).
* **Chloride is not computed:** no diagnostic absorption between 0.4 and 2.5 µm and no cited threshold
  (`calibration_missing`).
* CRISM targeted observations cover only part of a window. The covered fraction is recorded in
  provenance (`window_coverage`) and shown in the UI.

## 6. Surface

* Albedo: MODIS MCD43A4 NBAR + Liang (2001) for Earth (an approximation of true albedo, see
  data-sources.md); TES Lambert albedo for Mars.
* Thermal inertia, Mars: THEMIS quantitative TI mosaic (100 m, ±20 % absolute), median over the window.
  TES 2007 nightside TI is used only where THEMIS has no pixel.
* Thermal inertia, Earth: **not estimated.** ATI from MODIS day/night LST would need an ATI → TI
  calibration we have no cited source for (`calibration_missing`).

## 7. Validation

The Dhofar AMADEE-18 site (chosen by experts for a 2018 Mars simulation) is the reference.
`export.py` ranks all Omani sites by mean similarity to Mars targets. The current result, with measured
data only, is in `sites.json` → `validation` and on the Methodology page. It is reported as computed,
and the method is not adjusted to improve it. The AMADEE-18 coordinates are approximate (see sites.md).

## 7b. Field environment (context, not scored)

Site pages, the Analog Atlas and the mission plan show NASA POWER monthly climatology (2001–2025) for each
Omani site and for the Majlis al Jinn candidate: air temperature at 2 m (mean, extremes, day–night range),
rain, all-sky solar irradiance, humidity and wind. `analog/environment.py` reads the raw API answers
unchanged and derives only rain per year and the coolest three consecutive months (Dec–Feb at every site).
POWER describes a coarse grid cell, so each page shows the cell height next to the NASADEM elevation range
and, where the ground is more than 500 m higher, the standard-atmosphere lapse-rate estimate (6.5 °C per km).
Climate is not in the similarity index: that would need an equivalent Mars source (for example the Mars
Climate Database) and a defensible way to compare Earth and Mars weather.

## 8. Open questions for the geologist review

1. Should mineralogy weigh more than terrain for the Mars comparison?
2. Is there a cited ATI → thermal inertia calibration for hyper-arid Oman surfaces?
3. Is there a cited VSWIR or TIR chloride detection method usable on both EMIT and CRISM/THEMIS?
4. Exact AMADEE-18 field coordinates (Groemer et al. 2020).
