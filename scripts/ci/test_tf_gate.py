#!/usr/bin/env python3
"""Unit tests for scripts/ci/tf-gate.py on fixture plans (OPS-05).

Run: python3 -B scripts/ci/test_tf_gate.py   (standard library only)
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

GATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tf-gate.py")
SECRET = "SENTINEL-value-never-printed"


def rc(address, actions, importing=None, before=None, after=None):
    change = {"actions": actions, "before": before or {"v": SECRET}, "after": after or {"v": SECRET}}
    if importing:
        change["importing"] = {"id": importing}
    return {"address": address, "change": change}


def plan(*changes):
    return {"format_version": "1.2", "resource_changes": list(changes)}


class Gate(unittest.TestCase):
    def run_gate(self, *args, files=None):
        with tempfile.TemporaryDirectory() as d:
            paths = []
            for name, content in (files or {}).items():
                p = os.path.join(d, name)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(content if isinstance(content, str) else json.dumps(content))
            argv = [a if a not in (files or {}) else os.path.join(d, a) for a in args]
            r = subprocess.run([sys.executable, "-I", "-B", GATE, *argv], capture_output=True, text=True, timeout=30)
            self.assertNotIn(SECRET, r.stdout + r.stderr)
            return r

    def destroys(self, *changes):
        return self.run_gate("destroys", "p.json", files={"p.json": plan(*changes)})

    def test_delete_and_both_replace_orders_stop(self):
        for actions, word in [(["delete"], "delete"), (["delete", "create"], "replace"), (["create", "delete"], "replace")]:
            r = self.destroys(rc("aws_sqs_queue.q", actions))
            self.assertEqual(r.returncode, 3, actions)
            self.assertEqual(r.stdout.strip(), f"{word}\taws_sqs_queue.q")

    def test_other_actions_do_not_stop(self):
        for c in [
            rc("aws_cognito_user_group.g", ["no-op"], importing="x/g"),
            rc("aws_cognito_user_group.g", ["update"], importing="x/g"),
            rc("aws_iam_role.r[0]", ["forget"]),
            rc("aws_sqs_queue.q", ["create"]),
            rc("aws_sqs_queue.q", ["update"]),
            rc("data.aws_region.current", ["read"]),
            rc("aws_sqs_queue.q", ["no-op"]),
        ]:
            r = self.destroys(c)
            self.assertEqual(r.returncode, 0, c)
            self.assertEqual(r.stdout.strip(), "")

    def test_unreadable_plans_never_pass(self):
        for bad in ["{not json", json.dumps({"resource_changes": [{"address": "a.b", "change": {}}]}), json.dumps([1])]:
            r = self.run_gate("destroys", "p.json", files={"p.json": bad})
            self.assertNotIn(r.returncode, (0, 3))

    def test_list_and_compare(self):
        approved = plan(rc("aws_lambda_function.a", ["update"]), rc("aws_iam_role.b", ["create"]), rc("aws_s3_bucket.c", ["no-op"]))
        listed = self.run_gate("list", "p.json", files={"p.json": approved}).stdout
        self.assertEqual(listed.splitlines(), ["create\taws_iam_role.b", "update\taws_lambda_function.a"])
        same = self.run_gate("compare", "a.txt", "p.json", files={"a.txt": listed, "p.json": approved})
        self.assertEqual(same.returncode, 0)
        swapped = plan(rc("aws_lambda_function.a", ["create", "delete"]), rc("aws_iam_role.b", ["create"]))
        diff = self.run_gate("compare", "a.txt", "p.json", files={"a.txt": listed, "p.json": swapped})
        self.assertNotEqual(diff.returncode, 0)
        self.assertIn("aws_lambda_function.a", diff.stdout)
        empty = self.run_gate("compare", "a.txt", "p.json", files={"a.txt": "", "p.json": approved})
        self.assertNotEqual(empty.returncode, 0)

    def test_summary_names_attributes_not_values(self):
        p = plan(
            rc("aws_lambda_function.f", ["update"], before={"timeout": 3, "environment": [{"variables": {"K": SECRET}}]}, after={"timeout": 9, "environment": []}),
            rc("aws_dynamodb_table.employees", ["update"], before={"deletion_protection_enabled": False}, after={"deletion_protection_enabled": True}),
            rc("aws_iam_role_policy.p", ["update"]),
        )
        r = self.run_gate("summary", "infra", "p.json", files={"p.json": p})
        self.assertEqual(r.returncode, 0)
        for text in ["timeout", "environment", "deletion_protection_enabled", "IAM change", "Lambda environment change", "Protected resource change"]:
            self.assertIn(text, r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
