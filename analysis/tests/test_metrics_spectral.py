import numpy as np
import pytest

from analog.metrics.mineralogy import SERPENTINE_BAND, band_depth, mean_band_depth, mineral_metrics
from analog.metrics.surface import apparent_thermal_inertia, summary

WL = np.round(np.arange(1.50, 2.60, 0.01), 2)


def flat_cube(value=0.3, shape=(4, 4)):
    return np.full((WL.size, *shape), value)


def test_flat_spectrum_has_no_band_depth():
    assert np.allclose(band_depth(flat_cube(), WL, SERPENTINE_BAND), 0.0)


def test_absorption_detected_as_serpentine_not_carbonate():
    cube = flat_cube()
    cube[np.argmin(np.abs(WL - 2.32))] = 0.24  # 20% dip at 2.32 um only
    m = mineral_metrics(cube, WL)
    assert m["serpentine_index"][0] == pytest.approx(0.2)
    assert m["carbonate_index"][0] == 0.0  # no 2.5 um band -> not carbonate


def test_mean_depth_scales_with_exposed_fraction():
    cube = flat_cube()
    cube[np.argmin(np.abs(WL - 2.32)), :2, :] = 0.24  # half the pixels carry a 20% band
    value, n = mineral_metrics(cube, WL)["serpentine_index"]
    assert value == pytest.approx(0.1) and n == 16


def test_no_chloride_index_is_computed():
    assert "chloride_index" not in mineral_metrics(flat_cube(), WL)


def test_mean_band_depth_ignores_nan_and_reports_count():
    assert mean_band_depth(np.array([0.1, np.nan, 0.3])) == (pytest.approx(0.2), 2)
    value, n = mean_band_depth(np.array([np.nan]))
    assert np.isnan(value) and n == 0


def test_ati_drops_with_larger_temperature_swing():
    albedo = np.array([0.3, 0.3])
    ati = apparent_thermal_inertia(albedo, np.array([320.0, 340.0]), np.array([300.0, 300.0]))
    assert ati[0] > ati[1]


def test_summary_ignores_nan():
    assert summary(np.array([1.0, np.nan, 3.0])) == 2.0
