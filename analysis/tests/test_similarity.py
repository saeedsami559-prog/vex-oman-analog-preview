import pytest

from analog.export import build, load_config
from analog.normalize import normalize_value
from analog.similarity import similarity

BASE = load_config()
CONFIG = {**BASE, "feature_ranges": {
    "slope_deg": [0, 30], "roughness_m": [-1, 2], "relief_m": [1, 3.3],
    "serpentine_index": [0, 0.1], "carbonate_index": [0, 0.1], "chloride_index": [0, 1],
    "albedo": [0, 0.5], "thermal_inertia": [0, 2000],
}}
FULL = {
    "slope_deg": 5, "roughness_m": 20, "relief_m": 300,
    # Every mineral value sits above the signal floor (0.2 of its range) so FULL vs FULL is a full match.
    "serpentine_index": 0.03, "carbonate_index": 0.04, "chloride_index": 0.3,
    "albedo": 0.25, "thermal_inertia": 500,
}
RES = {"terrain": 463, "mineralogy": 60, "surface": 500}


def test_identical_sites_score_one_with_full_confidence():
    r = similarity(FULL, FULL, RES, RES, CONFIG)
    assert r["overall"] == pytest.approx(1.0)
    assert r["confidence"] == pytest.approx(1.0)


def test_symmetric():
    other = {**FULL, "slope_deg": 20, "albedo": 0.1}
    a = similarity(FULL, other, RES, RES, CONFIG)
    b = similarity(other, FULL, RES, RES, CONFIG)
    assert a["overall"] == pytest.approx(b["overall"])


def test_missing_criteria_lower_confidence_not_score():
    terrain_only = {k: (v if k in ("slope_deg", "roughness_m", "relief_m") else None) for k, v in FULL.items()}
    r = similarity(FULL, terrain_only, RES, RES, CONFIG)
    assert r["overall"] == pytest.approx(1.0)
    assert r["per_criterion"]["mineralogy"] is None
    assert r["coverage"] == pytest.approx(0.4)
    assert r["confidence"] < 0.5


def test_missing_feature_inside_a_criterion_lowers_coverage():
    no_ti = {**FULL, "thermal_inertia": None}
    r = similarity(FULL, no_ti, RES, RES, CONFIG)
    assert r["per_criterion"]["surface"] == pytest.approx(1.0)
    assert r["coverage"] == pytest.approx(1 - 0.2 / 2)


def test_feature_without_range_is_not_compared():
    cfg = {**CONFIG, "feature_ranges": {**CONFIG["feature_ranges"], "chloride_index": None}}
    r = similarity(FULL, FULL, RES, RES, cfg)
    assert r["coverage"] == pytest.approx(1 - 0.4 / 3)


def test_mineral_indices_are_compared_within_each_instrument():
    # Earth (EMIT) band depths are ~40x larger than Mars (CRISM) ones; the strongest signal on each
    # side must still match the strongest on the other, not the weakest.
    cfg = {**CONFIG, "feature_ranges_by_body": {
        "serpentine_index": {"earth": [0.04, 0.12], "mars": [0.0015, 0.0035]},
        "carbonate_index": {"earth": None, "mars": None},
        "chloride_index": {"earth": None, "mars": None},
    }}
    strong_earth = {**FULL, "serpentine_index": 0.12}
    weak_earth = {**FULL, "serpentine_index": 0.04}
    strong_mars = {**FULL, "serpentine_index": 0.0035}
    ms = similarity(strong_earth, strong_mars, RES, RES, cfg, None, "earth", "mars")["per_criterion"]["mineralogy"]
    mw = similarity(weak_earth, strong_mars, RES, RES, cfg, None, "earth", "mars")["per_criterion"]["mineralogy"]
    assert ms == pytest.approx(1.0)
    assert mw == pytest.approx(0.0)


def test_log_scale_normalisation():
    assert normalize_value(100, [1, 3], "log10") == pytest.approx(0.5)
    with pytest.raises(ValueError):
        normalize_value(0, [1, 3], "log10")


def test_resolution_mismatch_lowers_confidence():
    coarse = {"terrain": 463, "mineralogy": 18, "surface": 7410}
    assert similarity(FULL, FULL, RES, coarse, CONFIG)["confidence"] < 1.0


def test_custom_weights_change_result():
    other = {**FULL, "serpentine_index": 0.09}
    terrain_heavy = similarity(FULL, other, RES, RES, CONFIG, {"terrain": 1, "mineralogy": 0, "surface": 0})
    mineral_heavy = similarity(FULL, other, RES, RES, CONFIG, {"terrain": 0, "mineralogy": 1, "surface": 0})
    assert terrain_heavy["overall"] > mineral_heavy["overall"]


def test_zero_weights_give_no_score():
    r = similarity(FULL, FULL, RES, RES, CONFIG, {"terrain": 0, "mineralogy": 0, "surface": 0})
    assert r["overall"] is None and r["confidence"] == 0.0


def test_dataset_scores_every_pair_in_range():
    data = build()
    assert len(data["scores"]) == len(data["earth_sites"]) * len(data["targets"])
    for s in data["scores"]:
        assert s["overall"] is None or 0.0 <= s["overall"] <= 1.0
        assert 0.0 <= s["confidence"] <= 1.0


def test_shared_absence_is_not_a_mineral_match():
    # Both sites below the floor on every mineral: no shared signal, so minerals are not compared
    # (instead of scoring 1.0) and coverage drops by the whole mineral criterion.
    weak = {**FULL, "serpentine_index": 0.001, "carbonate_index": 0.0, "chloride_index": 0.05}
    r = similarity(weak, weak, RES, RES, CONFIG)
    assert r["per_criterion"]["mineralogy"] is None
    assert r["coverage"] == pytest.approx(0.6)


def test_one_side_above_the_floor_is_still_compared():
    weak = {**FULL, "serpentine_index": 0.001}
    r = similarity(FULL, weak, RES, RES, CONFIG)
    assert r["per_criterion"]["mineralogy"] is not None
    assert r["per_criterion"]["mineralogy"] < 1.0


def test_floor_can_be_switched_off():
    cfg = {k: v for k, v in CONFIG.items() if k != "signal_floor"}
    weak = {**FULL, "serpentine_index": 0.001, "carbonate_index": 0.0, "chloride_index": 0.05}
    r = similarity(weak, weak, RES, RES, cfg)
    assert r["per_criterion"]["mineralogy"] == pytest.approx(1.0)
