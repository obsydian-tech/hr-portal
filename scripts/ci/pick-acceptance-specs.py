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

- Rule A (step 5): on a pull request into develop that touches nothing the public site
  tests read (SITE list below, checked by touches_site), no site-NN spec runs, whatever
  else was chosen. The card's own site spec still runs. If such a change edits a file
  under pepla-web/src/, site-01 and site-07 still run as light site checks.
- Timing list: the nightly run uploads fresh per-spec seconds as an artifact; a pull
  request run downloads it (TIMING_FILE) and uses it when it is under 7 days old, else
  the committed acceptance-spec-seconds.json. It only shares work between groups.

Standard library only. Test: python3 -B scripts/ci/test_pick_acceptance_specs.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

ACC = "pepla-web/e2e/acceptance/"
SPEC_DIR = "e2e/acceptance/"  # relative to pepla-web/
MAX_SHARDS = 6
# Measured seconds per spec file (both widths). Fallback copy, refreshed by hand; a fresh
# one comes from the nightly run (TIMING_FILE). A spec missing from both gets a guess (below).
SECONDS_FILE = Path(__file__).with_name("acceptance-spec-seconds.json")
# 26 specs were missing from the list on 20 Nov and took about 2.7 minutes each.
DEFAULT_SECONDS = 180
TIMING_MAX_AGE = timedelta(days=7)
DEFAULT_JOURNEY_SECONDS = 600

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
    site: tuple[set[str], Callable[[str], str | None]] | None = None,  # (site chain, file reader); None = rule A off
) -> tuple[str, set[str], str]:
    """Return (mode, card keys, reason). mode is full, selected or none. With `site` given,
    rule A then leaves the site specs out of a pull request into develop that does not touch
    the site (a reduced "everything" is reported as selected, the judge treats both alike)."""
    mode, cards, reason = pick_base(changed, specs, touched_by, own, event, base_ref)
    if site is None or event != "pull_request" or base_ref != "develop":
        return mode, cards, reason
    return apply_site_rule(mode, cards, reason, changed, specs, own, site[0], site[1])


def pick_base(
    changed: list[str],
    specs: dict[str, str],
    touched_by: dict[str, set[str]],
    own: set[str],
    event: str = "pull_request",
    base_ref: str = "develop",
) -> tuple[str, set[str], str]:
    """Today's rules, before rule A."""
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


# ---------------------------------------------------------------- rule A: the public site

