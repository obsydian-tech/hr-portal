#!/usr/bin/env python3
"""Tests for pick-acceptance-specs.py. Run: python3 -B scripts/ci/test_pick_acceptance_specs.py"""
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
