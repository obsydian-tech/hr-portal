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
        mode, cards, _ = run([A + "onb-09.spec.ts", A + "cards/onb-09.md", A + "support/onb-09/a.ts"])
        self.assertEqual((mode, cards), ("selected", {"onb-09"}))
        self.assertEqual(run([A + "cards/help-02.3.md"])[1], {"help-02"})

    def test_infra_runs_infra_specs(self):
        mode, cards, _ = run(["infra/main.tf"])
        self.assertEqual((mode, cards), ("selected", {"ops-05", "be-16"}))

    def test_docs_run_nothing(self):
        self.assertEqual(run(["pepla-web/README.md", "docs/a.md"])[0], "none")

    def test_help_pictures_run_journey_specs(self):
        self.assertEqual(run(["pepla-web/help/media/desktop/a.png"])[1], {"onb-02", "help-02"})

    def test_card_keys(self):
        self.assertEqual(m.card_of("feat(help-02.3): x (NH-166) and ONB-09"), {"help-02", "onb-09"})


if __name__ == "__main__":
    unittest.main()
