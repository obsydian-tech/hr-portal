#!/usr/bin/env python3
"""
Pick which acceptance spec files a pull request needs, so the "Acceptance tests
(no backend)" check stays short as locked cards pile up (OPS-09).

Runs in the `plan` job of pepla-web.yml and prints lines for GITHUB_OUTPUT:
  mode=full | selected | none
  matrix=<JSON for the shard jobs: per shard its spec files (relative to pepla-web/),
          whether it needs ffmpeg and ImageMagick, whether it never opens the app>
  reason=<plain words, shown in the job summary>

Rules (anything unsure runs everything):
- Not a pull request into develop (nightly, by hand, a release PR into main): full.
- A card's own files (<card>.spec.ts, cards/<card>.md, support/<card>/) run that card.
- Any other file under pepla-web/e2e/acceptance/ (shared support, helpers one card
  imports from another, config), app-wide code (design system, styles, app shell,
  package files, environments), this workflow or this script: full.
- App code under features/, core/, dev/ or the journeys: the cards whose commits
  touched that file before, the cards this PR is for (branch, title, commit
  subjects), and every spec that runs a journey (help pictures read pages
  other cards build). A file no card ever touched: full.
- Docs (*.md, docs/, pictures and videos) run nothing; help pictures run the journey specs.
- Everything else (lambda/, api/, infra/, scripts/ci/, workflows, a path nobody
  planned for): full. Specs read all of them, so only a known-safe list is skipped.

Standard library only. Test: python3 -B scripts/ci/test_pick_acceptance_specs.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ACC = "pepla-web/e2e/acceptance/"
SPEC_DIR = "e2e/acceptance/"  # relative to pepla-web/
MAX_SHARDS = 4

# Any "<prefix>-<number>" token; which prefixes are cards comes from the spec files
# (be, onb, help, ops, and whatever comes next), not from a list here.
CARD_RE = re.compile(r"\b([a-z]{2,6})-(\d+)(?:\.\d+)?\b", re.I)
NOT_CARDS = {"nh"}  # Jira keys in commit subjects
JOURNEY_RE = re.compile(r"helpRun|runJourney")
MEDIA_RE = re.compile(r"ffmpeg|\bcompare\b")

FULL_PREFIXES = (
    "pepla-web/src/styles/",
    "pepla-web/src/environments/",
    "pepla-web/src/app/ds/",
    "pepla-web/package",
    "pepla-web/angular.json",
    "pepla-web/tsconfig",
    "pepla-web/scripts/",
    "pepla-web/public/",
    ".github/workflows/pepla-web.yml",
    ".github/workflows/acceptance-lock.yml",
    "scripts/ci/pick-acceptance-specs.py",
)
APP_PREFIXES = (
    "pepla-web/src/app/features/",
    "pepla-web/src/app/core/",
    "pepla-web/src/app/dev/",
    "pepla-web/e2e/journeys/",
    "pepla-web/e2e/support/",
    "pepla-web/e2e/fixtures/",
)


def card_of(text: str) -> set[str]:
    """Card-like keys such as onb-09 named in a text (help-02.3 counts for help-02)."""
    return {
        f"{m.group(1).lower()}-{m.group(2)}"
        for m in CARD_RE.finditer(text)
        if m.group(1).lower() not in NOT_CARDS
    }


def own_card_file(path: str) -> str | None:
    """The card a file under the acceptance folder belongs to, or None for anything else.
    Only <card>.spec.ts and cards/<card>.md are a card's own: support files are imported
    across cards (onb-09 uses onb-15's and onb-07's, ops-06 uses ops-02's)."""
    rest = path[len(ACC):]
    m = re.fullmatch(r"([a-z]+-\d+)\.spec\.ts", rest)
    if m:
        return m.group(1)
    m = re.fullmatch(r"cards/([a-z]+-\d+)(?:\.\d+)?\.md", rest)
    if m:
        return m.group(1)
    return None


DOC_SUFFIXES = (".md", ".png", ".jpg", ".jpeg", ".gif", ".webm", ".mp4", ".svg")


def pick(
    changed: list[str],
    specs: dict[str, str],  # card key -> spec text, for every spec file that exists
    touched_by: dict[str, set[str]],  # file -> cards whose commits changed it before
    own: set[str],  # cards this PR is for
    event: str = "pull_request",
    base_ref: str = "develop",
) -> tuple[str, set[str], str]:
    """Return (mode, card keys, reason). mode is full, selected or none."""
    if event != "pull_request":
        return "full", set(), f"{event or 'this trigger'} runs every spec"
    if base_ref != "develop":
        return "full", set(), f"a pull request into {base_ref} runs every spec"

    journeys = {c for c, text in specs.items() if JOURNEY_RE.search(text)}
    prefixes = {c.split("-")[0] for c in specs}
    cards: set[str] = set()
    why: list[str] = []

    for path in (p.strip() for p in changed):
        if not path:
            continue
        if path.startswith(FULL_PREFIXES):
            return "full", set(), f"{path} is shared by every card"
        if path.startswith(ACC):
            card = own_card_file(path)
            if not card:
                return "full", set(), f"{path} is shared acceptance test support"
            if card in specs:
                cards.add(card)
            else:
                # a card file whose spec is not there yet (notes only): nothing to run for it
                why.append(f"{path} has no spec")
            continue
        if path.startswith("pepla-web/help/"):
            if path.endswith(".md"):
                continue
            cards |= journeys
            why.append("help pictures")
            continue
        if path.startswith(APP_PREFIXES):
            before = touched_by.get(path)
            if not before:
                return "full", set(), f"no card has touched {path} before"
            strange = sorted(c for c in before if c.split("-")[0] not in prefixes)
            if strange:
                return "full", set(), f"{path} was touched for {strange[0]}, a kind of card with no spec here"
            cards |= {c for c in before if c in specs}
            cards |= journeys
            why.append("app code")
            continue
        if path.startswith("pepla-web/src/"):
            return "full", set(), f"{path} is app-wide code"
        if path.startswith("pepla-web/"):
            if path.endswith(".md"):
                continue
            return "full", set(), f"{path} is not one a card owns"
        if path.endswith(DOC_SUFFIXES) or path.startswith("docs/"):
            continue  # docs, pictures and videos outside the app: no spec reads them
        # lambda/, api/, infra/, scripts/ci/, workflows, anything new: specs read these
        return "full", set(), f"{path} is read by specs or is not a known-safe path"
    cards |= {c for c in own if c in specs}
    if not cards:
        return "none", set(), "only docs or files no acceptance test reads"
    return "selected", cards, ", ".join(dict.fromkeys(why)) or "the cards this change is for"


# ---------------------------------------------------------------- git side


def weight(text: str) -> int:
    """Rough minutes-ish cost of a spec: journeys with pictures and video dominate the run."""
    return 10 if JOURNEY_RE.search(text) else 1


def balance(cards: list[str], specs: dict[str, str], shards: int) -> list[list[str]]:
    """Spread specs over shards, heaviest first onto the lightest shard (Playwright's own
    --shard splits by test count, which put every journey spec in one 16 minute shard)."""
    groups: list[list[str]] = [[] for _ in range(shards)]
    load = [0] * shards
    for c in sorted(cards, key=lambda c: (-weight(specs[c]), c)):
        i = load.index(min(load))
        groups[i].append(c)
        load[i] += weight(specs[c])
    return [sorted(g) for g in groups]


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def history_map() -> dict[str, set[str]]:
    """File -> cards, from the subjects of every non-merge commit before this change."""
    out = git("log", "--no-merges", "--name-only", "--format=%x01%s", "HEAD^1" if has_two_parents() else "HEAD")
    touched: dict[str, set[str]] = {}
    for block in out.split("\x01")[1:]:
        lines = block.splitlines()
        cards = card_of(lines[0])
        if not cards:
            continue
        for f in lines[1:]:
            if f.strip():
                touched.setdefault(f.strip(), set()).update(cards)
    return touched


def has_two_parents() -> bool:
    return len(git("rev-list", "--parents", "-n", "1", "HEAD").split()) == 3


def main() -> None:
    root = Path("pepla-web")
    specs = {
        p.name[: -len(".spec.ts")]: p.read_text()
        for p in sorted((root / "e2e" / "acceptance").glob("*.spec.ts"))
    }
    event = os.environ.get("EVENT_NAME", "")
    base_ref = os.environ.get("BASE_REF", "")
    changed: list[str] = []
    own: set[str] = set()
    touched: dict[str, set[str]] = {}
    if event == "pull_request":
        if has_two_parents():
            changed = git("diff", "--name-only", "HEAD^1", "HEAD").splitlines()
            subjects = git("log", "--no-merges", "--format=%s", "HEAD^1..HEAD^2")
        else:
            changed = git("diff", "--name-only", os.environ["BASE_SHA"], "HEAD").splitlines()
            subjects = git("log", "--no-merges", "--format=%s", f"{os.environ['BASE_SHA']}..HEAD")
        own = card_of(os.environ.get("PR_TITLE", "") + "\n" + os.environ.get("HEAD_REF", "") + "\n" + subjects)
        touched = history_map()
    mode, cards, reason = pick(changed, specs, touched, own, event, base_ref)

    chosen = sorted(cards) if mode == "selected" else sorted(specs)
    n = 0 if mode == "none" else min(MAX_SHARDS, len(chosen))
    groups = balance(chosen, specs, n)
    matrix = {
        "include": [
            {
                "shard": i + 1,
                "of": n,
                "specs": " ".join(f"{SPEC_DIR}{c}.spec.ts" for c in g),
                "media": str(any(MEDIA_RE.search(specs[c]) for c in g)).lower(),
                "infra_only": str(all(c.startswith(("be-", "ops-")) for c in g)).lower(),
            }
            for i, g in enumerate(groups)
        ]
    }
    out = {"mode": mode, "matrix": json.dumps(matrix), "reason": reason}
    for g in groups:
        print("shard:", " ".join(g), file=sys.stderr)
    for k, v in out.items():
        print(f"{k}={v}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        names = ", ".join(sorted(cards)) if mode == "selected" else mode
        Path(summary).open("a").write(f"Acceptance specs: **{mode}** ({names}). Why: {reason}.\n")


if __name__ == "__main__":
    sys.exit(main())
