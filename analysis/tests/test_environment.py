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
    assert ids[: len(env.SCORED + env.CANDIDATES)] == env.SCORED + env.CANDIDATES
    assert set(ids[len(env.SCORED + env.CANDIDATES):]) <= set(env.benchmark_ids())
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


def test_env_index_limits():
    # a site with no rain, bone-dry air and a 20 C+ daily swing reaches 1; a wet, humid, mild one 0
    assert env.env_index(0, 0, 25)["index"] == 1.0
    assert env.env_index(800, 100, 0)["index"] == 0.0
    mid = env.env_index(125, 50, 10)
    assert mid["aridity"] == 0.5 and mid["dry_air"] == 0.5 and mid["thermal_swing"] == 0.5 and mid["index"] == 0.5


def test_env_index_matches_the_published_values():
    for s in env.build()["sites"]:
        a = s["annual"]
        assert s["derived"]["env_index"] == env.env_index(a["PRECTOTCORR"] * 365, a["RH2M"], a["T2M_RANGE"])
