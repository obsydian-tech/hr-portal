#!/usr/bin/env python3
"""Tests for pipeline step 6: the dev run tells the truth.

Run: python3 -B scripts/ci/test_dev_run_truth.py   (standard library plus PyYAML)

Fault 1: "pepla-dev: Terraform result" (terraform-apply.yml, job dev-result) must not
pass a merge that changes no Terraform while the last pepla-dev apply is still failed
(the issue "Terraform apply failed: dev" is open). The test runs the job's real
script with a fake `gh` on the path.

Fault 2: the stand-alone "App tests on dev" run that steps aside must end cancelled,
never green, and the called run (full) must never cancel itself.
"""
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
TF = yaml.safe_load((ROOT / ".github/workflows/terraform-apply.yml").read_text())
APP = yaml.safe_load((ROOT / ".github/workflows/app-e2e-dev.yml").read_text())


def step_script(job, name_part):
    for s in job["steps"]:
        if name_part in s.get("name", ""):
            return s["run"], s
    raise AssertionError(f"no step with {name_part!r}")


def run_bash(script, env, gh_body, shell=None):
    """Runs a step's script with a fake `gh`, the way GitHub runs it: `shell: bash` gets
    `bash -e -o pipefail`, a step with no shell gets `bash -e` (no pipefail).
    Returns (exit code, output, gh calls)."""
    with tempfile.TemporaryDirectory() as d:
        gh = Path(d) / "gh"
        gh.write_text("#!/bin/bash\necho \"$@\" >> \"$GH_CALLS\"\n" + gh_body + "\n")
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        calls = Path(d) / "calls.txt"
        calls.write_text("")
        e = {"PATH": f"{d}:{os.environ['PATH']}", "GH_CALLS": str(calls), "HOME": d, **env}
        flags = ["-e", "-o", "pipefail"] if shell == "bash" else ["-e"]
        r = subprocess.run(["bash", "--noprofile", "--norc", *flags, "-c", script], capture_output=True, text=True, env=e)
        return r.returncode, r.stdout + r.stderr, calls.read_text()


class DevResult(unittest.TestCase):
    script, step = step_script(TF["jobs"]["dev-result"], "Pass only when")

    def result(self, *, infra, tf_dev, issue, auto="true", destroys="", gh_fails=False):
        body = "exit 1" if gh_fails else (f'echo {issue}' if issue else "true")
        env = {"INFRA": infra, "AUTO_APPLY": auto, "TF_DEV": tf_dev, "DESTROYS": destroys, "GATE": "skipped", "AFTER": "skipped"}
        return run_bash(self.script, env, body, self.step.get("shell"))

    # The 20 Nov case: run 122 failed its apply, run 123 started 17 seconds later with no Terraform change.
    def test_no_terraform_change_but_last_apply_failed_is_red(self):
        code, out, _ = self.result(infra="false", tf_dev="skipped", issue="456")
        self.assertEqual(code, 1, out)
        self.assertIn("has not been applied since", out)

    def test_no_terraform_change_and_last_apply_fine_is_green(self):
        code, out, calls = self.result(infra="false", tf_dev="skipped", issue="")
        self.assertEqual(code, 0, out)
        self.assertIn("issue list", calls)  # it really looked

    def test_this_run_applies_its_own_change_and_succeeds_is_green(self):
        # an old failure issue is closed by "failure issue" in this same run, so it does not matter here
        code, out, _ = self.result(infra="true", tf_dev="success", issue="456")
        self.assertEqual(code, 0, out)

    def test_first_run_ever_no_issue_is_green(self):
        code, out, _ = self.result(infra="false", tf_dev="skipped", issue="")
        self.assertEqual(code, 0, out)

    def test_the_step_runs_with_pipefail(self):
        self.assertEqual(self.step.get("shell"), "bash")

    def test_cannot_read_issues_is_red_not_green(self):
        code, out, _ = self.result(infra="false", tf_dev="skipped", issue="", gh_fails=True)
        self.assertEqual(code, 1, out)

    def test_old_rules_still_hold(self):
        self.assertEqual(self.result(infra="true", tf_dev="skipped", issue="")[0], 1)  # plan skipped though Terraform changed
        self.assertEqual(self.result(infra="true", tf_dev="failure", issue="")[0], 1)
        self.assertEqual(self.result(infra="true", tf_dev="success", issue="", auto="false")[0], 0)
        self.assertEqual(self.result(infra="true", tf_dev="success", issue="", destroys="true")[0], 1)

    def test_job_reads_issues_and_no_more(self):
        self.assertEqual(TF["jobs"]["dev-result"]["permissions"], {"issues": "read"})


class AppGate(unittest.TestCase):
    gate = APP["jobs"]["gate"]
    cancel_script, cancel_step = step_script(gate, "Step aside")

    def test_only_a_run_that_steps_aside_cancels(self):
        self.assertEqual(self.cancel_step["if"], "steps.decide.outputs.run == 'false'")
        code, out, calls = run_bash(self.cancel_script, {"GITHUB_RUN_ID": "42"}, "true")
        self.assertEqual(code, 0, out)
        self.assertIn("run cancel 42", calls)

    def test_a_failed_cancel_does_not_fail_the_run(self):
        code, out, _ = run_bash(self.cancel_script, {"GITHUB_RUN_ID": "42"}, "exit 1")
        self.assertEqual(code, 0, out)

    def test_the_call_from_deploy_lambdas_always_runs(self):
        script, _ = step_script(self.gate, "Decide")
        with tempfile.NamedTemporaryFile("r") as out:
            code, text, _ = run_bash(script, {"EVENT": "push", "FULL": "true", "BEFORE": "a", "AFTER": "b", "GITHUB_OUTPUT": out.name}, "true")
            self.assertEqual(code, 0, text)
            self.assertIn("run=true", Path(out.name).read_text())

    def test_the_tests_job_waits_for_the_gate_decision(self):
        self.assertIn("needs.gate.outputs.run == 'true'", APP["jobs"]["e2e-dev"]["if"])

    def test_gate_permissions(self):
        self.assertEqual(self.gate["permissions"], {"contents": "read", "actions": "write"})
        caller = yaml.safe_load((ROOT / ".github/workflows/deploy-lambdas.yml").read_text())["jobs"]["e2e-dev"]
        self.assertEqual(caller["permissions"].get("actions"), "write")  # a called job cannot ask for more than its caller


if __name__ == "__main__":
    unittest.main(verbosity=2)
