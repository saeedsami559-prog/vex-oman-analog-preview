import numpy as np
import pytest

from analog.metrics.terrain import relief_m, roughness_rms_m, slope_deg, terrain_metrics


def test_slope_of_tilted_plane():
    res = 30.0
    rows, cols = np.indices((50, 50))
    dem = cols * res * np.tan(np.radians(10))  # 10 degree ramp toward +x
    assert np.allclose(slope_deg(dem, res), 10.0, atol=1e-6)


def test_plane_has_zero_roughness():
    rows, cols = np.indices((60, 60))
    dem = 2.0 * rows + 0.5 * cols + 100
    assert roughness_rms_m(dem, 30.0, window_m=600) == pytest.approx(0.0, abs=1e-6)


def test_relief_of_step():
    dem = np.zeros((20, 20))
    dem[:, 10:] = 250.0
    assert relief_m(dem, 30.0, window_m=600) == pytest.approx(250.0)


def test_terrain_metrics_keys():
    rng = np.random.default_rng(0)
    dem = rng.normal(0, 5, size=(43, 43)).cumsum(axis=0)
    m = terrain_metrics(dem, 463.0)
    assert set(m) == {"slope_deg", "roughness_m", "relief_m"}
    assert all(np.isfinite(v) and v >= 0 for v in m.values())
