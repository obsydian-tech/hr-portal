#!/usr/bin/env python3
"""
Does "Deploy Lambdas" start for this push to develop? Prints true or false.

"App tests on dev" calls this on a push to develop. When Deploy Lambdas starts
for the same commit, it tests the commit itself after deploying the Lambda code
to pepla-dev, so "App tests on dev" steps aside instead of testing it twice.

Usage: deploy-covers-commit.py <commit before the push> <commit after the push>

The answer comes from the push paths in deploy-lambdas.yml, read with GitHub's
rules (patterns in order, a later "!pattern" removes earlier matches), so the
two workflows cannot drift apart. If the changed files cannot be listed, it
prints false: a run that happens twice is better than one that never happens.
"""
import re
import subprocess
import sys
from pathlib import Path

import yaml  # on every GitHub runner

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "deploy-lambdas.yml"


def glob_to_regex(glob: str) -> re.Pattern:
    out, i = "", 0
    while i < len(glob):
        c = glob[i]
        if c == "*":
            if glob[i + 1:i + 2] == "*":
                slash = glob[i + 2:i + 3] == "/"
                out += "(?:.*/)?" if slash else ".*"
                i += 2 if slash else 1
            else:
                out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        else:
            out += re.escape(c)
        i += 1
    return re.compile(f"^{out}$")


def picked(path: str, patterns: list[str]) -> bool:
    hit = False
    for p in patterns:
        negative = p.startswith("!")
        if glob_to_regex(p[1:] if negative else p).match(path):
            hit = not negative
    return hit


def main() -> None:
    before, after = sys.argv[1], sys.argv[2]
    doc = yaml.safe_load(WORKFLOW.read_text())
    on = doc.get("on", doc.get(True))
    patterns = on["push"]["paths"]
    if re.fullmatch("0+", before):
        print("false")  # no earlier commit to compare with: let the tests run
        return
    diff = subprocess.run(["git", "diff", "--name-only", f"{before}..{after}"], capture_output=True, text=True)
    if diff.returncode != 0:
        print("false")
        return
    print("true" if any(picked(f, patterns) for f in diff.stdout.splitlines() if f) else "false")


if __name__ == "__main__":
    main()