SITE_CARD_RE = re.compile(r"site-\d+$")
APP = "pepla-web/src/"
SITE_START = (
    "pepla-web/src/app/ds/site/gallery.page.ts",
    "pepla-web/src/app/ds/site/landing.gallery.ts",
    "pepla-web/src/app/ds/site/learn/learn.gallery.ts",
    "pepla-web/src/app/ds/site/landing.page.ts",
    "pepla-web/src/app/features/public/public-page.ts",
)
SITE_PREFIXES = (  # S1, S3, S5, S6
    "pepla-web/src/app/ds/site/",
    "pepla-web/src/app/features/public/",
    "pepla-web/src/styles/",
    "pepla-web/scripts/",
    "pepla-web/public/",
    "pepla-web/e2e/parity/",
    "pepla-web/src/environments/",  # S4
)
SITE_FILES = (  # S3, S5, S9
    "pepla-web/src/styles.css",
    "pepla-web/package.json",
    "pepla-web/package-lock.json",
    "pepla-web/angular.json",
    "pepla-web/src/index.html",
    "pepla-web/src/polyfills.ts",
    "pepla-web/src/app/dev/design-system.page.ts",  # site-02 AC-12 opens /dev/design-system
    ACC + "playwright.config.ts",
    ".github/workflows/pepla-web.yml",
    ".github/workflows/acceptance-lock.yml",
    "scripts/ci/pick-acceptance-specs.py",
    "scripts/ci/test_pick_acceptance_specs.py",
)
# S10. site-02 AC-12 also looks for ppSite and for a short path import ('../site'), so those count.
SITE_WORDS = re.compile(r"ds/site|pp-site|PpSite|ppSite|DemoClock|site\.css|from\s+['\"]\.{1,2}/site['/\"]")
# Known to be read by no site test (spec section 3, "not on the list"). Anything else is S11.
NOT_SITE = (
    "lambda/", "api/", "infra/", "talent-flow-infra/", "bootstrap/", "mcp/", "scripts/", ".github/", "docs/",
    "pepla-web/src/app/features/", "pepla-web/src/app/core/", "pepla-web/src/app/dev/", "pepla-web/src/app/ds/",
    "pepla-web/e2e/journeys/", "pepla-web/e2e/support/", "pepla-web/e2e/fixtures/", "pepla-web/help/",
    ACC,
)
IMPORT_RE = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*|\b(?:templateUrl|styleUrls?)\s*:\s*\[?\s*)['"](\.{1,2}/[^'"]*)['"]"""
)


def follow_imports(start: list[str], read: Callable[[str], str | None], exists: Callable[[str], bool]) -> set[str]:
    """Every file reachable from `start` by relative imports (./ and ../ only; path aliases
    are not followed, a test fails if tsconfig gains one). Paths are repo-relative."""
    seen: set[str] = set()
    todo = [p for p in start if exists(p)]
    while todo:
        path = todo.pop()
        if path in seen:
            continue
        seen.add(path)
        if not path.endswith((".ts", ".js", ".mjs", ".mts")):
            continue
        text = read(path) or ""
        for rel in IMPORT_RE.findall(text):
            base = os.path.normpath(os.path.join(os.path.dirname(path), rel)).replace(os.sep, "/")
            for cand in (base, base + ".ts", base + "/index.ts", base + ".js", base + ".mjs"):
                if exists(cand):
                    todo.append(cand)
                    break
    return seen


def site_chain(site_specs: list[str], read, exists) -> set[str]:
    """S2 and S8: the app files the site pages import, and the test files the site specs import."""
    app = follow_imports(list(SITE_START), read, exists)
    tests = follow_imports([f"{ACC}{c}.spec.ts" for c in site_specs], read, exists)
    return app | tests


def touches_site(changed: list[str], chain: set[str], read: Callable[[str], str | None], specs: dict[str, str]) -> str | None:
    """None when no changed file is one a site test reads, else a plain reason naming the file.
    When unsure, it touches the site (S11)."""
    for path in (p.strip() for p in changed):
        if not path:
            continue
        if path in chain or path in SITE_FILES or path.startswith(SITE_PREFIXES):
            return f"{path} is read by the site tests"
        if path.startswith(ACC):
            rest = path[len(ACC):]
            m = re.match(r"(?:cards/)?(?:support/)?(site-\d+)", rest)
            if m:
                return f"{path} is a site test file"
        if re.fullmatch(r"pepla-web/src/[^/]+\.ts", path) or re.fullmatch(r"pepla-web/src/app/[^/]+\.ts", path):
            return f"{path} is app set-up or routes, read by the site tests"  # S4
        if path.endswith(DOC_SUFFIXES) and not path.startswith(APP):
            continue
        if path == "pepla-web/src/app/ds/all.ts" and re.search("site", read(path) or "site", re.I):
            # site-02 AC-12 fails if the gallery list mentions "site" in any case (PpComposite does)
            return f"{path} now has the word site in it"
        if path.startswith(APP):
            text = read(path)
            if text is None:
                return f"{path} was deleted or cannot be read"
            if SITE_WORDS.search(text):
                return f"{path} now mentions the public site code"
            if path.startswith(NOT_SITE):
                continue
            return f"{path} is a path nobody placed"  # S11
        if path.startswith(NOT_SITE):
            continue
        if path.startswith("pepla-web/") and path.endswith(".md"):
            continue
        return f"{path} is a path nobody placed"
    return None


def apply_site_rule(
    mode: str, cards: set[str], reason: str, changed: list[str], specs: dict[str, str], own: set[str],
    chain: set[str], read: Callable[[str], str | None],
) -> tuple[str, set[str], str]:
    """Rule A: leave the site specs out when nothing the site reads changed."""
    if mode == "none":
        return mode, cards, reason
    site = {c for c in specs if SITE_CARD_RE.fullmatch(c)}
    if not site or touches_site(changed, chain, read, specs):
        return mode, cards, reason
    light = {"site-01", "site-07"} & site if any(p.strip().startswith(APP) for p in changed) else set()
    drop = site - {c for c in own if c in site} - light
    base = set(specs) if mode == "full" else set(cards)
    kept = (base - drop) | light
    if kept == base:
        return mode, cards, reason
    note = "site tests left out: this change touches no file the site tests read"
    if light:
        note += " (site-01 and site-07 still run as light checks)"
    if not kept:
        return "none", set(), f"{reason}; {note}"
    return "selected", kept, f"{reason}; {note}"


# ---------------------------------------------------------------- git side


def read_seconds(path: Path) -> dict[str, float]:
    """{card: seconds} from a timing file; raises on a missing or broken file."""
    raw = json.loads(path.read_text())["seconds"]
    return {k[: -len(".spec.ts")]: float(v) for k, v in raw.items() if k.endswith(".spec.ts")}


def load_timing(
    fresh: Path | None = None, now: datetime | None = None, committed: Path | None = None
) -> tuple[dict[str, float], str]:
    """Seconds per spec, keyed by card (site-08), and a plain sentence on where they came from.
    The nightly run's file (fresh) replaces the committed list file by file when it is under
    7 days old. Missing, old or broken: the committed list, and the sentence says so."""
    try:
        base = read_seconds(committed or SECONDS_FILE)
    except (OSError, ValueError, KeyError):
        base = {}
    if fresh is None:
        return base, "Timing list: the committed file (no nightly file was offered)."
    now = now or datetime.now(timezone.utc)
    try:
        data = json.loads(fresh.read_text())
        made = datetime.fromisoformat(str(data["generated"]).replace("Z", "+00:00"))
        if made.tzinfo is None:
            made = made.replace(tzinfo=timezone.utc)
        new = read_seconds(fresh)
        if not new:
            raise ValueError("empty")
    except (OSError, ValueError, KeyError, TypeError):
        return base, "Timing list: the committed file (the nightly file was missing or could not be read)."
    if now - made > TIMING_MAX_AGE:
        return base, "Timing list: the committed file (the nightly file is more than 7 days old)."
    return {**base, **new}, f"Timing list: the nightly file of {made:%d %b %Y}, {len(new)} specs."


def load_seconds() -> dict[str, float]:
    """The committed list only, keyed by card."""
    try:
        return read_seconds(SECONDS_FILE)
    except (OSError, ValueError, KeyError):
        return {}


def weight(card: str, text: str, seconds: dict[str, float]) -> float:
    """Measured seconds for a spec. Unknown specs: 10 minutes for a journey (helpRun or
    runJourney: pictures and video), 1 minute for the rest."""
    if card in seconds:
        return seconds[card]
    return DEFAULT_JOURNEY_SECONDS if JOURNEY_RE.search(text) else DEFAULT_SECONDS


def balance(
    cards: list[str], specs: dict[str, str], shards: int, seconds: dict[str, float] | None = None
) -> list[list[str]]:
    """Spread specs over shards by measured time, heaviest first onto the lightest shard
    (Playwright's own --shard splits by test count, and a weight of 1 per spec put site-04
    and help-04, 38 minutes together, in one shard)."""
    seconds = seconds if seconds is not None else {}
    groups: list[list[str]] = [[] for _ in range(shards)]
    load = [0.0] * shards
    w = {c: weight(c, specs[c], seconds) for c in cards}
    for c in sorted(cards, key=lambda c: (-w[c], c)):
        i = load.index(min(load))
        groups[i].append(c)
        load[i] += w[c]
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
    site = None
    if event == "pull_request":
        def read(path: str) -> str | None:
            try:
                return Path(path).read_text(errors="replace")
            except OSError:
                return None

        site_specs = sorted(c for c in specs if SITE_CARD_RE.fullmatch(c))
        site = (site_chain(site_specs, read, lambda p: Path(p).is_file()), read)
    mode, cards, reason = pick(changed, specs, touched, own, event, base_ref, site)

    chosen = sorted(cards) if mode == "selected" else sorted(specs)
    n = 0 if mode == "none" else min(MAX_SHARDS, len(chosen))
    fresh = os.environ.get("TIMING_FILE")
    seconds, timing_note = load_timing(Path(fresh) if fresh else None)
    groups = balance(chosen, specs, n, seconds)
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
        print(
            f"shard: {sum(weight(c, specs[c], seconds) for c in g) / 60:.1f} min est:",
            " ".join(g),
            file=sys.stderr,
        )
    for k, v in out.items():
        print(f"{k}={v}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        left = sorted(set(specs) - set(chosen)) if mode != "none" else []
        names = mode if len(cards) > 20 else (", ".join(sorted(cards)) if mode == "selected" else mode)
        text = f"Acceptance specs: **{mode}** ({names}). Why: {reason}.\n"
        if left and mode == "selected" and len(cards) > 20:
            text += f"Left out: {', '.join(left)}.\n"
        Path(summary).open("a").write(text + timing_note + "\n")


if __name__ == "__main__":
    sys.exit(main())
