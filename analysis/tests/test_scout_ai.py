"""Checks for the VEX Scout AI second opinion (analog.scout_ai)."""

import json

import numpy as np

from analog import scout_ai
from analog.grid import WEB_FILE


def test_identical_place_scores_one_and_far_place_scores_low():
    ex = np.array([[0.0] * 6, [3.0] * 6, [-3.0] * 6])
    same = scout_ai.predict(np.zeros(6), ex, k=1)
    assert same["score"] == 1.0 and same["nn"] == [0]
    far = scout_ai.predict(np.full(6, 10.0), ex, k=1)
    assert far["score"] < 0.01


def test_explanation_sign_says_which_way_the_cell_differs():
    ex = np.zeros((3, 6))
    cell = np.array([2.0, 0, 0, 0, 0, -1.0])  # steeper, smaller day-night swing
    z = scout_ai.predict(cell, ex)["z"]
    assert z[0] > 1.9 and z[5] < -0.9 and abs(z[1]) < 1e-9


def test_safe_share_matches_the_web_rule():
    flat = np.zeros((16, 16))
    assert scout_ai.safe_share(flat, 217.0) == 1.0
    ramp = np.tile(np.arange(16) * 217.0, (16, 1))  # 45 deg everywhere except the clamped edges
    assert scout_ai.safe_share(ramp, 217.0) == 0.0


def test_vector_uses_log_terrain_and_climate():
    v = scout_ai.vector({"slope_deg": 5, "roughness_m": 10, "relief_m": 100},
                        {"aridity": 0.5, "dry_air": 0.6, "thermal_swing": 0.7})
    assert v == [5, 1.0, 2.0, 0.5, 0.6, 0.7]


def test_published_grid_carries_the_ai_and_hidden_sites_were_not_training_examples():
    g = json.loads(WEB_FILE.read_text(encoding="utf-8"))
    if "ai" not in g:  # grid built before the AI step
        return
    train = {e["id"] for body in ("moon", "mars") for e in g["ai"]["examples"][body]}
    for sid in ("samail_ophiolite", "umm_as_samim", "sharqiya_sands", "jebel_shams"):
        assert sid not in train
    cells = [c for c in g["cells"] if c.get("ai")]
    assert len(cells) == len(g["cells"])
    for c in cells[:20]:
        for body in ("moon", "mars"):
            a = c["ai"][body]
            assert 0 <= a["p"] <= 100 and len(a["z"]) == 6 and len(a["nn"]) == 3
