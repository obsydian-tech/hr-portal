#!/usr/bin/env python3
"""Tests for scripts/ci/check-lambda-settings.py (BE-15).

Run: python3 -B scripts/ci/test_check_lambda_settings.py   (standard library only)
Planted-fault tests copy the real Lambda sources and Terraform text into a
temporary folder and break one thing at a time.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CHECK = HERE / "check-lambda-settings.py"
SENTINEL = "SENTINEL-value-never-printed"
POOL = "af-south-1_2LdAGFnw2"


def run(*args):
    r = subprocess.run([sys.executable, "-I", "-B", str(CHECK), *args], capture_output=True, text=True, timeout=60)
    assert SENTINEL not in r.stdout + r.stderr, "a value was printed"
    return r


def copy_repo(dst: Path):
    ignore = shutil.ignore_patterns("node_modules", "package-lock.json", ".terraform", "*.zip")
    for d in ("lambda", "infra", "talent-flow-infra"):
        shutil.copytree(REPO / d, dst / d, ignore=ignore)


class StaticChecks(unittest.TestCase):
    def test_real_repo_is_clean(self):
        r = run()
        self.assertEqual(r.returncode, 0, r.stdout)

    def planted(self, rel, old, new, expect):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_repo(root)
            p = root / rel
            text = p.read_text(encoding="utf-8")
            self.assertIn(old, text)
            p.write_text(text.replace(old, new, 1), encoding="utf-8")
            r = run("--root", d)
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertIn(expect, r.stdout)
            return r

    def test_prod_pool_id_in_code_fails(self):
        r = self.planted("lambda/adminCreateUser/index.js", "requireSetting('COGNITO_POOL_ID');",
                         f"requireSetting('COGNITO_POOL_ID'); // {POOL}", "prod pool id in Lambda code")
        self.assertNotIn(POOL, r.stdout)

    def test_prod_host_in_code_fails(self):
        self.planted("lambda/generateScoringLink/index.js", "requireSetting('FRONTEND_URL')",
                     "requireSetting('FRONTEND_URL') && 'hr-portal-beryl-three.vercel.app'", "prod web address in Lambda code")

    def test_prod_account_and_client_id_fail(self):
        self.planted("lambda/getHiringManagers/index.js", "const HM_GROUP",
                     "// 937137806477\nconst HM_GROUP", "prod account id in Lambda code")
        self.planted("lambda/getHiringManagers/index.js", "const HM_GROUP",
                     "// 1pk5rd58glsohfplnlr63tg0qb\nconst HM_GROUP", "prod app client id in Lambda code")

    def test_test_files_may_hold_prod_values(self):
        with tempfile.TemporaryDirectory() as d:
            copy_repo(Path(d))
            (Path(d) / "lambda/adminCreateUser/extra.test.js").write_text(f"// {POOL}\n")
            self.assertEqual(run("--root", d).returncode, 0)

    def test_fallback_fails(self):
        self.planted("lambda/reviewDocumentVerification/index.mjs", "requireSetting('ENVIRONMENT')",
                     "process.env.ENVIRONMENT || 'x'", "ENVIRONMENT has a fallback value")
        self.planted("lambda/adminUpdateUser/index.js", "requireSetting('COGNITO_POOL_ID')",
                     "process.env.COGNITO_POOL_ID ?? 'x'", "COGNITO_POOL_ID has a fallback value")

    def test_setting_not_read_through_helper_fails(self):
        self.planted("lambda/createEmployee/index.mjs", 'requireSetting("LOGIN_URL")', "process.env.LOGIN_URL",
                     "LOGIN_URL is not read with requireSetting()")

    def test_terraform_missing_setting_fails(self):
        self.planted("infra/lambdas.tf", "COGNITO_POOL_ID", "COGNITO_POOL_ID_X",
                     "createEmployee does not get COGNITO_POOL_ID")
        self.planted("infra/lambdas.tf", "ENVIRONMENT ", "ENVIRONMENT_X ",
                     "reviewDocumentVerification does not get ENVIRONMENT")

    def test_terraform_literal_url_fails(self):
        self.planted("talent-flow-infra/talent-flow-lambdas.tf", "FRONTEND_URL     = var.frontend_url",
                     'FRONTEND_URL     = "https://example.test"', "sets FRONTEND_URL to a literal")

    def test_dev_tfvars_with_prod_value_fails(self):
        self.planted("infra/env/dev.tfvars", 'login_url = "http://localhost:4300/sign-in"',
                     'login_url = "https://hr-portal-beryl-three.vercel.app/login"', "prod web address in the pepla-dev values")

    def test_dev_tfvars_missing_url_fails(self):
        self.planted("talent-flow-infra/env/dev.tfvars", 'frontend_url = "http://localhost:4200"', "",
                     "frontend_url is not set for pepla-dev")


def fn_change(name, before, after, actions=("update",), unknown=None):
    def env(v):
        return None if v is None else [{"variables": v}]
    return {
        "address": f"aws_lambda_function.{name}", "type": "aws_lambda_function",
        "change": {
            "actions": list(actions),
            "before": None if before is None else {"function_name": name, "environment": env(before)},
            "after": {"function_name": name, "environment": env(after)},
            "after_unknown": {"environment": [{"variables": unknown}]} if unknown else {},
        },
    }


def plan(*changes):
    return {"format_version": "1.2", "resource_changes": list(changes)}


class PlanMode(unittest.TestCase):
    def run_plan(self, obj):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "plan.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(obj, f)
            return run("plan", p)

    def test_new_key_with_old_value_passes(self):
        r = self.run_plan(plan(fn_change("createEmployee", {"LOGIN_URL": SENTINEL}, {"LOGIN_URL": SENTINEL, "COGNITO_POOL_ID": POOL})))
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_environment_label_prod_passes(self):
        r = self.run_plan(plan(fn_change("reviewDocumentVerification", {"A": "1"}, {"A": "1", "ENVIRONMENT": "prod"})))
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_changed_value_fails(self):
        r = self.run_plan(plan(fn_change("createEmployee", {"LOGIN_URL": SENTINEL}, {"LOGIN_URL": "other", "COGNITO_POOL_ID": POOL})))
        self.assertEqual(r.returncode, 1)
        self.assertIn("LOGIN_URL would change", r.stdout)

    def test_removed_key_fails(self):
        r = self.run_plan(plan(fn_change("createEmployee", {"LOGIN_URL": "x", "KMS_KEY_ARN": "k"}, {"LOGIN_URL": "x"})))
        self.assertEqual(r.returncode, 1)
        self.assertIn("KMS_KEY_ARN would be removed", r.stdout)

    def test_new_key_with_other_value_fails(self):
        r = self.run_plan(plan(fn_change("createEmployee", {"A": "1"}, {"A": "1", "COGNITO_POOL_ID": "af-south-1_other"})))
        self.assertEqual(r.returncode, 1)
        self.assertIn("COGNITO_POOL_ID does not equal what the code used before", r.stdout)
        self.assertNotIn("af-south-1_other", r.stdout)

    def test_new_key_not_on_list_is_a_notice(self):
        r = self.run_plan(plan(fn_change("getPanelMembers", {"A": "1"}, {"A": "1", "ENVIRONMENT": "prod"})))
        self.assertEqual(r.returncode, 0)
        self.assertIn("new setting ENVIRONMENT", r.stdout)

    def test_unknown_value_fails_closed(self):
        r = self.run_plan(plan(fn_change("createEmployee", {"A": "1"}, {"A": "1"}, unknown={"COGNITO_POOL_ID": True})))
        self.assertEqual(r.returncode, 1)

    def test_other_resources_and_noops_are_ignored(self):
        other = {"address": "aws_s3_bucket.b", "type": "aws_s3_bucket", "change": {"actions": ["update"], "before": {"x": 1}, "after": {"x": 2}}}
        noop = fn_change("createEmployee", {"A": "1"}, {"A": "2"}, actions=("no-op",))
        self.assertEqual(self.run_plan(plan(other, noop)).returncode, 0)

    def test_replace_fails(self):
        r = self.run_plan(plan(fn_change("createEmployee", {"A": "1"}, {"A": "1"}, actions=("delete", "create"))))
        self.assertEqual(r.returncode, 1)

    def test_secret_values_never_printed(self):
        r = self.run_plan(plan(fn_change("createEmployee", {"POSTMARK_API_TOKEN": SENTINEL}, {"POSTMARK_API_TOKEN": SENTINEL + "2"})))
        self.assertEqual(r.returncode, 1)

    def test_unreadable_plan_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "plan.json")
            Path(p).write_text("not json")
            self.assertEqual(run("plan", p).returncode, 2)
            Path(p).write_text("{}")
            self.assertEqual(run("plan", p).returncode, 2)
        self.assertEqual(run("plan", "/nonexistent/plan.json").returncode, 2)


if __name__ == "__main__":
    unittest.main()
