import numpy as np
import pytest

from analog.layers import drainage_stats, slope_share


def test_slope_share_ignores_undefined_slopes():
    # NaN slopes (next to nodata) used to land in the steepest class via np.digitize
    s = np.array([[1.0, 3.0], [np.nan, np.nan]])
    share = slope_share(s, np.ones_like(s, dtype=bool))
    assert share["0-2"] == pytest.approx(0.5)
    assert share["2-5"] == pytest.approx(0.5)
    assert share["30-90"] == 0


def test_drainage_on_a_tilted_plane_has_no_basins():
    rows, cols = 20, 20
    dem = np.tile(np.arange(cols, 0, -1, dtype=float), (rows, 1)) * 10  # falls toward the east edge
    dx = np.full(rows, 463.0)
    stats, area, stream, basin = drainage_stats(dem, dx, 463.0, stream_km2=2.0, depression_m=20.0)
    assert stats["depression_km2"] == 0
    assert not basin.any()
    # the outlet column collects a full row of cells
    assert stats["max_upstream_km2"] == pytest.approx(cols * 463.0 * 463.0 / 1e6, abs=0.05)  # stored to 0.1 km2


def test_closed_pit_is_reported_with_true_area():
    dem = np.full((9, 9), 100.0)
    dem[3:6, 3:6] = 50.0  # 3x3 pit, 50 m deep
    dx = np.full(9, 1000.0)
    stats, *_ = drainage_stats(dem, dx, 1000.0, stream_km2=1000.0, depression_m=20.0)
    assert stats["depression_km2"] == pytest.approx(9.0)
