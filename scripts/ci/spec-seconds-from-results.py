#!/usr/bin/env python3
"""Add up Playwright seconds per acceptance spec file, for the timing list (step 5).

  spec-seconds-from-results.py shard <results.json> <out.json>   one shard's file
  spec-seconds-from-results.py merge <dir> <out.json>            join every shard's file in <dir>

The nightly run uploads the joined file as the `acceptance-spec-seconds` artifact; pull
request runs read it (pick-acceptance-specs.py, TIMING_FILE) to share specs between the six
groups. It only decides how work is shared, never which specs run. Nothing is committed.
Standard library only. Test: python3 -B scripts/ci/test_spec_seconds_from_results.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def spec_seconds(results: dict) -> dict[str, float]:
    """Seconds per spec file name (site-01.spec.ts), over both widths and every attempt."""
    totals: dict[str, float] = {}

    def walk(suite: dict, file: str) -> None:
        file = suite.get("file") or file
        for spec in suite.get("specs", []):
            name = Path(spec.get("file") or file or "").name
            for test in spec.get("tests", []):
                for res in test.get("results", []):
                    if name:
                        totals[name] = totals.get(name, 0.0) + float(res.get("duration", 0)) / 1000
        for sub in suite.get("suites", []):
            walk(sub, file)

    for top in results.get("suites", []):
        walk(top, top.get("file") or top.get("title") or "")
    return {k: round(v, 1) for k, v in sorted(totals.items()) if k.endswith(".spec.ts")}


def shard_file(results_path: Path) -> dict:
    return {"generated": datetime.now(timezone.utc).isoformat(), "seconds": spec_seconds(json.loads(results_path.read_text()))}


def merge(files: list[dict], source: str = "nightly run on develop") -> dict:
    seconds: dict[str, float] = {}
    for f in files:
        for k, v in f.get("seconds", {}).items():
            seconds[k] = round(seconds.get(k, 0.0) + float(v), 1)
    return {
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": f"{source}, summed test seconds per spec file, both widths",
        "seconds": dict(sorted(seconds.items())),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[1] not in ("shard", "merge"):
        print(__doc__)
        return 2
    src, out = Path(argv[2]), Path(argv[3])
    if argv[1] == "shard":
        if not src.is_file():
            print("no results file: nothing to add up")
            return 0
        out.write_text(json.dumps(shard_file(src)))
    else:
        files = [json.loads(p.read_text()) for p in sorted(src.rglob("*.json"))]
        if not files:
            print("no shard files: nothing to join")
            return 0
        out.write_text(json.dumps(merge(files), indent=1))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
