"""Python side of the Python <-> TypeScript parity check.

`python -m analog.export` writes fixtures/parity_cases.json; this test re-runs every case
through similarity.py, and web/src/lib/similarity.test.ts runs the same cases through
similarity.ts. If either implementation drifts, one of the two suites fails.
"""

import json
from pathlib import Path

import pytest

from analog.similarity import similarity

FIXTURE = Path(__file__).parent / "fixtures" / "parity_cases.json"


@pytest.mark.skipif(not FIXTURE.exists(), reason="run `python -m analog.export` first")
def test_python_matches_fixtures():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert data["cases"], "no parity cases"
    for case in data["cases"]:
        got = similarity(case["raw_a"], case["raw_b"], case["res_a"], case["res_b"], data["config"], case["weights"],
                         case.get("body_a"), case.get("body_b"))
        exp = case["expected"]
        for key in ("overall", "confidence", "coverage", "resolution_factor"):
            if exp[key] is None:
                assert got[key] is None
            else:
                assert got[key] == pytest.approx(exp[key], abs=1e-12), (case["earth"], case["target"], key)
