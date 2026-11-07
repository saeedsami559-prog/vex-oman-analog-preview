"""Honesty checks on the exported dataset: every number has provenance, every gap has a reason."""

import json
from pathlib import Path

import pytest
import yaml

from analog import CONFIG_DIR
from analog.export import OUT_FILE, WEB_FILE, load_config
from analog.provenance import REASON_CODES, REQUIRED_PROVENANCE

FEATURES = [f for c in load_config()["criteria"].values() for f in c["features"]]


@pytest.fixture(scope="module", params=[OUT_FILE, WEB_FILE], ids=["data", "web"])
def dataset(request):
    path: Path = request.param
    if not path.exists():
        pytest.skip("run `python -m analog.export` first")
    return json.loads(path.read_text(encoding="utf-8"))


def _sites(data):
    return data["earth_sites"] + data["targets"]


def test_every_non_null_metric_has_provenance(dataset):
    for s in _sites(dataset):
        for f in FEATURES:
            if s["raw"][f] is None:
                continue
            prov = s["provenance"].get(f)
            assert prov, f"{s['id']}.{f} has a value but no provenance"
            for key in REQUIRED_PROVENANCE:
                assert key in prov and prov[key] not in ("", None), f"{s['id']}.{f} provenance lacks {key}"
            assert prov["products"] or prov["urls"], f"{s['id']}.{f} has no product ID or URL"


def test_every_null_metric_has_a_reason(dataset):
    for s in _sites(dataset):
        reasons = {m["feature"]: m for m in s["missing"]}
        for f in FEATURES:
            if s["raw"][f] is not None:
                assert f not in reasons, f"{s['id']}.{f} is both measured and missing"
                continue
            m = reasons.get(f)
            assert m, f"{s['id']}.{f} is null without a reason"
            assert m["reason_code"] in REASON_CODES
            assert m["status"] in ("unavailable", "not_applicable")
            for key in ("reason_en", "reason_ar", "needed", "needed_ar"):
                assert m.get(key, "").strip(), f"{s['id']}.{f} missing '{key}'"


def test_moon_minerals_and_surface_are_not_applicable(dataset):
    for s in _sites(dataset):
        if s["body"] != "moon":
            continue
        codes = {m["feature"]: m["reason_code"] for m in s["missing"]}
        for f in ("serpentine_index", "carbonate_index", "chloride_index", "albedo", "thermal_inertia"):
            assert codes[f] == "not_applicable"


def test_no_global_provisional_flag(dataset):
    assert "provisional" not in dataset and "measured_share" not in dataset
    assert all("provisional" not in s for s in _sites(dataset))


def test_configs_hold_no_metric_values():
    for name in ("earth_sites.yaml", "target_sites.yaml"):
        text = (CONFIG_DIR / name).read_text(encoding="utf-8")
        assert "provisional_metrics" not in text
        for site in yaml.safe_load(text)["sites"]:
            keys = set(site)
            assert not keys & set(FEATURES), f"{site['id']} has a hand-written metric"
            assert not keys & {"resolution_m", "sources"}, f"{site['id']} has hand-written datasets/resolutions"
