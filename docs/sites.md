# Sites — why each one was chosen

Owner: Narjis (with Abdulmunim). Card texts (EN/AR) live in `analysis/config/earth_sites.yaml`
and `target_sites.yaml`; edit them there and re-run `python -m analog.export`.

## Oman

**Samail Ophiolite (Wadi Tayin) → Jezero / Nili Fossae.** Earth's best-exposed slab of oceanic
mantle, close to Ibra. Peridotite + water + CO₂ → serpentine and Mg-carbonate, the mineral pair
CRISM maps at Jezero and Nili Fossae. Limits: active weathering, denser rock (higher thermal
inertia), tectonic origin with no Martian equivalent.

**Umm as Samim → Terra Sirenum chlorides.** Large inland sabkha with a chloride crust. Limits:
still fed by shallow groundwater; Martian deposits are ancient and dust-covered.

**Sharqiya (Wahiba) Sands → Nili Patera dunes.** Linear and star dunes. Limits: bright
quartz-carbonate sand vs dark basalt; Earth's atmosphere moves sand far more often.

**Dhofar desert (AMADEE-18) → reference.** Chosen by the Austrian Space Forum for a 2018 Mars
simulation. We use it to check that the index rewards a known analog. **Coordinates approximate:**
Groemer et al. (2020, Astrobiology 20(11):1276–1286, doi:10.1089/ast.2019.2031) list the field
coordinates, but the article was not accessible to us (paywall). OeWF press material only says
"near Marmul". The site carries `coords_approximate: true`, and the UI shows it.

**Jebel Shams / Wadi Ghul → lunar south pole.** Terrain only: steep slopes and ~1 km relief,
compared with crater rims near Shackleton (Artemis candidate regions). Geology is unrelated.

## Mars targets

**Terra Sirenum chloride deposit.** The window is centred on deposit FID 66 (`TS_27.25S_180.46`,
27.28° S, 180.456° E, area 118 km²) of the Osterloo et al. (2010) chloride map, as listed by
Leask & Ehlmann (2021, CaltechDATA doi:10.22002/D1.2176). Selection rule, fixed before computing any
metric: among the 168 deposits labelled `TS_`, take the largest whose centre lies inside at least one
CRISM MTRDR footprint (larger deposits FID 623, 346, 325, 360, 566 have none). The window half-width
is 5 km (≈ √area / 2) so it sits on the deposit. The previous window (30.5° S, 173° W) had ~510 m of
relief and no CRISM coverage.

## Ground rules for card text

* Always list differences and data limits next to similarities.
* Never write "identical to Mars" or similar.
* Keep each bullet under ~15 words; the same meaning in English and Arabic.
