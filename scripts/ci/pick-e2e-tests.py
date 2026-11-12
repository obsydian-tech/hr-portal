#!/usr/bin/env python3
"""
Pick which app journeys a change needs, so runs stay short as the app grows.

Reads the changed file paths (one per line) on stdin and prints two lines for
GITHUB_OUTPUT:
  grep=<Playwright --grep pattern>   (empty means run every journey)
  modules=<plain words for the PR comment>

Rules:
- A change inside one module's folder runs that module's journeys (by tag).
- A change to a journey file runs every tag that file carries.
- Anything shared (core, shared, login, app setup, packages, test setup,
  this workflow) runs everything: it can break any journey.
- The @smoke journeys always run, so the basics are checked on every PR.
- Files outside the app (docs, backend, infra) add nothing.

Tags live on the test.describe of each spec, e.g. { tag: ['@onboard'] }.
To add a module: add its folder here and tag its journeys.
"""
import re
import sys
from pathlib import Path

APP = "hr-portal/src/app/features/"
FEATURE_TAGS = {
    "employee-dashboard": "@onboard",
    "hr-dashboard": "@onboard",
    "it-provisioning": "@onboard",
    "talent-flow": "@hire",
    "landing": None,  # public page, no journeys yet; smoke still runs
}
TESTS = "hr-portal/e2e/tests/"
RUN_ALL = (
    "hr-portal/src/",           # anything not matched as a feature above
    "hr-portal/e2e/",           # fixtures, config, helpers
    "hr-portal/angular.json",
    "hr-portal/package.json",
    "hr-portal/package-lock.json",
    "hr-portal/tsconfig",
    ".github/workflows/app-e2e-dev.yml",
    "scripts/ci/seed-dev.py",
    "scripts/ci/load-e2e-logins.py",
    "scripts/ci/cleanup-dev-e2e.py",
    "scripts/ci/pick-e2e-tests.py",
)
WORDS = {"@onboard": "Onboard", "@hire": "Hire", "@smoke": "smoke checks"}


def tags_in(spec: Path) -> set[str]:
    try:
        return set(re.findall(r"'(@[a-z-]+)'", spec.read_text()))
    except OSError:
        return set()  # deleted spec: nothing of its own to run


def pick(paths: list[str], root: Path = Path(".")) -> set[str] | None:
    """Tags to run, or None for everything."""
    tags = {"@smoke"}
    for p in (p.strip() for p in paths):
        if not p:
            continue
        if p.startswith(APP):
            feature = p[len(APP):].split("/", 1)[0]
            if feature in FEATURE_TAGS:
                if FEATURE_TAGS[feature]:
                    tags.add(FEATURE_TAGS[feature])
                continue
            return None
        if p.startswith(TESTS) and p.endswith(".ts"):
            found = tags_in(root / p) - {"@smoke"}
            if found:
                tags |= found
                continue
            return None  # untagged or deleted spec: be safe
        if p.startswith(RUN_ALL):
            return None
    return tags


def main() -> None:
    tags = pick(sys.stdin.read().splitlines())
    if tags is None:
        print("grep=")
        print("modules=all journeys")
        return
    print("grep=" + "|".join(sorted(tags)))
    print("modules=" + ", ".join(WORDS.get(t, t) for t in sorted(tags, key=lambda t: t == "@smoke")))


if __name__ == "__main__":
    main()
