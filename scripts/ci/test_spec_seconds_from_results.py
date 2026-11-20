#!/usr/bin/env python3
"""Tests for spec-seconds-from-results.py. Run: python3 -B scripts/ci/test_spec_seconds_from_results.py"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("secs", Path(__file__).with_name("spec-seconds-from-results.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def result(ms):
    return {"results": [{"duration": ms}]}


RESULTS = {
    "suites": [
        {"title": "site-01.spec.ts", "file": "site-01.spec.ts", "specs": [], "suites": [
            {"title": "Site", "specs": [
                {"title": "AC-1", "file": "site-01.spec.ts", "tests": [result(1500), result(2500)]},
            ]},
        ]},
        {"title": "onb-09.spec.ts", "file": "onb-09.spec.ts", "specs": [
            {"title": "AC-1", "file": "onb-09.spec.ts", "tests": [{"results": [{"duration": 1000}, {"duration": 500}]}]},
        ]},
    ]
}


class Secs(unittest.TestCase):
    def test_adds_up_both_widths_and_every_attempt(self):
        self.assertEqual(m.spec_seconds(RESULTS), {"onb-09.spec.ts": 1.5, "site-01.spec.ts": 4.0})

    def test_empty_results(self):
        self.assertEqual(m.spec_seconds({}), {})

    def test_merge_adds_shards(self):
        a = {"seconds": {"a.spec.ts": 10.0, "b.spec.ts": 5.0}}
        b = {"seconds": {"b.spec.ts": 1.5}}
        out = m.merge([a, b])
        self.assertEqual(out["seconds"], {"a.spec.ts": 10.0, "b.spec.ts": 6.5})
        self.assertIn("generated", out)

    def test_files_in_and_out(self):
        d = Path(tempfile.mkdtemp())
        (d / "results.json").write_text(json.dumps(RESULTS))
        self.assertEqual(m.main(["x", "shard", str(d / "results.json"), str(d / "s1.json")]), 0)
        (d / "shards").mkdir()
        (d / "s1.json").rename(d / "shards" / "s1.json")
        self.assertEqual(m.main(["x", "merge", str(d / "shards"), str(d / "all.json")]), 0)
        data = json.loads((d / "all.json").read_text())
        self.assertEqual(data["seconds"]["site-01.spec.ts"], 4.0)

    def test_missing_results_file_does_not_fail(self):
        d = Path(tempfile.mkdtemp())
        self.assertEqual(m.main(["x", "shard", str(d / "none.json"), str(d / "o.json")]), 0)
        self.assertFalse((d / "o.json").exists())


if __name__ == "__main__":
    unittest.main()
