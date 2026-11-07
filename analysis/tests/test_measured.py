import json

import numpy as np
import pytest

from analog import export
from analog.compute import LIANG_MODIS, LIANG_OFFSET, liang_albedo, themis_tiles
from analog.provenance import Measured, Missing

CONFIG = export.load_config()
PROV = {"dataset": "D", "version": "1", "products": ["P1"], "urls": [], "acquired": ["2020-01-01"],
        "native_resolution_m": 100, "processing": "x"}


def test_liang_albedo_of_uniform_surface():
    bands = {b: np.full((2, 2), 0.3) for b in LIANG_MODIS}
    expected = 0.3 * sum(LIANG_MODIS.values()) + LIANG_OFFSET
    assert np.allclose(liang_albedo(bands), expected)


def test_measured_requires_full_provenance():
    with pytest.raises(ValueError):
        Measured("albedo", 0.2, {"dataset": "D"})
    with pytest.raises(ValueError):
        Measured("albedo", 0.2, {**PROV, "products": [], "urls": []})


def test_missing_rejects_unknown_reason_and_renders_both_languages():
    with pytest.raises(ValueError):
        Missing("albedo", "looks_wrong", "S", "n", "n")
    m = Missing("albedo", "needs_login", "EMIT", "login", "تسجيل").to_json()
    assert m["status"] == "unavailable" and "EMIT" in m["reason_en"] and "EMIT" in m["reason_ar"]
    assert Missing("albedo", "not_applicable", "", "n", "n").to_json()["status"] == "not_applicable"


def test_themis_tile_names():
    assert themis_tiles({"lat": 18.44, "lon": 77.45, "bbox_km": 10, "body": "mars"}) == ["00N060E"]
    # a window straddling 30S picks both latitude bands
    assert themis_tiles({"lat": -30.0, "lon": -173.0, "bbox_km": 15, "body": "mars"}) == ["30S180E", "60S180E"]


def _write(tmp_path, sid, measured, missing):
    (tmp_path / f"{sid}.json").write_text(json.dumps({"measured": measured, "missing": missing}), encoding="utf-8")


def test_only_pipeline_values_reach_the_site(tmp_path, monkeypatch):
    monkeypatch.setattr(export, "METRICS_DIR", tmp_path)
    miss = Missing("thermal_inertia", "calibration_missing", "MODIS", "n", "n").to_json()
    _write(tmp_path, "a", {"albedo": {"value": 0.17, "provenance": PROV}}, [miss])
    [site] = export.prepare_sites([{"id": "a", "body": "mars"}], CONFIG)
    assert site["raw"]["albedo"] == 0.17
    assert all(v is None for f, v in site["raw"].items() if f != "albedo")
    assert site["measured"] == ["albedo"]
    by = {m["feature"]: m for m in site["missing"]}
    assert by["thermal_inertia"]["reason_code"] == "calibration_missing"
    assert by["slope_deg"]["reason_code"] == "not_implemented"  # absent from the file -> pipeline not run
    assert site["resolution_m"] == {"terrain": None, "mineralogy": None, "surface": 100}


def test_terrain_resolution_is_the_common_grid(tmp_path, monkeypatch):
    monkeypatch.setattr(export, "METRICS_DIR", tmp_path)
    _write(tmp_path, "e", {"slope_deg": {"value": 2.0, "provenance": {**PROV, "native_resolution_m": 30}}}, [])
    [site] = export.prepare_sites([{"id": "e", "body": "earth"}], CONFIG)
    assert site["resolution_m"]["terrain"] == CONFIG["common_terrain_scale_m"]


def test_pooled_ranges_use_log_for_relief():
    sites = [{"raw": {f: None for f in export.features_of(CONFIG)}} for _ in range(3)]
    for s, v in zip(sites, (10.0, 100.0, 1000.0)):
        s["raw"]["relief_m"] = v
    cfg = export.scoring_config(CONFIG, sites)
    assert cfg["feature_ranges"]["relief_m"] == pytest.approx([1.0, 3.0])
    assert cfg["feature_ranges"]["albedo"] is None  # fewer than two measured values
