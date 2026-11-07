

def test_benchmarks_do_not_change_omani_scores():
    """Candidate/benchmark sites are scored on the fixed scale and never move an Omani score."""
    from analog import export

    full = export.build()
    base = export.load_config()
    earth = export.prepare_sites(export.load_yaml("earth_sites.yaml")["sites"], base, body="earth")
    targets = export.prepare_sites(export.load_yaml("target_sites.yaml")["sites"], base)
    config = export.scoring_config(base, earth + targets)
    assert full["scores"] == export.score_pairs(earth, targets, config)
    bench_ids = {s["id"] for s in full["benchmarks"]}
    assert bench_ids.isdisjoint({s["id"] for s in full["earth_sites"]})
    assert set(full["validation"]["ranking"]) <= {s["id"] for s in full["earth_sites"]}
    assert {s["earth"] for s in full["benchmark_scores"]} == bench_ids
