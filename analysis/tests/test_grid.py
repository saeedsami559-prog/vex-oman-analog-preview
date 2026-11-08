"""Checks for the VEX Scout country grid (analog.grid)."""

import json

import numpy as np
import pytest

from analog import grid


def test_terrarium_roundtrip_within_a_centimetre():
    h = np.array([[-50.0, 0.0, 12.34], [999.99, 2996.5, np.nan]])
    back = grid.terrarium_decode(grid.terrarium_encode(h))
    expected = np.nan_to_num(h, nan=0.0)
    assert np.allclose(back, expected, atol=0.01)


def test_km_between_known_distance():
    # Muscat to Salalah is roughly 870 km great-circle
    assert 820 < grid.km_between(grid.MUSCAT, (17.0194, 54.0897)) < 900
    assert grid.km_between((0, 0), (0, 0)) == 0


def test_cell_ids_are_unique_and_stable():
    assert grid.cell_id(23.625, 58.375) == grid.cell_id(23.625, 58.375)
    assert grid.cell_id(23.625, 58.375) != grid.cell_id(23.625, 58.625)


@pytest.mark.skipif(not grid.RAW_FILE.exists(), reason="grid not fetched yet")
def test_committed_grid_matches_the_raw_measurements():
    out = grid.score(json.loads(grid.RAW_FILE.read_text(encoding="utf-8")))
    committed = json.loads(grid.OUT_FILE.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(out))
    assert grid.WEB_FILE.read_text(encoding="utf-8") == grid.OUT_FILE.read_text(encoding="utf-8")


@pytest.mark.skipif(not grid.OUT_FILE.exists(), reason="grid not fetched yet")
def test_scores_are_bounded_and_ranked():
    out = json.loads(grid.OUT_FILE.read_text(encoding="utf-8"))
    assert len(out["cells"]) > 100
    for c in out["cells"]:
        assert c["land_frac"] >= grid.MIN_LAND
        for v in [c["mars_score"], c["moon_score"], *c["mars"].values()]:
            assert v is None or 0.0 <= v <= 1.0
    ranks = sorted(c["mars_rank"] for c in out["cells"] if c["mars_score"] is not None)
    assert ranks == list(range(1, len(ranks) + 1))
    # every Omani site is tied to its nearest cell
    assert all(s["cell"] for s in out["sites"])
