#!/usr/bin/env python3
"""Tests for pick-acceptance-specs.py. Run: python3 -B scripts/ci/test_pick_acceptance_specs.py"""
import importlib.util
import json
import os
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("pick", Path(__file__).with_name("pick-acceptance-specs.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

SPECS = {
    "onb-02": "runJourney ffmpeg",
    "onb-09": "page.goto",
    "onb-13": "page.goto",
    "help-02": "helpRun compare",
    "ops-05": "readFileSync",
    "be-16": "readFileSync",
}
HR = "pepla-web/src/app/features/hr/employee-page.ts"
TOUCHED = {HR: {"onb-09", "onb-13", "help-02"}, "pepla-web/src/app/core/auth/auth.ts": {"onb-01"}}
A = "pepla-web/e2e/acceptance/"


def run(changed, own=(), event="pull_request", base="develop"):
    return m.pick(changed, SPECS, TOUCHED, set(own), event, base)


class Pick(unittest.TestCase):
    def test_other_triggers_run_everything(self):
        self.assertEqual(run([], event="schedule")[0], "full")
        self.assertEqual(run([], event="push")[0], "full")
        self.assertEqual(run([HR], base="main")[0], "full")

    def test_shared_files_run_everything(self):
        for f in ("pepla-web/src/app/ds/status/pill.ts", "pepla-web/package.json", ".github/workflows/pepla-web.yml",
                  A + "support/fixtures.ts", A + "playwright.config.ts", "pepla-web/src/app/app.routes.ts"):
            self.assertEqual(run([f])[0], "full", f)

    def test_unknown_app_file_runs_everything(self):
        self.assertEqual(run(["pepla-web/src/app/features/hr/brand-new.ts"])[0], "full")

    def test_app_file_runs_sharing_cards_and_journeys(self):
        mode, cards, _ = run([HR], own=["onb-13"])
        self.assertEqual((mode, cards), ("selected", {"onb-09", "onb-13", "help-02", "onb-02"}))

    def test_own_card_files_run_that_card_only(self):
        mode, cards, _ = run([A + "onb-09.spec.ts", A + "cards/onb-09.md"])
        self.assertEqual((mode, cards), ("selected", {"onb-09"}))
        self.assertEqual(run([A + "cards/help-02.3.md"])[1], {"help-02"})
        self.assertEqual(run([A + "support/onb-09/a.ts"])[0], "full")

    def test_unknown_paths_run_everything(self):
        for f in ("lambda/getEmployees/index.mjs", "api/openapi.yaml", "infra/main.tf", "scripts/ci/seed-dev.py",
                  ".github/workflows/terraform-apply.yml", "mcp/server.py", "Dockerfile"):
            self.assertEqual(run([f])[0], "full", f)
        self.assertEqual(run([HR, "lambda/getEmployees/index.mjs"], own=["onb-13"])[0], "full")

    def test_support_files_run_everything(self):
        for f in (A + "support/onb-15/lambda-harness.ts", A + "support/ops-02-workflows.ts", A + "support/help-03.ts"):
            self.assertEqual(run([f])[0], "full", f)

    def test_a_new_kind_of_card_is_never_skipped(self):
        touched = {**TOUCHED, HR: {"onb-09", "adm-01"}}  # adm-01 touched this file, no adm spec yet
        self.assertEqual(m.pick([HR], SPECS, touched, set())[0], "full")
        specs = {**SPECS, "adm-01": "page.goto"}
        mode, cards, _ = m.pick([HR], specs, touched, set())
        self.assertEqual((mode, "adm-01" in cards), ("selected", True))
        self.assertEqual(m.pick([A + "adm-01.spec.ts"], specs, TOUCHED, set())[1], {"adm-01"})

    def test_jira_keys_are_not_cards(self):
        self.assertEqual(m.card_of("feat(onb-09): x (NH-166)"), {"onb-09"})

    def test_docs_run_nothing(self):
        self.assertEqual(run(["pepla-web/README.md", "docs/a.md"])[0], "none")

    def test_help_pictures_run_journey_specs(self):
        self.assertEqual(run(["pepla-web/help/media/desktop/a.png"])[1], {"onb-02", "help-02"})

    def test_card_keys(self):
        self.assertEqual(m.card_of("feat(help-02.3): x (NH-166) and ONB-09"), {"help-02", "onb-09"})



class Balance(unittest.TestCase):
    def test_journey_specs_do_not_share_a_shard(self):
        specs = {"help-01": "helpRun", "help-02": "helpRun", "help-03": "runJourney", "onb-02": "runJourney",
                 "onb-09": "x", "onb-13": "x", "ops-05": "x", "be-16": "x"}
        groups = m.balance(sorted(specs), specs, 4)
        self.assertEqual(len(groups), 4)
        for g in groups:
            self.assertLessEqual(sum(1 for c in g if m.JOURNEY_RE.search(specs[c])), 1)
        self.assertEqual(sorted(c for g in groups for c in g), sorted(specs))

    def test_balances_by_measured_seconds(self):
        specs = {c: "x" for c in ("big-1", "big-2", "mid-1", "mid-2", "small-1", "small-2")}
        seconds = {"big-1": 1400, "big-2": 1300, "mid-1": 700, "mid-2": 600, "small-1": 100, "small-2": 50}
        groups = m.balance(sorted(specs), specs, 2, seconds)
        loads = sorted(sum(seconds[c] for c in g) for g in groups)
        self.assertLessEqual(loads[1] - loads[0], 100)
        self.assertEqual(sorted(c for g in groups for c in g), sorted(specs))

    def test_unknown_spec_gets_a_guess(self):
        self.assertEqual(m.weight("new-1", "x", {}), m.DEFAULT_SECONDS)
        self.assertEqual(m.weight("new-2", "runJourney", {}), m.DEFAULT_JOURNEY_SECONDS)

    def test_real_file_covers_every_spec_and_seven_shards_stay_under_37_minutes(self):
        import pathlib
        specs = {p.name[: -len(".spec.ts")]: p.read_text()
                 for p in pathlib.Path("pepla-web/e2e/acceptance").glob("*.spec.ts")}
        seconds = m.load_seconds()
        self.assertTrue(seconds, "acceptance-spec-seconds.json did not load")
        groups = m.balance(sorted(specs), specs, m.MAX_SHARDS, seconds)
        self.assertEqual(len(groups), 7)
        self.assertEqual(sorted(c for g in groups for c in g), sorted(specs))
        # The total passed 6 x 40 minutes on 26 Nov (INT-01 and the REC-UI specs), so a better split could not help: a seventh
        # shard. 37 minutes: the split is already even (every shard within 3 seconds), but 30 newer specs (INT, REC-06, REC-16, REC-UI) are not in the committed list and count 3 or 10 minutes each, so the total reached 2196s a shard on 26 Nov. A spec missing from the list counts 3 minutes.
        self.assertLess(max(sum(m.weight(c, specs[c], seconds) for c in g) for g in groups), 37 * 60)

# ---------------------------------------------------------------- step 5: rule A (public site)

import json
import tempfile
from datetime import datetime, timedelta, timezone

SITE_SPECS = {**SPECS, **{f"site-{n:02d}": "page.goto" for n in (1, 2, 3, 4, 7, 8, 9, 10, 11)}}
CHAIN = {
    "pepla-web/src/app/ds/core/icon.ts",
    "pepla-web/e2e/acceptance/support/fixtures.ts",
    "pepla-web/e2e/acceptance/support/cognito-fake.ts",
}
SITE_IDS = {c for c in SITE_SPECS if c.startswith("site-")}
LIGHT = {"site-01", "site-07"}


def texts(**kw):
    return lambda path: kw.get(path, "export const x = 1;")


def run_a(changed, own=(), base="develop", event="pull_request", read=None, specs=None, touched=None):
    return m.pick(changed, specs or SITE_SPECS, touched if touched is not None else TOUCHED, set(own), event, base,
                  (CHAIN, read or texts()))


def site_cards(result):
    mode, cards, _ = result
    return set(SITE_SPECS) & SITE_IDS if mode == "full" else cards & SITE_IDS


class RuleASiteTouched(unittest.TestCase):
    """One case per line S1 to S11 of the spec: a change to only that file runs the site specs."""

    def runs_site(self, path, **kw):
        res = run_a([path], **kw)
        self.assertEqual(site_cards(res), SITE_IDS, f"{path}: {res}")

    def test_S1_site_pages(self):
        self.runs_site("pepla-web/src/app/ds/site/hero.ts")
        self.runs_site("pepla-web/src/app/features/public/public-page.ts")

    def test_S2_files_the_site_pages_import(self):
        self.runs_site("pepla-web/src/app/ds/core/icon.ts")

    def test_S3_styles(self):
        self.runs_site("pepla-web/src/styles/design-system/components.css")
        self.runs_site("pepla-web/src/styles.css")

    def test_S4_routes_and_app_setup(self):
        for f in ("pepla-web/src/app/app.routes.ts", "pepla-web/src/app/site.routes.ts", "pepla-web/src/app/app.config.ts",
                  "pepla-web/src/app/app.routes.server.ts", "pepla-web/src/main.ts", "pepla-web/src/main.server.ts",
                  "pepla-web/src/index.html", "pepla-web/src/polyfills.ts", "pepla-web/src/environments/environment.ts"):
            self.runs_site(f)

    def test_S5_package_and_build_files(self):
        for f in ("pepla-web/package.json", "pepla-web/package-lock.json", "pepla-web/angular.json", "pepla-web/tsconfig.json",
                  "pepla-web/tsconfig.app.json", "pepla-web/scripts/verify-design.mjs", "pepla-web/public/favicon.ico"):
            self.runs_site(f)

    def test_S6_parity(self):
        self.runs_site("pepla-web/e2e/parity/kit-parity.ts")

    def test_S7_site_test_files(self):
        self.runs_site(A + "support/site-08/files.ts")
        # a site card's own files run that card, as before; rule A leaves it alone
        for f in (A + "site-04.spec.ts", A + "cards/site-04.md", A + "cards/site-04.2.md"):
            res = run_a([f])
            self.assertEqual(res[:2], ("selected", {"site-04"}), f)
            self.assertNotIn("left out", res[2])

    def test_S8_shared_files_a_site_test_imports(self):
        for f in (A + "support/fixtures.ts", A + "support/cognito-fake.ts", A + "playwright.config.ts"):
            self.runs_site(f)

    def test_S9_workflow_and_picker(self):
        for f in (".github/workflows/pepla-web.yml", ".github/workflows/acceptance-lock.yml",
                  "scripts/ci/pick-acceptance-specs.py", "scripts/ci/test_pick_acceptance_specs.py"):
            self.runs_site(f)

    def test_S10_signed_in_file_that_starts_using_site_code(self):
        for words in ("import { PpSiteHero } from '../../ds/site/hero';", "<pp-site-band>", "new DemoClock()", "@import 'site.css'"):
            self.runs_site("pepla-web/src/app/features/hr/hr-home.page.ts",
                           read=texts(**{"pepla-web/src/app/features/hr/hr-home.page.ts": words}))

    def test_review_gaps_site_02_ac_12(self):
        # the gallery list: any new name with "site" in it (PpComposite) must run site-02
        self.runs_site("pepla-web/src/app/ds/all.ts", read=texts(**{"pepla-web/src/app/ds/all.ts": "PpComposite"}))
        # without the word, the gallery list does not touch the site
        res = run_a(["pepla-web/src/app/ds/all.ts"], read=texts(**{"pepla-web/src/app/ds/all.ts": "export const ALL = [PpButton];"}))
        self.assertEqual(site_cards(res), LIGHT)
        # unreadable (deleted): unsure, so it counts
        self.runs_site("pepla-web/src/app/ds/all.ts", read=lambda p: None)
        # the design system page
        self.runs_site("pepla-web/src/app/dev/design-system.page.ts")
        # a short path import of site code, outside the site pages' imports
        for line in ("import { SITE_MENU } from '../site';", 'import { X } from "../site/menu";', "import { ppSiteThing } from './x';"):
            self.runs_site("pepla-web/src/app/ds/agent/panel.ts", read=texts(**{"pepla-web/src/app/ds/agent/panel.ts": line}))

    def test_review_gap_words_that_only_look_alike_do_not_count(self):
        res = run_a(["pepla-web/src/app/ds/agent/panel.ts"], read=texts(**{"pepla-web/src/app/ds/agent/panel.ts": "import { y } from '../website-x'; // sites"}))
        self.assertEqual(site_cards(res), LIGHT)

    def test_S10_a_deleted_file_is_unsure(self):
        self.runs_site("pepla-web/src/app/features/hr/gone.ts", read=lambda p: None)

    def test_S11_a_path_nobody_placed(self):
        for f in ("pepla-web/src/assets/logo.svg", "pepla-web/src/app/something-new/x.ts", "pepla-web/brand-new-folder/a.json",
                  "Dockerfile", "package.json", "pepla-web/src/typings.d.ts"):
            self.runs_site(f)


class RuleANotSite(unittest.TestCase):
    """One case per line of the spec's "not on the list": site specs do not run."""

    def skips_site(self, path, **kw):
        res = run_a([path], **kw)
        self.assertEqual(site_cards(res) - LIGHT, set(), f"{path}: {res}")
        return res

    def test_backend_infra_and_other_workflows(self):
        for f in ("lambda/getEmployees/index.mjs", "api/openapi.yaml", "infra/kms.tf", "talent-flow-infra/x.tf", "bootstrap/dev/a.tf",
                  "mcp/server.py", ".github/workflows/terraform-apply.yml", ".github/workflows/deploy-lambdas.yml",
                  "scripts/ci/seed-dev.py", "scripts/ci/pick-e2e-tests.py"):
            res = self.skips_site(f)
            self.assertEqual(site_cards(res), set(), f)  # not even the light checks: nothing under pepla-web/src

    def test_other_cards_test_files_and_support(self):
        for f in (A + "onb-09.spec.ts", A + "cards/onb-09.md", A + "support/chat-14/chats-fake.ts", A + "support/ten-04/walk.ts",
                  A + "ten-04.7.spec.ts", A + "support/marketplace-dev/grant.ts"):
            self.assertEqual(site_cards(self.skips_site(f)), set(), f)

    def test_app_code_outside_the_site(self):
        for f in ("pepla-web/src/app/features/hr/hr-home.page.ts", "pepla-web/src/app/features/start/start.page.ts",
                  "pepla-web/src/app/core/auth/auth.ts", "pepla-web/src/app/dev/other.page.ts",
                  "pepla-web/src/app/ds/agent/panel.ts"):
            self.skips_site(f)

    def test_docs_still_run_nothing(self):
        self.assertEqual(run_a(["docs/a.md", "pepla-web/README.md"])[0], "none")

    def test_everything_else_the_picker_chose_stays(self):
        mode, cards, reason = run_a(["lambda/x/index.mjs"])
        self.assertEqual(mode, "selected")
        self.assertEqual(cards, set(SITE_SPECS) - SITE_IDS)
        self.assertIn("site tests left out", reason)

    def test_app_file_keeps_its_cards_and_journeys(self):
        mode, cards, _ = run_a([HR], own=["onb-13"])
        self.assertEqual((mode, cards - SITE_IDS), ("selected", {"onb-09", "onb-13", "help-02", "onb-02"}))


class RuleALightChecks(unittest.TestCase):
    def test_A2_an_app_change_keeps_site_01_and_site_07(self):
        res = run_a(["pepla-web/src/app/features/hr/hr-home.page.ts"], touched={"pepla-web/src/app/features/hr/hr-home.page.ts": {"onb-09"}})
        self.assertEqual(site_cards(res), LIGHT)
        self.assertIn("light", res[2])

    def test_A2_only_app_changes_get_them(self):
        self.assertEqual(site_cards(run_a(["lambda/a.mjs"])), set())


class RuleAOwnCard(unittest.TestCase):
    def test_A1_a_site_cards_own_pr_always_runs_its_spec(self):
        res = run_a(["lambda/a.mjs"], own=["site-04"])
        self.assertEqual(site_cards(res), {"site-04"})

    def test_A1_own_card_named_but_nothing_else_site(self):
        res = run_a([A + "cards/site-09.md"], own=["site-09"])
        self.assertEqual(site_cards(res), {"site-09"})  # its own test file is a site change: nothing is left out


class RuleAKeepsFullRuns(unittest.TestCase):
    """A4: schedule, by hand and a PR into main run every spec, site included."""

    def test_A4(self):
        for event, base in (("schedule", ""), ("workflow_dispatch", ""), ("pull_request", "main"), ("push", "develop")):
            mode, cards, _ = run_a(["lambda/a.mjs"], event=event, base=base)
            self.assertEqual((mode, cards), ("full", set()), event)

    def test_rule_a_is_off_without_a_site_check(self):
        self.assertEqual(m.pick(["lambda/a.mjs"], SITE_SPECS, TOUCHED, set())[0], "full")


class ImportChain(unittest.TestCase):
    def tree(self, files):
        return (lambda p: files.get(p)), (lambda p: p in files)

    def test_follows_relative_imports_templates_and_directories(self):
        files = {
            "a/start.ts": "import { X } from './x';\nexport { Y } from '../b/y';\nconst z = import('./lazy');\n@Component({ templateUrl: './start.html' })",
            "a/x.ts": "import { Q } from './sub';",
            "a/sub/index.ts": "",
            "b/y.ts": "import { n } from '@angular/core';",
            "a/lazy.ts": "",
            "a/start.html": "",
            "a/unrelated.ts": "",
        }
        read, exists = self.tree(files)
        got = m.follow_imports(["a/start.ts"], read, exists)
        self.assertEqual(got, {"a/start.ts", "a/x.ts", "a/sub/index.ts", "b/y.ts", "a/lazy.ts", "a/start.html"})

    def test_a_planted_new_import_is_followed(self):
        files = {"a/start.ts": "import { X } from './x';", "a/x.ts": "", "a/new.ts": ""}
        read, exists = self.tree(files)
        self.assertNotIn("a/new.ts", m.follow_imports(["a/start.ts"], read, exists))
        files["a/x.ts"] = "import { N } from './new';"
        self.assertIn("a/new.ts", m.follow_imports(["a/start.ts"], read, exists))

    def test_cycles_end(self):
        files = {"a.ts": "import './b';", "b.ts": "import './a';"}
        read, exists = self.tree(files)
        self.assertEqual(m.follow_imports(["a.ts"], read, exists), {"a.ts", "b.ts"})

    def test_todays_site_chain(self):
        from pathlib import Path
        read = lambda p: Path(p).read_text(errors="replace") if Path(p).is_file() else None
        exists = lambda p: Path(p).is_file()
        app = m.follow_imports(list(m.SITE_START), read, exists)
        outside = sorted(f for f in app if not f.startswith(("pepla-web/src/app/ds/site/", "pepla-web/src/app/features/public/")))
        self.assertEqual(len(outside), 17, outside)
        for f in ("ds/actions/button.ts", "ds/core/icon.ts", "ds/status/status.ts", "ds/util.ts", "ds/format.ts"):
            self.assertIn("pepla-web/src/app/" + f, outside)
        specs = sorted(p.name[: -len(".spec.ts")] for p in Path("pepla-web/e2e/acceptance").glob("site-*.spec.ts"))
        tests = m.follow_imports([f"{m.ACC}{c}.spec.ts" for c in specs], read, exists)
        for f in ("support/fixtures.ts", "support/cognito-fake.ts", "support/sign-in-again.ts", "support/onb-05/me-fake.ts"):
            self.assertIn(m.ACC + f, tests)

    def test_no_path_aliases_in_tsconfig(self):
        """The chain follows ./ and ../ only. If tsconfig gains path aliases, revisit follow_imports."""
        from pathlib import Path
        for f in Path("pepla-web").glob("tsconfig*.json"):
            self.assertNotIn('"paths"', f.read_text(), f"{f} has path aliases: the import chain would miss them")


# The 34 green PR runs of 18 to 20 Nov, replayed with today's rules (spec table, section 2).
# run id -> what the site specs should do: "run" (touches the site), "light" (only site-01 and site-07),
# "skip" (none), "few" (the old picker already ran only a few files, none of them site specs).
SITE_RUN = {
    44675505584, 44632464857, 44599050645, 44582190893, 44580510903, 44577216902, 44567280781,
    44509056552, 44487190346, 44478746423, 44422607484,
}
LIGHT_RUN = {44697980532}
FEW = {44699554047, 44656133485, 44634581153, 44595029776}


class The34PastPullRequests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from pathlib import Path
        cls.dir = Path(__file__).with_name("fixtures") / "step-5"
        cls.rows = [l.split("\t") for l in (cls.dir / "runs.tsv").read_text().splitlines() if l.strip()]
        cls.specs = {p.name[: -len(".spec.ts")]: p.read_text() for p in Path("pepla-web/e2e/acceptance").glob("*.spec.ts")}
        read = lambda p: Path(p).read_text(errors="replace") if Path(p).is_file() else ""
        site_specs = sorted(c for c in cls.specs if c.startswith("site-"))
        chain = m.site_chain(site_specs, read, lambda p: Path(p).is_file())
        # The old picker needs which cards touched an app file; the replay only needs "unknown" = full,
        # which is what the old picker did for these runs, so rule A is judged from a full run.
        cls.site = (chain, read)

    def replay(self, run, branch, title):
        changed = (self.dir / f"{run}.txt").read_text().splitlines()
        own = m.card_of(title + "\n" + branch)
        return m.pick(changed, self.specs, {}, own, "pull_request", "develop", self.site), own

    def test_there_are_34(self):
        self.assertEqual(len(self.rows), 34)

    def test_each_run(self):
        counts = {"run": 0, "light": 0, "skip": 0, "few": 0}
        for run, branch, title in self.rows:
            run = int(run)
            (mode, cards, reason), own = self.replay(run, branch, title)
            site = (set(self.specs) if mode == "full" else cards) & {c for c in self.specs if c.startswith("site-")}
            if run in FEW:
                # the old picker chose a few cards (or none) for these; rule A must not add any site spec
                self.assertEqual(site - own, set(), (run, reason))
                counts["few"] += 1
            elif run in SITE_RUN:
                self.assertTrue(site >= {c for c in self.specs if c.startswith("site-")} - set(), (run, mode, reason))
                counts["run"] += 1
            elif run in LIGHT_RUN:
                self.assertEqual(site, LIGHT, (run, reason))
                counts["light"] += 1
            else:
                self.assertEqual(site - own, set(), (run, mode, sorted(site), reason))
                counts["skip"] += 1
        # 30 runs were "everything" before: 11 still run the site specs, 19 skip them (CHAT-14 keeps two light ones)
        self.assertEqual(counts, {"run": 11, "light": 1, "skip": 18, "few": 4})
        self.assertEqual(counts["light"] + counts["skip"], 19)


# ---------------------------------------------------------------- step 5: timing list from the nightly run


class WorkflowTiming(unittest.TestCase):
    """The workflow's timing steps, read as text (review of PR 459, findings 1 and 2)."""

    @classmethod
    def setUpClass(cls):
        from pathlib import Path

        cls.text = Path(".github/workflows/pepla-web.yml").read_text()

    def test_every_shard_saves_its_timings_under_its_own_file_name(self):
        self.assertIn("spec-seconds-shard-${{ matrix.shard }}.json", self.text)
        self.assertNotIn("spec-seconds-shard.json", self.text)

    def test_the_join_does_not_pile_shard_files_into_one_folder(self):
        self.assertNotIn("merge-multiple", self.text)

    def test_prs_read_the_newest_finished_nightly_even_when_it_was_red(self):
        self.assertIn("--status completed", self.text)
        self.assertNotIn("--status success", self.text)

class EveryPullRequestReportsTheCheck(unittest.TestCase):
    """Step 2 of the 26 Nov pipeline plan, read as text: no paths filter on pull requests."""

    @classmethod
    def setUpClass(cls):
        import yaml
        from pathlib import Path

        cls.doc = yaml.safe_load(Path(".github/workflows/pepla-web.yml").read_text())
        cls.on = cls.doc.get("on", cls.doc.get(True))

    def test_pull_requests_are_not_path_filtered(self):
        self.assertNotIn("paths", self.on["pull_request"])
        self.assertNotIn("paths-ignore", self.on["pull_request"])

    def test_the_check_job_always_runs_on_a_pull_request(self):
        jobs = self.doc["jobs"]
        self.assertEqual(jobs["acceptance"]["if"], "always()")
        self.assertEqual(jobs["plan"]["if"], "github.event_name != 'push'")

    def test_screen_jobs_skip_only_when_the_screen_check_says_false(self):
        for name in ("build", "journeys"):
            cond = self.doc["jobs"][name]["if"]
            self.assertIn("needs.changes.outputs.screen != 'false'", cond)
            self.assertIn("!cancelled()", cond)


class RealRepo(unittest.TestCase):
    """Runs the two CI scripts as the workflow does, on a throwaway git repo (review of PR 548)."""

    HERE = Path(__file__).resolve().parent

    def setUp(self):
        import subprocess
        import tempfile

        self.sp = subprocess
        self.dir = Path(tempfile.mkdtemp())
        self.git("init", "-q", "-b", "develop")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "user.name", "t")
        self.write("pepla-web/e2e/acceptance/onb-09.spec.ts", "page.goto")
        self.write("pepla-web/src/util.ts", "export const a = 1;\n")
        self.write("lambda/x.mjs", "export const a = 1;\n")
        self.write("docs/a.md", "a\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return self.sp.run(["git", *args], cwd=self.dir, check=True, capture_output=True, text=True).stdout

    def write(self, rel, text):
        f = self.dir / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)

    def commit_change(self, edit):
        edit()
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "change")

    def screen(self, base=None):
        env = {**os.environ, "BASE_SHA": base or self.base}
        out = self.sp.run(["python3", "-B", str(self.HERE / "screen-changed.py")], cwd=self.dir, env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        return out.stdout.strip()

    def pick(self):
        env = {**os.environ, "EVENT_NAME": "pull_request", "BASE_REF": "develop", "BASE_SHA": self.base, "PR_TITLE": "", "HEAD_REF": "x"}
        env.pop("GITHUB_STEP_SUMMARY", None)
        out = self.sp.run(["python3", "-B", str(self.HERE / "pick-acceptance-specs.py")], cwd=self.dir, env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        return dict(line.split("=", 1) for line in out.stdout.splitlines() if "=" in line)

    def edit_file(self, rel):
        self.commit_change(lambda: self.write(rel, "export const a = 2;\n"))

    def test_screen_files_say_true(self):
        for rel in ("pepla-web/src/util.ts", "api/openapi.yaml", ".github/workflows/pepla-web.yml"):
            self.setUp()
            self.edit_file(rel)
            self.assertEqual(self.screen(), "screen=true", rel)

    def test_other_files_say_false(self):
        for rel in ("lambda/x.mjs", "docs/a.md", ".github/workflows/ci.yml", "scripts/ci/a.py"):
            self.setUp()
            self.edit_file(rel)
            self.assertEqual(self.screen(), "screen=false", rel)

    def test_a_file_moved_out_of_pepla_web_says_true(self):
        self.commit_change(lambda: self.git("mv", "pepla-web/src/util.ts", "docs/util.ts"))
        self.assertEqual(self.screen(), "screen=true")

    def test_a_bad_base_commit_says_true(self):
        self.edit_file("docs/a.md")
        self.assertEqual(self.screen("0" * 40), "screen=true")

    def test_picker_on_a_docs_only_change_picks_none_with_no_shards(self):
        self.edit_file("docs/a.md")
        out = self.pick()
        self.assertEqual(out["mode"], "none")
        self.assertEqual(json.loads(out["matrix"]), {"include": []})

    def test_picker_does_not_call_a_moved_screen_file_docs(self):
        self.commit_change(lambda: self.git("mv", "pepla-web/src/util.ts", "docs/util.ts"))
        self.assertNotEqual(self.pick()["mode"], "none")


class ScreenJobConditions(unittest.TestCase):
    def test_no_screen_job_needs_a_true_answer(self):
        import yaml
        from pathlib import Path as P

        doc = yaml.safe_load(P(".github/workflows/pepla-web.yml").read_text())
        for name in ("build", "journeys"):
            self.assertNotIn("== 'true'", doc["jobs"][name]["if"])
        step = doc["jobs"]["changes"]["steps"][-1]
        self.assertIn("screen-changed.py", step["run"])


NOW = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)


class TimingList(unittest.TestCase):
    def write(self, text):
        d = tempfile.mkdtemp()
        from pathlib import Path
        p = Path(d) / "t.json"
        p.write_text(text)
        return p

    def committed(self):
        return self.write(json.dumps({"seconds": {"site-01.spec.ts": 100, "onb-09.spec.ts": 50}}))

    def test_fresh_nightly_file_replaces_numbers_file_by_file(self):
        fresh = self.write(json.dumps({"generated": (NOW - timedelta(days=1)).isoformat(), "seconds": {"site-01.spec.ts": 150, "new-1.spec.ts": 30}}))
        seconds, note = m.load_timing(fresh, NOW, self.committed())
        self.assertEqual(seconds, {"site-01": 150.0, "onb-09": 50.0, "new-1": 30.0})
        self.assertIn("nightly file", note)

    def test_missing_file_uses_committed_and_says_so(self):
        from pathlib import Path
        seconds, note = m.load_timing(Path("/nonexistent/x.json"), NOW, self.committed())
        self.assertEqual(seconds["site-01"], 100.0)
        self.assertIn("missing or could not be read", note)

    def test_old_file_uses_committed_and_says_so(self):
        fresh = self.write(json.dumps({"generated": (NOW - timedelta(days=8)).isoformat(), "seconds": {"site-01.spec.ts": 150}}))
        seconds, note = m.load_timing(fresh, NOW, self.committed())
        self.assertEqual(seconds["site-01"], 100.0)
        self.assertIn("more than 7 days old", note)

    def test_broken_file_uses_committed_and_says_so(self):
        for text in ("{not json", "{}", json.dumps({"generated": "yesterday", "seconds": {"a.spec.ts": 1}}),
                     json.dumps({"generated": NOW.isoformat(), "seconds": {}})):
            seconds, note = m.load_timing(self.write(text), NOW, self.committed())
            self.assertEqual(seconds["site-01"], 100.0, text)
            self.assertIn("committed file", note)

    def test_no_file_offered(self):
        self.assertIn("no nightly file", m.load_timing(None, NOW, self.committed())[1])

    def test_a_spec_missing_from_the_list_counts_three_minutes(self):
        self.assertEqual(m.weight("new-1", "x", {}), 180)
        self.assertEqual(m.weight("new-2", "runJourney", {}), 600)



if __name__ == "__main__":
    unittest.main()
