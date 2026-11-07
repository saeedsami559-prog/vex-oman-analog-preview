"""Checks for the NASA POWER environment summary (analog.environment)."""

import json

from analog import environment as env


def test_coolest_window_wraps_the_year():
    t = [10, 12, 20, 25, 30, 35, 36, 34, 28, 22, 15, 11]
    assert env.coolest_window(t) == [11, 0, 1]  # Dec, Jan, Feb


def test_coolest_window_inside_the_year():
    t = [30, 30, 30, 5, 5, 5, 30, 30, 30, 30, 30, 30]
    assert env.coolest_window(t) == [3, 4, 5]


def test_build_reads_every_raw_file_unchanged():
    out = env.build()
    ids = [s["id"] for s in out["sites"]]
    assert ids == env.SCORED + env.CANDIDATES
    for s in out["sites"]:
        raw = json.loads((env.RAW_DIR / f"{s['id']}.json").read_text(encoding="utf-8"))
        p = raw["properties"]["parameter"]
        for name in env.PARAMETERS:
            assert s["monthly"][name] == [p[name][m] for m in env.MONTHS]
            assert s["annual"][name] == p[name]["ANN"]
        assert s["cell_elevation_m"] == raw["geometry"]["coordinates"][2]
        assert s["derived"]["precip_mm_per_year"] == round(p["PRECTOTCORR"]["ANN"] * 365)


def test_committed_output_is_up_to_date():
    committed = json.loads(env.OUT_FILE.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(env.build()))
    assert env.WEB_FILE.read_text(encoding="utf-8") == env.OUT_FILE.read_text(encoding="utf-8")
