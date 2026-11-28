#!/usr/bin/env python3
"""Tests for scripts/ci/check-permissions.py (pipeline step 7).

Run: python3 -B scripts/ci/test_check_permissions.py   (standard library only, no AWS)

Two kinds of test:
  * the six past cases, replayed on copies of the real files just before and just after each fix
    (scripts/ci/permission-fixtures/<pr>/before and /after, each file saved with a .txt suffix);
  * small made-up folders, one rule at a time.
"""
import importlib.util
import io
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FIX = HERE / "permission-fixtures"

spec = importlib.util.spec_from_file_location("check_permissions", HERE / "check-permissions.py")
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)

EXC = cp.Exceptions((HERE / "permission-check-exceptions.txt").read_text(encoding="utf-8"))


def found(res, subject, action, resource_prefix="", kind=None):
    return [f for f in res.findings
            if f.subject == subject and f.action == action and (f.resource or "").startswith(resource_prefix)
            and (kind is None or f.kind == kind)]


def bad(res, subject):
    return [f for f in res.findings if f.subject == subject and f.kind in cp.BLOCKING]


# ---------------------------------------------------------------------------------------------
# The six past cases
# ---------------------------------------------------------------------------------------------
class PastCases(unittest.TestCase):
    def run_case(self, pr):
        return (cp.analyze(FIX / pr / "before", EXC.known_keys), cp.analyze(FIX / pr / "after", EXC.known_keys))

    def test_330_email_check_could_not_use_the_key(self):
        before, after = self.run_case("330")
        self.assertTrue(found(before, "checkEmployeeEmail", "dynamodb:Query", "table/employees/index/email-index", "key missing"))
        self.assertEqual(bad(after, "checkEmployeeEmail"), [])

    def test_376_upload_link_could_not_sign_with_the_key(self):
        before, after = self.run_case("376")
        self.assertTrue(found(before, "createMyUploadLink", "s3:PutObject", "bucket/", "key missing"))
        self.assertEqual(bad(after, "createMyUploadLink"), [])
        # the object key is a template string: the bucket line is "could not judge", not a pass
        self.assertTrue(found(before, "createMyUploadLink", "s3:PutObject", "bucket/", "could not judge"))

    def test_407_six_functions_read_what_their_role_did_not_allow(self):
        before, after = self.run_case("407")
        expected = [
            ("getCandidateEvents", "dynamodb:Query", "table/talent-flow-state", "missing"),
            ("acknowledgeTile", "dynamodb:Query", "table/talent-flow-state", "missing"),
            ("snoozeTile", "dynamodb:Query", "table/talent-flow-state", "missing"),
            ("captureSentiment", "dynamodb:GetItem", "table/talent-flow-state", "missing"),
            ("markNotificationRead", "dynamodb:GetItem", "table/talent-flow-notifications", "missing"),
            ("queryAuditLog", "dynamodb:Query", "table/onboarding-events", "key missing"),
            ("queryAuditLog", "dynamodb:Scan", "table/onboarding-events", "key missing"),
        ]
        for subject, action, resource, kind in expected:
            self.assertTrue(found(before, subject, action, resource, kind), "before: %s %s" % (subject, action))
            self.assertEqual(bad(after, subject), [], "after: %s" % subject)

    def test_407_helper_rule_is_what_finds_acknowledge_and_snooze(self):
        # the two functions reach the state table only through candidateIsOurs in the shared file
        before, _ = self.run_case("407")
        for subject in ("acknowledgeTile", "snoozeTile"):
            rows = found(before, subject, "dynamodb:Query", "table/talent-flow-state", "missing")
            self.assertTrue(rows and "tf-tenant" in rows[0].where, rows)

    def test_433_marketplace_is_a_warning_never_a_failure(self):
        before, after = self.run_case("433")
        self.assertTrue(found(before, "nalekoAiChat", "bedrock:InvokeModel", "", "warning"))
        self.assertEqual(bad(before, "nalekoAiChat"), [])
        self.assertEqual(found(after, "nalekoAiChat", "bedrock:InvokeModel", "", "warning"), [])

    def test_447_add_employee_could_not_save_the_sign_in(self):
        before, after = self.run_case("447")
        self.assertTrue(found(before, "createEmployee", "dynamodb:UpdateItem", "table/employees", "missing"))
        self.assertEqual(bad(after, "createEmployee"), [])

    def test_419_the_workflow_could_not_use_the_key(self):
        before, after = self.run_case("419")
        name = "workflow naleko-onboarding-flow"
        rows = found(before, name, "dynamodb:UpdateItem", "table/employees", "key missing")
        self.assertTrue(rows and "WaitForDocumentUpload" in rows[0].where, rows)
        self.assertEqual(bad(after, name), [])

    def test_fixtures_are_real_copies(self):
        import hashlib
        for src in sorted(FIX.glob("*/*/SOURCES.txt")):
            for line in src.read_text(encoding="utf-8").splitlines():
                if line.startswith("#") or not line.strip():
                    continue
                _commit, path, digest = [x.strip() for x in line.split("|")]
                data = (src.parent / (path + ".txt")).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), digest, "%s %s" % (src.parent, path))

    def test_fixture_files_are_not_code_files(self):
        # two frozen whole-repo tests (ONB-11 AC-4, MOD-01 AC-7) read code files; the copies must not look like code
        for f in FIX.rglob("*"):
            if f.is_file():
                self.assertTrue(f.name.endswith(".txt"), f)


# ---------------------------------------------------------------------------------------------
# Made-up folders
# ---------------------------------------------------------------------------------------------
BASE_TF = '''
variable "aws_region" { default = "af-south-1" }
variable "aws_account_id" { default = "111111111111" }
variable "environment" { default = "dev" }

resource "aws_dynamodb_table" "things" {
  name = "things"
  global_secondary_index { name = "by-owner" }
}
resource "aws_dynamodb_table" "locked" {
  name = "locked-things"
  server_side_encryption {
    enabled     = true
    kms_key_arn = module.kms_pii.key_arn
  }
}
'''

KEY_MOD = '''
variable "allowed_role_arns" { default = [] }
variable "read_role_arns" { default = [] }
variable "aws_account_id" {}

data "aws_iam_policy_document" "key_policy" {
  statement {
    sid    = "Root"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.aws_account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }
  dynamic "statement" {
    for_each = length(var.allowed_role_arns) > 0 ? [1] : []
    content {
      sid    = "Full"
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = var.allowed_role_arns
      }
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = ["*"]
    }
  }
  dynamic "statement" {
    for_each = length(var.read_role_arns) > 0 ? [1] : []
    content {
      sid    = "ReadViaDynamo"
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = var.read_role_arns
      }
      actions   = ["kms:Decrypt"]
      resources = ["*"]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["dynamodb.af-south-1.amazonaws.com"]
      }
    }
  }
}
resource "aws_kms_key" "this" {
  policy = data.aws_iam_policy_document.key_policy.json
}
output "key_arn" { value = aws_kms_key.this.arn }
'''


def func_tf(name, actions_json, extra_env="", resource='aws_dynamodb_table.things.arn', role_path="/x/", extra=""):
    return '''
resource "aws_iam_role" "%(n)s" {
  name = "%(n)s-role"
  path = "%(p)s"
}
resource "aws_iam_role_policy" "%(n)s" {
  role = aws_iam_role.%(n)s.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Data"
        Effect   = "Allow"
        Action   = %(a)s
        Resource = [%(r)s, "${%(r)s}/index/*"]
      },
    ]
  })
}
resource "aws_lambda_function" "%(n)s" {
  function_name = "%(n)s"
  role          = aws_iam_role.%(n)s.arn
  handler       = "index.handler"
  environment {
    variables = {
      TABLE = "things"
      %(e)s
    }
  }
}
%(x)s
''' % {"n": name, "p": role_path, "a": actions_json, "r": resource, "e": extra_env, "x": extra}


def code(body, head="import { DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';\n"):
    return head + "const db = new DynamoDBClient({});\n" + body


class Made(unittest.TestCase):
    def tree(self, files, **kw):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for rel, text in files.items():
            p = Path(tmp.name) / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        return tmp.name

    def run_check(self, files, known=None):
        return cp.analyze(self.tree(files), known)

    def one(self, name, actions, body, tf_extra="", **kw):
        files = {"infra/main.tf": BASE_TF + func_tf(name, actions, **kw) + tf_extra + 'module "kms_pii" {\n  source = "./keymod"\n  aws_account_id = var.aws_account_id\n}\n',
                 "infra/keymod/main.tf": KEY_MOD,
                 "lambda/%s/index.mjs" % name: code(body)}
        return files

    # ---- the plain rules
    def test_allowed_when_the_role_has_the_action(self):
        res = self.run_check(self.one("f", '["dynamodb:GetItem"]', "await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));"))
        self.assertEqual([f for f in res.findings if f.kind in cp.BLOCKING], [])
        self.assertEqual(res.allowed, 1)

    def test_missing_when_the_action_is_not_allowed(self):
        res = self.run_check(self.one("f", '["dynamodb:GetItem"]', "await db.send(new UpdateItemCommand({ TableName: 'things', Key: {} }));"))
        self.assertTrue(found(res, "f", "dynamodb:UpdateItem", "table/things", "missing"))

    def test_index_needs_its_own_resource(self):
        files = self.one("f", '["dynamodb:Query"]', "await db.send(new QueryCommand({ TableName: 'things', IndexName: 'by-owner' }));",
                         resource="\"arn:aws:dynamodb:af-south-1:111111111111:table/things\"")
        res = self.run_check(files)
        # the policy lists the table and table/index/*, so the index is covered
        self.assertEqual(bad(res, "f"), [])

    # ---- value shapes (section 2.3)
    def test_value_shapes(self):
        body = '''
const TABLE_A = 'things';
const FROM_ENV = process.env.TABLE ?? 'nope';
const FALLBACK = process.env.NOT_SET_ANYWHERE || 'things';
const params = { TableName: FROM_ENV, Key: {} };
await db.send(new UpdateItemCommand({ TableName: TABLE_A, Key: {} }));
await db.send(new UpdateItemCommand({ TableName: FROM_ENV, Key: {} }));
await db.send(new UpdateItemCommand({ TableName: FALLBACK, Key: {} }));
await db.send(new UpdateItemCommand(params));
await db.send(new UpdateItemCommand({ TableName: `${process.env.PREFIX}-things` }));
'''
        res = self.run_check(self.one("f", '["dynamodb:GetItem"]', body))
        missing = found(res, "f", "dynamodb:UpdateItem", "table/things", "missing")
        self.assertEqual(len(missing), 4, [f.line() for f in res.findings])
        self.assertTrue(found(res, "f", "dynamodb:UpdateItem", "", "could not judge"))

    def test_helper_one_level_is_followed_two_levels_is_not(self):
        helper = '''
export async function read(send, Cmd, table) { return send(new Cmd({ TableName: table, Key: {} })); }
'''
        body = '''
import { read } from '../shared/h.mjs';
await read((c) => db.send(c), QueryCommand, process.env.TABLE ?? 'things');
'''
        files = self.one("f", '["dynamodb:GetItem"]', body)
        files["lambda/shared/h.mjs"] = helper
        res = cp.analyze(self.tree(files))
        self.assertTrue(found(res, "f", "dynamodb:Query", "table/things", "missing"), [f.line() for f in res.findings])
        # two levels: the table name goes through two functions
        helper2 = '''
function inner(send, Cmd, table) { return send(new Cmd({ TableName: table, Key: {} })); }
export async function read(send, Cmd, table) { return inner(send, Cmd, table); }
'''
        files["lambda/shared/h.mjs"] = helper2
        res = cp.analyze(self.tree(files))
        self.assertEqual(found(res, "f", "dynamodb:Query", "table/things", "missing"), [])
        self.assertTrue([f for f in res.findings if f.subject == "f" and f.kind == "could not judge" and "more than one helper" in f.detail],
                        [f.line() for f in res.findings])

    def test_await_import_is_followed(self):
        files = self.one("f", '["dynamodb:GetItem"]', "const { go } = await import('../shared/x.mjs');\nawait go();\n")
        files["lambda/shared/x.mjs"] = code("export async function go() { await db.send(new PutItemCommand({ TableName: 'locked-things', Item: {} })); }")
        res = cp.analyze(self.tree(files))
        self.assertTrue(found(res, "f", "dynamodb:PutItem", "table/locked-things"), [f.line() for f in res.findings])
        self.assertEqual(res.count("missing") + res.count("key missing"), 2)  # table right and key right

    def test_non_literal_import_is_could_not_judge(self):
        files = self.one("f", '["dynamodb:GetItem"]', "const which = 'x';\nconst m = await import(`../shared/${which}.mjs`);\n")
        res = cp.analyze(self.tree(files))
        self.assertTrue([f for f in res.findings if f.kind == "could not judge" and "dynamic import" in f.detail])

    def test_scope_write_and_only_ours_pass_through(self):
        files = self.one("f", '["dynamodb:GetItem"]',
                         "const { scopeWrite } = require('../shared/tf-tenant.js');\n"
                         "await db.send(new UpdateItemCommand(scopeWrite({ TableName: 'things', Key: {} })));\n")
        files["lambda/f/index.mjs"] = files["lambda/f/index.mjs"].replace("const db =", "const db =", 1)
        files["lambda/shared/tf-tenant.js"] = "function scopeWrite(input) { input.ConditionExpression = 'x'; return input; }\nmodule.exports = { scopeWrite };\n"
        res = cp.analyze(self.tree(files))
        self.assertTrue(found(res, "f", "dynamodb:UpdateItem", "table/things", "missing"), [f.line() for f in res.findings])
        # a helper of the same name that is not on the list is not read through
        files["lambda/shared/tf-tenant.js"] = "function scopeWrite(input) { return input; }\nmodule.exports = { scopeWrite };\n"
        files["lambda/f/index.mjs"] = files["lambda/f/index.mjs"].replace("../shared/tf-tenant.js", "../shared/other.js")
        files["lambda/shared/other.js"] = files["lambda/shared/tf-tenant.js"]
        res = cp.analyze(self.tree(files))
        self.assertEqual(found(res, "f", "dynamodb:UpdateItem", "table/things", "missing"), [])

    # ---- keys
    def key_files(self, listed, body, who="f", actions='["dynamodb:GetItem", "dynamodb:PutItem"]'):
        main = BASE_TF + func_tf(who, actions, resource="aws_dynamodb_table.locked.arn") + '''
module "kms_pii" {
  source         = "./keymod"
  aws_account_id = var.aws_account_id
  %s
}
''' % listed
        return {"infra/main.tf": main, "infra/keymod/main.tf": KEY_MOD, "lambda/%s/index.mjs" % who: code(body)}

    def test_locked_table_needs_the_role_on_the_key(self):
        body = "await db.send(new GetItemCommand({ TableName: 'locked-things', Key: {} }));"
        res = cp.analyze(self.tree(self.key_files("", body)))
        self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/locked-things", "key missing"), [f.line() for f in res.findings])
        res = cp.analyze(self.tree(self.key_files("read_role_arns = [aws_iam_role.f.arn]", body)))
        self.assertEqual(bad(res, "f"), [])
        res = cp.analyze(self.tree(self.key_files("allowed_role_arns = [aws_iam_role.f.arn]", body)))
        self.assertEqual(bad(res, "f"), [])

    def test_a_key_list_entry_written_as_text_is_matched_to_the_role(self):
        body = "await db.send(new GetItemCommand({ TableName: 'locked-things', Key: {} }));"
        listed = 'read_role_arns = ["arn:aws:iam::${var.aws_account_id}:role/x/f-role"]'
        res = cp.analyze(self.tree(self.key_files(listed, body)))
        self.assertEqual(bad(res, "f"), [])
        listed = 'read_role_arns = ["arn:aws:iam::${var.aws_account_id}:role/other/f-role"]'
        res = cp.analyze(self.tree(self.key_files(listed, body)))
        self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/locked-things", "key missing"))

    def grant_files(self, bucket_in_grant):
        tf = BASE_TF + func_tf("f", '["s3:PutObject"]', resource='"arn:aws:s3:::up-bucket/uploads/*"') + '''
resource "aws_s3_bucket" "up" { bucket = "up-bucket" }
resource "aws_s3_bucket_server_side_encryption_configuration" "up" {
  bucket = aws_s3_bucket.up.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = module.kms_pii.key_arn
    }
  }
}
resource "aws_kms_grant" "g" {
  name              = "g"
  key_id            = module.kms_pii.key_arn
  grantee_principal = aws_iam_role.f.arn
  operations        = ["GenerateDataKey"]
  constraints {
    encryption_context_subset = {
      "aws:s3:arn" = "arn:aws:s3:::%s"
    }
  }
}
module "kms_pii" {
  source         = "./keymod"
  aws_account_id = var.aws_account_id
}
''' % bucket_in_grant
        js = "import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';\nimport { getSignedUrl } from '@aws-sdk/s3-request-presigner';\nconst s3 = new S3Client({});\n" \
             "export const handler = async (e) => getSignedUrl(s3, new PutObjectCommand({ Bucket: 'up-bucket', Key: `uploads/${e.id}` }));\n"
        return {"infra/main.tf": tf, "infra/keymod/main.tf": KEY_MOD, "lambda/f/index.mjs": js}

    def test_signed_upload_into_a_locked_bucket_needs_the_data_key_right(self):
        res = cp.analyze(self.tree(self.grant_files("up-bucket")))
        self.assertEqual(found(res, "f", "s3:PutObject", "", "key missing"), [], [f.line() for f in res.findings])
        res = cp.analyze(self.tree(self.grant_files("some-other-bucket")))
        self.assertTrue(found(res, "f", "s3:PutObject", "bucket/up-bucket", "key missing"), [f.line() for f in res.findings])

    # ---- policies written other ways (section 3.1)
    def test_policy_with_text_role_and_for_each_over_a_local_list(self):
        tf = BASE_TF + '''
resource "aws_iam_role" "a" { name = "tf-role-a" }
resource "aws_iam_role" "b" { name = "tf-role-b" }
resource "aws_lambda_function" "a" { function_name = "a"
  role = aws_iam_role.a.arn
  handler = "index.handler"
  environment { variables = { TABLE = "things" } } }
resource "aws_lambda_function" "b" { function_name = "b"
  role = aws_iam_role.b.arn
  handler = "index.handler"
  environment { variables = { TABLE = "things" } } }
locals { readers = ["a", "b"] }
resource "aws_iam_role_policy" "loop" {
  for_each = toset(local.readers)
  name     = "loop"
  role     = "tf-role-${each.key}"
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.things.arn }] })
}
'''
        body = "await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));"
        files = {"infra/main.tf": tf, "lambda/a/index.mjs": code(body), "lambda/b/index.mjs": code(body)}
        res = cp.analyze(self.tree(files))
        self.assertEqual([f for f in res.findings if f.kind in cp.BLOCKING], [], [f.line() for f in res.findings])
        self.assertEqual(res.allowed, 2)

    def test_unreadable_for_each_is_never_missing(self):
        tf = BASE_TF + '''
resource "aws_iam_role" "a" { name = "tf-role-a" }
resource "aws_lambda_function" "a" { function_name = "a"
  role = aws_iam_role.a.arn
  handler = "index.handler"
  environment { variables = { TABLE = "things" } } }
resource "aws_iam_role_policy" "loop" {
  for_each = var.names_from_somewhere_else
  role     = "tf-role-${each.key}"
  policy   = jsonencode({ Statement = [] })
}
'''
        files = {"infra/main.tf": tf, "lambda/a/index.mjs": code("await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));")}
        res = cp.analyze(self.tree(files))
        self.assertEqual([f for f in res.findings if f.kind in cp.BLOCKING], [])
        self.assertTrue(found(res, "a", "dynamodb:GetItem", "table/things", "could not judge"), [f.line() for f in res.findings])

    def test_count_on_the_environment_is_worked_out_for_dev(self):
        tf = BASE_TF + '''
resource "aws_iam_role" "a" { name = "a-role" }
resource "aws_lambda_function" "a" { function_name = "a"
  role = aws_iam_role.a.arn
  handler = "index.handler"
  environment { variables = { TABLE = "things" } } }
resource "aws_iam_role_policy" "devonly" {
  count  = var.environment == "dev" ? 1 : 0
  role   = aws_iam_role.a.name
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.things.arn }] })
}
'''
        files = {"infra/main.tf": tf, "lambda/a/index.mjs": code("await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));")}
        self.assertEqual(cp.analyze(self.tree(files)).allowed, 1)

    def test_unknown_condition_is_could_not_judge(self):
        tf = BASE_TF + '''
resource "aws_iam_role" "a" { name = "a-role" }
resource "aws_lambda_function" "a" { function_name = "a"
  role = aws_iam_role.a.arn
  handler = "index.handler"
  environment { variables = { TABLE = "things" } } }
resource "aws_iam_role_policy" "p" {
  role   = aws_iam_role.a.name
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.things.arn,
                                       Condition = { StringEquals = { "aws:RequestTag/x" = "y" } } }] })
}
'''
        files = {"infra/main.tf": tf, "lambda/a/index.mjs": code("await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));")}
        res = cp.analyze(self.tree(files))
        self.assertEqual([f for f in res.findings if f.kind in cp.BLOCKING], [])
        self.assertTrue(found(res, "a", "dynamodb:GetItem", "table/things", "could not judge"))

    # ---- queues and the model warning and workflows
    def queue_files(self, listed):
        tf = BASE_TF + func_tf("f", '["sqs:SendMessage"]', resource='"arn:aws:sqs:af-south-1:111111111111:jobs"') + '''
resource "aws_sqs_queue" "jobs" {
  name              = "jobs"
  kms_master_key_id = module.kms_pii.key_arn
}
module "kms_pii" {
  source         = "./keymod"
  aws_account_id = var.aws_account_id
  %s
}
''' % listed
        js = "import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';\nconst q = new SQSClient({});\n" \
             "export const handler = async () => q.send(new SendMessageCommand({ QueueUrl: 'https://sqs.af-south-1.amazonaws.com/111111111111/jobs', MessageBody: 'x' }));\n"
        return {"infra/main.tf": tf, "infra/keymod/main.tf": KEY_MOD, "lambda/f/index.mjs": js}

    def test_send_to_a_locked_queue_with_and_without_the_key_right(self):
        res = cp.analyze(self.tree(self.queue_files("")))
        self.assertTrue(found(res, "f", "sqs:SendMessage", "queue/jobs", "key missing"), [f.line() for f in res.findings])
        res = cp.analyze(self.tree(self.queue_files("allowed_role_arns = [aws_iam_role.f.arn]")))
        self.assertEqual(bad(res, "f"), [])

    def test_workflow_task_is_a_call_with_the_workflows_role(self):
        tf = BASE_TF + '''
resource "aws_iam_role" "sfn" { name = "sfn-role" }
resource "aws_iam_role_policy" "p" {
  role   = aws_iam_role.sfn.name
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = ["dynamodb:PutItem"], Resource = aws_dynamodb_table.things.arn }] })
}
resource "aws_sfn_state_machine" "m" {
  name     = "m"
  role_arn = aws_iam_role.sfn.arn
  definition = jsonencode({
    StartAt = "A"
    States = {
      A = { Type = "Task", Resource = "arn:aws:states:::aws-sdk:dynamodb:updateItem.waitForTaskToken", Parameters = { TableName = "things" }, Next = "B" }
      B = { Type = "Parallel", End = true, Branches = [{ StartAt = "C", States = { C = { Type = "Task", Resource = "arn:aws:states:::dynamodb:putItem", Parameters = { TableName = "things" }, End = true } } }] }
    }
  })
}
'''
        res = cp.analyze(self.tree({"infra/main.tf": tf}))
        self.assertTrue(found(res, "workflow m", "dynamodb:UpdateItem", "table/things", "missing"), [f.line() for f in res.findings])
        self.assertEqual(found(res, "workflow m", "dynamodb:PutItem", "table/things", "missing"), [])
        self.assertEqual(res.workflows, 1)

    # ---- never a silent pass
    def test_a_function_without_code_is_could_not_judge(self):
        tf = BASE_TF + func_tf("g", '["dynamodb:GetItem"]')
        res = cp.analyze(self.tree({"infra/main.tf": tf, "lambda/g/readme.txt": "x"}))
        self.assertTrue([f for f in res.findings if f.subject == "g" and f.kind == "could not judge"], [f.line() for f in res.findings])

    # ---- exceptions
    def test_exception_with_a_reason_accepts_one_finding_only(self):
        res = self.run_check(self.one("f", '["dynamodb:GetItem"]', "await db.send(new UpdateItemCommand({ TableName: 'things', Key: {} }));\n"
                                      "await db.send(new PutItemCommand({ TableName: 'things', Item: {} }));"))
        exc = cp.Exceptions("[exceptions]\nf | dynamodb:UpdateItem | table/things | dead branch | never: removed soon | 2026-11-20\n")
        exc.apply(res.findings)
        self.assertTrue(found(res, "f", "dynamodb:UpdateItem", "table/things", "accepted"))
        self.assertTrue(found(res, "f", "dynamodb:PutItem", "table/things", "missing"))

    def test_exception_without_a_reason_is_an_error(self):
        exc = cp.Exceptions("[exceptions]\nf | dynamodb:UpdateItem | table/things |  | card | 2026-11-20\n")
        self.assertEqual(exc.entries, [])
        self.assertTrue(exc.errors)

    # ---- running it: modes, the target branch, crashes
    def git_repo(self, files_base, files_pr):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = Path(tmp.name)

        def git(*a):
            subprocess.run(["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@example.test", *a], check=True, capture_output=True)

        git("init", "-q", "-b", "base")
        for rel, text in files_base.items():
            (d / rel).parent.mkdir(parents=True, exist_ok=True)
            (d / rel).write_text(text, encoding="utf-8")
        git("add", "-A")
        git("commit", "-q", "-m", "base")
        git("checkout", "-q", "-b", "pr")
        for rel, text in files_pr.items():
            (d / rel).parent.mkdir(parents=True, exist_ok=True)
            (d / rel).write_text(text, encoding="utf-8")
        git("add", "-A")
        git("commit", "-q", "--allow-empty", "-m", "pr")
        return d

    def cli(self, *args):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code_ = cp.main(list(args))
        return code_, buf.getvalue()

    def test_only_findings_new_on_this_change_block_in_enforce_mode(self):
        old_gap = "await db.send(new UpdateItemCommand({ TableName: 'things', Key: {} }));\n"
        files = self.one("f", '["dynamodb:GetItem"]', old_gap)
        pr = dict(files)
        pr["lambda/f/index.mjs"] = code(old_gap)
        repo = self.git_repo(files, {})
        # no new finding: the gap is on the base branch already, printed but not blocking
        c, out = self.cli("--root", str(repo), "--mode", "enforce", "--base-ref", "base", "--summary", "")
        self.assertEqual(c, 0, out)
        self.assertIn("[already on the base branch]", out)
        # a new gap in the change blocks
        pr["lambda/f/index.mjs"] = code(old_gap + "await db.send(new PutItemCommand({ TableName: 'things', Item: {} }));\n")
        repo = self.git_repo(files, pr)
        c, out = self.cli("--root", str(repo), "--mode", "enforce", "--base-ref", "base", "--summary", "")
        self.assertEqual(c, 1, out)
        self.assertIn("dynamodb:PutItem", out)

    def test_report_mode_never_fails_and_ends_with_the_counts(self):
        files = self.one("f", '["dynamodb:GetItem"]', "await db.send(new UpdateItemCommand({ TableName: 'things', Key: {} }));")
        repo = self.git_repo(files, {})
        c, out = self.cli("--root", str(repo), "--mode", "report", "--summary", "")
        self.assertEqual(c, 0)
        self.assertIn("functions read: 1", out)
        self.assertIn("could not judge:", out)

    def test_no_base_branch_means_report_mode_even_when_enforce_is_asked(self):
        files = self.one("f", '["dynamodb:GetItem"]', "await db.send(new UpdateItemCommand({ TableName: 'things', Key: {} }));")
        repo = self.git_repo(files, {})
        c, out = self.cli("--root", str(repo), "--mode", "enforce", "--base-ref", "", "--summary", "")
        self.assertEqual(c, 0, out)
        self.assertIn("report mode", out)

    def test_a_crash_is_loud_and_exits_zero_in_report_mode_two_in_enforce(self):
        files = self.one("f", '["dynamodb:GetItem"]', "x")
        repo = self.git_repo(files, {})
        orig = cp.analyze
        cp.analyze = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            c, out = self.cli("--root", str(repo), "--mode", "report", "--summary", "")
            self.assertEqual(c, 0)
            self.assertIn("permission check could not run: RuntimeError: boom", out)
            c, out = self.cli("--root", str(repo), "--mode", "enforce", "--base-ref", "base", "--summary", "")
            self.assertEqual(c, 2)
        finally:
            cp.analyze = orig

    def test_exceptions_file_comes_from_the_path_given_not_from_the_change(self):
        files = self.one("f", '["dynamodb:GetItem"]', "await db.send(new UpdateItemCommand({ TableName: 'things', Key: {} }));")
        repo = self.git_repo({k: v for k, v in files.items()}, {"scripts/ci/permission-check-exceptions.txt":
                                                              "[exceptions]\nf | dynamodb:UpdateItem | table/things | silenced by the change | never: x | 2026-11-20\n"})
        base_copy = Path(tempfile.mkdtemp()) / "exceptions.txt"
        base_copy.write_text("[exceptions]\n", encoding="utf-8")  # the target branch's list: empty
        c, out = self.cli("--root", str(repo), "--mode", "enforce", "--base-ref", "base", "--exceptions", str(base_copy), "--summary", "")
        self.assertIn("MISSING", out)
        self.assertIn("edits the exceptions file", out)

    def test_script_makes_no_network_or_aws_call(self):
        text = (HERE / "check-permissions.py").read_text(encoding="utf-8")
        for word in ("boto3", "urllib", "import socket", "import requests", "http.client"):
            self.assertNotIn(word, text)

# ---------------------------------------------------------------------------------------------
# Step 4b: curing "could not judge" (process/pipeline-specs/STEP-4B-permission-check-cure-spec.md).
# P1 to P14 are the planted faults of the spec's section 4; the replays are at the end.
# ---------------------------------------------------------------------------------------------
OTHER_TF = 'resource "aws_dynamodb_table" "other" {\n  name = "other-things"\n}\n'
DDB_HEAD = "import { DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';\n" \
           "const db = new DynamoDBClient({});\n"


def line_no(text, needle, nth=1):
    i = -1
    for _ in range(nth):
        i = text.index(needle, i + 1)
    return text.count("\n", 0, i) + 1


def counts_line(out):
    rows = [x for x in out.splitlines() if x.startswith("functions read:")]
    assert len(rows) == 1, out
    return rows[0]


def section(out, heading):
    """The lines under a heading line of the report, up to the next blank line or the counts line."""
    lines = out.splitlines()
    for i, x in enumerate(lines):
        if x.strip() == heading:
            rows = []
            for y in lines[i + 1:]:
                if not y.strip() or y.startswith("functions read:") or y.startswith("## "):
                    break
                rows.append(y)
            return i, rows
    return None, []


class Cure(unittest.TestCase):
    """Made-up folders for the step 4b rules. Function f; its role reads table "things" only."""
    tree = Made.tree
    one = Made.one
    git_repo = Made.git_repo
    cli = Made.cli

    def ftree(self, body, actions='["dynamodb:GetItem", "dynamodb:PutItem"]', shared=None, env='T_OTHER = "other-things"',
              resource="aws_dynamodb_table.things.arn", tf_extra="", index_name="index.mjs", head=DDB_HEAD):
        files = {"infra/main.tf": BASE_TF + OTHER_TF + func_tf("f", actions, extra_env=env, resource=resource) + tf_extra
                 + 'module "kms_pii" {\n  source = "./keymod"\n  aws_account_id = var.aws_account_id\n}\n',
                 "infra/keymod/main.tf": KEY_MOD,
                 "lambda/f/%s" % index_name: head + body}
        for rel, text in (shared or {}).items():
            files[rel] = text
        return files

    def check(self, files):
        return cp.analyze(self.tree(files))

    def report(self, files, *extra):
        return self.cli("--root", self.tree(files), "--mode", "report", "--summary", "", *extra)

    def lines(self, res):
        return [f.line() for f in res.findings]

    def cnj(self, res, subject, action):
        return [f for f in res.findings if f.subject == subject and f.action == action and f.kind == "could not judge"]

    # ---- P1, P2: a setting read through a tiny function
    def test_p1_arrow_getter_is_read(self):
        body = "const T = () => process.env.T_OTHER ?? 'x';\nexport const handler = async () => db.send(new GetItemCommand({ TableName: T(), Key: {} }));\n"
        res = self.check(self.ftree(body))
        self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/other-things", "missing"), self.lines(res))
        res = self.check(self.ftree(body, resource="aws_dynamodb_table.other.arn"))
        self.assertEqual([f for f in res.findings if f.subject == "f"], [], self.lines(res))
        self.assertEqual(res.allowed, 1)

    def test_p2_guarded_getter_is_read(self):
        for guard in ("  if (!t) throw new Error('Missing setting T_OTHER');\n", ""):
            body = ("const T = () => {\n  const t = process.env.T_OTHER;\n" + guard + "  return t;\n};\n"
                    "export const handler = async () => db.send(new GetItemCommand({ TableName: T(), Key: {} }));\n")
            res = self.check(self.ftree(body))
            self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/other-things", "missing"), (guard, self.lines(res)))
            res = self.check(self.ftree(body, resource="aws_dynamodb_table.other.arn"))
            self.assertEqual([f for f in res.findings if f.subject == "f"], [], (guard, self.lines(res)))
            self.assertEqual(res.allowed, 1)

    def test_p3_other_getter_bodies_stay_could_not_judge(self):
        bodies = [
            # two settings
            "const T = () => {\n  const a = process.env.T_OTHER;\n  const b = process.env.TABLE;\n  return a || b;\n};\n",
            # another call
            "function pick(n) { return process.env[n]; }\nconst T = () => pick('T_OTHER');\n",
            # a choice between two names, as an arrow and as a body
            "const T = () => (process.env.S === 'prod' ? 'other-things' : 'things');\n",
            "const T = () => {\n  return process.env.S === 'prod' ? 'other-things' : 'things';\n};\n",
            # one more statement in the guarded shape
            "const T = () => {\n  const t = process.env.T_OTHER;\n  console.log(t);\n  return t;\n};\n",
        ]
        for b in bodies:
            body = b + "export const handler = async () => db.send(new GetItemCommand({ TableName: T(), Key: {} }));\n"
            for resource in ("aws_dynamodb_table.things.arn", "aws_dynamodb_table.other.arn"):
                res = self.check(self.ftree(body, env='T_OTHER = "other-things"\n      S = "prod"', resource=resource))
                self.assertTrue(self.cnj(res, "f", "dynamodb:GetItem"), (b, self.lines(res)))
                self.assertEqual(bad(res, "f"), [], (b, self.lines(res)))
                self.assertEqual(res.allowed, 0, (b, self.lines(res)))

    # ---- P4: requireSetting and a constant from another file
    def test_p4_require_setting_and_imported_constant(self):
        rs = "function requireSetting(name) {\n  const v = process.env[name];\n  if (!v) throw new Error(`Missing setting ${name}`);\n  return v;\n}\n"
        body = rs + "export const handler = async () => db.send(new GetItemCommand({ TableName: requireSetting('T_OTHER'), Key: {} }));\n"
        res = self.check(self.ftree(body))
        self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/other-things", "missing"), self.lines(res))
        names = "export const OTHER_TABLE = process.env.T_OTHER ?? 'other-things';\nexport const PLAIN = 'other-things';\n"
        for nm in ("OTHER_TABLE", "PLAIN"):
            body = "import { %s } from '../shared/names.mjs';\nexport const handler = async () => db.send(new GetItemCommand({ TableName: %s, Key: {} }));\n" % (nm, nm)
            res = self.check(self.ftree(body, shared={"lambda/shared/names.mjs": names}))
            self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/other-things", "missing"), (nm, self.lines(res)))

    def test_p4_only_a_requireSetting_of_the_same_file_and_never_a_package(self):
        # requireSetting brought in from elsewhere: not read
        body = ("import { requireSetting } from '../shared/settings.mjs';\n"
                "export const handler = async () => db.send(new GetItemCommand({ TableName: requireSetting('T_OTHER'), Key: {} }));\n")
        res = self.check(self.ftree(body, shared={"lambda/shared/settings.mjs": "export function requireSetting(n) { return process.env[n] ?? 'things'; }\n"}))
        self.assertTrue(self.cnj(res, "f", "dynamodb:GetItem"), self.lines(res))
        self.assertEqual(bad(res, "f"), [])
        # a constant from a package: never followed
        body = "import { OTHER_TABLE } from 'some-package';\nexport const handler = async () => db.send(new GetItemCommand({ TableName: OTHER_TABLE, Key: {} }));\n"
        res = self.check(self.ftree(body))
        self.assertTrue(self.cnj(res, "f", "dynamodb:GetItem"), self.lines(res))

    # ---- P5, P6, P6b: the name is handed in by the caller
    PUT_HELPER = DDB_HEAD + "export async function putRow(table, item) {\n  await db.send(new PutItemCommand({ TableName: table, Item: item }));\n}\n"

    def test_p5_two_callers_two_tables(self):
        body = ("import { putRow } from '../shared/put.mjs';\n"
                "export async function one() { await putRow(process.env.TABLE, {}); }\n"
                "export async function two() { await putRow('other-things', {}); }\n"
                "export const handler = async (e) => (e.x ? one() : two());\n")
        files = self.ftree(body, shared={"lambda/shared/put.mjs": self.PUT_HELPER})
        res = self.check(files)
        rows = found(res, "f", "dynamodb:PutItem", "table/other-things", "missing")
        self.assertEqual(len(rows), 1, self.lines(res))
        caller = "lambda/f/index.mjs:%d" % line_no(files["lambda/f/index.mjs"], "putRow('other-things'")
        self.assertIn(caller, rows[0].line(), "the MISSING line names the caller's line")
        self.assertEqual(found(res, "f", "dynamodb:PutItem", "table/things", "missing"), [])
        self.assertEqual(self.cnj(res, "f", "dynamodb:PutItem"), [], self.lines(res))
        self.assertEqual(res.allowed, 1, "the caller passing \"things\" is judged allowed")

    def test_p6_one_caller_passes_a_name_from_the_request(self):
        body = ("import { putRow } from '../shared/put.mjs';\n"
                "export async function one() { await putRow(process.env.TABLE, {}); }\n"
                "export async function three(e) { await putRow(e.body.table, {}); }\n"
                "export const handler = async (e) => (e.x ? one() : three(e));\n")
        res = self.check(self.ftree(body, shared={"lambda/shared/put.mjs": self.PUT_HELPER}))
        self.assertTrue(self.cnj(res, "f", "dynamodb:PutItem"), self.lines(res))
        self.assertEqual(found(res, "f", "dynamodb:PutItem", "", "missing"), [], self.lines(res))

    def test_p6b_a_caller_the_handler_never_reaches_says_nothing(self):
        callers = ("import { putRow } from './put.mjs';\n"
                   "export async function one() { await putRow(process.env.TABLE, {}); }\n"
                   "export async function four() { await putRow('other-things', {}); }\n")
        body = "import { one } from '../shared/callers.mjs';\nexport const handler = async () => one();\n"
        res = self.check(self.ftree(body, shared={"lambda/shared/put.mjs": self.PUT_HELPER, "lambda/shared/callers.mjs": callers}))
        self.assertEqual(found(res, "f", "dynamodb:PutItem", "table/other-things"), [], self.lines(res))
        self.assertEqual(self.cnj(res, "f", "dynamodb:PutItem"), [], self.lines(res))
        self.assertEqual(res.allowed, 1, self.lines(res))

    # ---- P7: reached means called from the handler, never "imported somewhere"
    S_FILE = (DDB_HEAD + "export async function a() {\n  await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));\n}\n"
              "export async function b() {\n  await db.send(new PutItemCommand({ TableName: 'other-things', Item: {} }));\n}\n")

    def b_missing(self, res):
        return found(res, "f", "dynamodb:PutItem", "table/other-things", "missing")

    def not_reached_rows(self, out):
        i, rows = section(out, "not reached, not judged:")
        self.assertIsNotNone(i, out)
        lines = out.splitlines()
        self.assertLess(i, lines.index(counts_line(out)), "the list is above the counts line")
        last_finding = max([k for k, x in enumerate(lines) if x.startswith("## ")] or [-1])
        self.assertGreater(i, last_finding, "the list is below the findings")
        return rows

    def test_p7_a_sibling_never_called_is_not_judged_and_is_listed(self):
        body = "import { a } from '../shared/s.mjs';\nexport const handler = async () => a();\n"
        files = self.ftree(body, shared={"lambda/shared/s.mjs": self.S_FILE})
        res = self.check(files)
        self.assertEqual(found(res, "f", "dynamodb:PutItem"), [], self.lines(res))
        _c, out = self.report(files)
        where = "lambda/shared/s.mjs:%d" % line_no(self.S_FILE, "new PutItemCommand")
        rows = [r for r in self.not_reached_rows(out) if where in r]
        self.assertEqual(len(rows), 1, out)
        self.assertIn("f", rows[0].split())
        self.assertIn("dynamodb:PutItem", rows[0])
        # a calls b: now b is reached
        s2 = self.S_FILE.replace("TableName: 'things', Key: {} }));\n}", "TableName: 'things', Key: {} }));\n  await b();\n}", 1)
        res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": s2}))
        self.assertTrue(self.b_missing(res), self.lines(res))
        # a calls b only inside a callback: still reached (lock check round 1, R1)
        for cb in ("  await Promise.all([1].map(async (x) => { await b(x); }));\n",
                   "  [1].forEach(function (x) { b(x); });\n",
                   "  const go = async () => { await b(); };\n  await go();\n"):
            s3 = self.S_FILE.replace("TableName: 'things', Key: {} }));\n}", "TableName: 'things', Key: {} }));\n" + cb + "}", 1)
            res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": s3}))
            self.assertTrue(self.b_missing(res), (cb, self.lines(res)))

    def test_p7_imported_by_a_shared_function_nobody_calls(self):
        # the old fault behind the four false MISSING: s1 imports b for c, but nothing calls c
        s1 = (DDB_HEAD + "import { b } from './s2.mjs';\n"
              "export async function a() {\n  await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));\n}\n"
              "export async function c() {\n  await b();\n}\n")
        s2 = DDB_HEAD + "export async function b() {\n  await db.send(new PutItemCommand({ TableName: 'other-things', Item: {} }));\n}\n"
        body = "import { a } from '../shared/s1.mjs';\nexport const handler = async () => a();\n"
        files = self.ftree(body, shared={"lambda/shared/s1.mjs": s1, "lambda/shared/s2.mjs": s2})
        res = self.check(files)
        self.assertEqual(found(res, "f", "dynamodb:PutItem"), [], self.lines(res))
        _c, out = self.report(files)
        where = "lambda/shared/s2.mjs:%d" % line_no(s2, "new PutItemCommand")
        self.assertTrue([r for r in self.not_reached_rows(out) if where in r and "dynamodb:PutItem" in r], out)
        # the handler calls c: MISSING
        body = "import { a, c } from '../shared/s1.mjs';\nexport const handler = async () => { await a(); await c(); };\n"
        res = self.check(self.ftree(body, shared={"lambda/shared/s1.mjs": s1, "lambda/shared/s2.mjs": s2}))
        self.assertTrue(self.b_missing(res), self.lines(res))

    def test_p7a_namespace_imports_never_silence(self):
        for body in ("import * as S from '../shared/s.mjs';\nexport const handler = async () => { await S.a(); await S.b(); };\n",
                     "export const handler = async () => {\n  const RA = await import('../shared/s.mjs');\n  await RA.b();\n};\n",
                     "import * as S from '../shared/s.mjs';\nconst pick = (n) => S[n];\nexport const handler = async (e) => pick(e.n)();\n"):
            res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": self.S_FILE}))
            self.assertTrue(self.b_missing(res), (body, self.lines(res)))

    def test_p7b_promise_all_import_is_tied_by_position(self):
        # like recruitment-actions/roles.mjs before PR 485: a package first, then two relative files
        t = (DDB_HEAD + "export async function b() {\n  await db.send(new PutItemCommand({ TableName: 'other-things', Item: {} }));\n}\n"
             "export async function z() {\n  await db.send(new UpdateItemCommand({ TableName: 'other-things', Key: {} }));\n}\n")
        body = ("export const handler = async () => {\n"
                "  const [{ randomUUID }, { a }, { b }] = await Promise.all([\n"
                "    import('node:crypto'), import('../shared/s.mjs'), import('../shared/t.mjs'),\n  ]);\n"
                "  await a();\n  await b();\n};\n")
        res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": self.S_FILE, "lambda/shared/t.mjs": t}))
        self.assertTrue(self.b_missing(res), self.lines(res))
        self.assertEqual(found(res, "f", "dynamodb:UpdateItem"), [], "z is never called: " + "\n".join(self.lines(res)))
        # a shape it cannot tie (no destructuring): everything counts
        body2 = ("export const handler = async () => {\n"
                 "  const mods = await Promise.all([import('../shared/t.mjs')]);\n  return mods.length;\n};\n")
        res = self.check(self.ftree(body2, shared={"lambda/shared/t.mjs": t}))
        self.assertTrue(found(res, "f", "dynamodb:UpdateItem", "table/other-things", "missing"), self.lines(res))

    def test_p7c_lazy_loader_counts_everything(self):
        lazy = ("let loaded;\nconst load = () => {\n  if (!loaded) loaded = import('./s.mjs');\n  return loaded;\n};\n"
                "export async function go() {\n  const m = await load();\n  return m.a();\n}\n")
        body = "import { go } from '../shared/lazy.mjs';\nexport const handler = async () => go();\n"
        res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": self.S_FILE, "lambda/shared/lazy.mjs": lazy}))
        self.assertTrue(self.b_missing(res), self.lines(res))

    def test_p7d_re_export_is_followed(self):
        for re_file in ("export { b } from './s.mjs';\n", "export * from './s.mjs';\n", "export { b as put } from './s.mjs';\n"):
            name = "put" if "as put" in re_file else "b"
            body = "import { %s } from '../shared/re.mjs';\nexport const handler = async () => %s();\n" % (name, name)
            res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": self.S_FILE, "lambda/shared/re.mjs": re_file}))
            self.assertTrue(self.b_missing(res), (re_file, self.lines(res)))

    def test_p7d_default_import_never_silences(self):
        d = DDB_HEAD + "export default async function run() {\n  await db.send(new PutItemCommand({ TableName: 'other-things', Item: {} }));\n}\n"
        body = "import run from '../shared/d.mjs';\nexport const handler = async () => run();\n"
        res = self.check(self.ftree(body, shared={"lambda/shared/d.mjs": d}))
        self.assertTrue(self.b_missing(res), self.lines(res))

    def test_p7e_require_never_silences(self):
        s_cjs = ("const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');\nconst db = new DynamoDBClient({});\n"
                 "async function a() {\n  await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));\n}\n"
                 "async function b() {\n  await db.send(new PutItemCommand({ TableName: 'other-things', Item: {} }));\n}\n"
                 "module.exports = { a, b };\n")
        head = "const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');\n"
        for body in ("const S = require('../shared/s.js');\nexports.handler = async () => S.b();\n",
                     "const { b } = require('../shared/s.js');\nexports.handler = async () => b();\n",
                     "require('../shared/s.js');\nexports.handler = async () => null;\n"):
            res = self.check(self.ftree(body, shared={"lambda/shared/s.js": s_cjs}, index_name="index.js", head=head))
            self.assertTrue(self.b_missing(res), (body, self.lines(res)))

    def test_p7f_a_function_passed_as_a_value_counts(self):
        s2 = self.S_FILE.replace("TableName: 'things', Key: {} }));\n}", "TableName: 'things', Key: {} }));\n  await Promise.all([1].map(b));\n}", 1)
        body = "import { a } from '../shared/s.mjs';\nexport const handler = async () => a();\n"
        res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": s2}))
        self.assertTrue(self.b_missing(res), self.lines(res))
        body = "import { b } from '../shared/s.mjs';\nexport const handler = async () => Promise.all([1, 2].map(b));\n"
        res = self.check(self.ftree(body, shared={"lambda/shared/s.mjs": self.S_FILE}))
        self.assertTrue(self.b_missing(res), self.lines(res))

    def test_p7g_top_level_code_always_counts(self):
        top = DDB_HEAD + "await db.send(new PutItemCommand({ TableName: 'other-things', Item: {} }));\nexport const a = 1;\n"
        for body in ("import { a } from '../shared/top.mjs';\nexport const handler = async () => a;\n",
                     "import '../shared/top.mjs';\nexport const handler = async () => null;\n"):
            res = self.check(self.ftree(body, shared={"lambda/shared/top.mjs": top}))
            self.assertTrue(self.b_missing(res), (body, self.lines(res)))

    def test_p7h_brace_less_exported_arrow(self):
        roles = (DDB_HEAD + "async function helper(id) {\n  await db.send(new PutItemCommand({ TableName: 'other-things', Item: { id } }));\n}\n"
                 "export const x = (id) => helper(id);\n"
                 "export const y = async (id) => helper(id);\n"
                 "export const w = id => helper(id);\n")
        for nm in ("x", "y", "w"):
            body = "import { %s } from '../shared/roles.mjs';\nexport const handler = async (e) => %s(e.id);\n" % (nm, nm)
            res = self.check(self.ftree(body, shared={"lambda/shared/roles.mjs": roles}))
            self.assertTrue(self.b_missing(res), (nm, self.lines(res)))

    def test_p7h_brace_less_arrow_nobody_calls_is_not_reached(self):
        # the shape of candidatesOfRole: an exported brace-less arrow; its body is not top-level code
        roles = (DDB_HEAD + "async function helper(id) {\n  await db.send(new PutItemCommand({ TableName: 'other-things', Item: { id } }));\n}\n"
                 "async function helper2(id) {\n  await db.send(new UpdateItemCommand({ TableName: 'other-things', Key: { id } }));\n}\n"
                 "export const x = (id) => helper(id);\n"
                 "export const v = id => helper2(id);\n"
                 "export async function a() {\n  await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));\n}\n")
        body = "import { a } from '../shared/roles.mjs';\nexport const handler = async () => a();\n"
        res = self.check(self.ftree(body, shared={"lambda/shared/roles.mjs": roles}))
        self.assertEqual(found(res, "f", "dynamodb:PutItem"), [], self.lines(res))
        self.assertEqual(found(res, "f", "dynamodb:UpdateItem"), [], self.lines(res))

    # ---- P8: HeadObject is judged as s3:GetObject; other S3 names
    S3_TF = 'resource "aws_s3_bucket" "docs" { bucket = "docs-bucket" }\n'
    S3_HEAD = ("import { S3Client, HeadObjectCommand, ListObjectsV2Command, HeadBucketCommand, CopyObjectCommand } from '@aws-sdk/client-s3';\n"
               "const s3 = new S3Client({});\n")

    def s3tree(self, body, actions='["s3:GetObject"]', resource='"arn:aws:s3:::docs-bucket/recruitment/*"'):
        files = self.ftree(body, actions=actions, resource=resource, tf_extra=self.S3_TF, head=self.S3_HEAD)
        return files

    def test_p8a_head_object_readable_key_under_the_prefix_is_allowed(self):
        body = "export const handler = async () => s3.send(new HeadObjectCommand({ Bucket: 'docs-bucket', Key: 'recruitment/offer.pdf' }));\n"
        res = self.check(self.s3tree(body))
        self.assertEqual([f for f in res.findings if f.subject == "f"], [], self.lines(res))
        self.assertEqual(res.allowed, 1)

    def test_p8b_head_object_key_from_the_request_is_could_not_judge(self):
        body = "export const handler = async (e) => s3.send(new HeadObjectCommand({ Bucket: 'docs-bucket', Key: e.body.signed_key }));\n"
        res = self.check(self.s3tree(body))
        rows = self.cnj(res, "f", "s3:GetObject")
        self.assertEqual(len(rows), 1, self.lines(res))
        self.assertIn("object key", rows[0].detail)
        self.assertEqual(bad(res, "f"), [])
        self.assertEqual([f for f in res.findings if f.action == "s3:HeadObject"], [])

    def test_p8c_head_object_without_get_object_is_missing(self):
        body = "export const handler = async () => s3.send(new HeadObjectCommand({ Bucket: 'docs-bucket', Key: 'recruitment/offer.pdf' }));\n"
        res = self.check(self.s3tree(body, actions='["s3:PutObject"]'))
        self.assertTrue(found(res, "f", "s3:GetObject", "bucket/docs-bucket", "missing"), self.lines(res))
        self.assertEqual([f for f in res.findings if f.action == "s3:HeadObject"], [])

    def test_p8_other_s3_names(self):
        body = ("export const handler = async () => {\n"
                "  await s3.send(new ListObjectsV2Command({ Bucket: 'docs-bucket', Prefix: 'recruitment/' }));\n"
                "  await s3.send(new HeadBucketCommand({ Bucket: 'docs-bucket' }));\n};\n")
        res = self.check(self.s3tree(body, actions='["s3:ListBucket"]', resource='"arn:aws:s3:::docs-bucket"'))
        self.assertEqual([f for f in res.findings if f.subject == "f"], [], self.lines(res))
        self.assertEqual(res.allowed, 2)
        body = "export const handler = async () => s3.send(new CopyObjectCommand({ Bucket: 'docs-bucket', Key: 'recruitment/b.pdf', CopySource: 'docs-bucket/recruitment/a.pdf' }));\n"
        res = self.check(self.s3tree(body))
        self.assertTrue(found(res, "f", "s3:PutObject", "bucket/docs-bucket", "missing"), self.lines(res))
        self.assertEqual([f for f in res.findings if f.action == "s3:CopyObject"], [])
        # the copy's source outside what the role may read: MISSING s3:GetObject
        body = "export const handler = async () => s3.send(new CopyObjectCommand({ Bucket: 'docs-bucket', Key: 'recruitment/b.pdf', CopySource: 'docs-bucket/private/a.pdf' }));\n"
        res = self.check(self.s3tree(body, actions='["s3:GetObject", "s3:PutObject"]'))
        self.assertTrue(found(res, "f", "s3:GetObject", "bucket/docs-bucket", "missing"), self.lines(res))
        self.assertEqual(found(res, "f", "s3:PutObject", "", "missing"), [], self.lines(res))

    # ---- P11: the role carries its own key right
    def own_key_files(self, via="dynamodb.af-south-1.amazonaws.com", root=True):
        own = '''
resource "aws_iam_role_policy" "f_key" {
  role = aws_iam_role.f.name
  policy = jsonencode({
    Statement = [{ Effect = "Allow", Action = ["kms:Decrypt"], Resource = module.kms_pii.key_arn,
                   Condition = { StringEquals = { "kms:ViaService" = "%s" } } }]
  })
}
''' % via
        files = self.ftree("export const handler = async () => db.send(new GetItemCommand({ TableName: 'locked-things', Key: {} }));\n",
                           resource="aws_dynamodb_table.locked.arn", tf_extra=own)
        if not root:
            km = KEY_MOD
            start = km.index('  statement {\n    sid    = "Root"')
            end = km.index("  dynamic", start)
            files["infra/keymod/main.tf"] = km[:start] + km[end:]
        return files

    def test_p11_role_carries_its_own_key_right(self):
        res = self.check(self.own_key_files())
        self.assertEqual([f for f in res.findings if f.subject == "f"], [], self.lines(res))
        self.assertEqual(res.allowed, 1)
        res = self.check(self.own_key_files(root=False))
        self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/locked-things", "key missing"), self.lines(res))
        res = self.check(self.own_key_files(via="s3.af-south-1.amazonaws.com"))
        self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/locked-things", "key missing"), self.lines(res))

    # ---- P12: a property of a same-file object
    def test_p12_config_property(self):
        rs = "function requireSetting(name) {\n  const v = process.env[name];\n  if (!v) throw new Error(name);\n  return v;\n}\n"
        body = rs + ("const config = { chatsTable: requireSetting('T_OTHER'), other: 1 };\n"
                     "export const handler = async () => db.send(new GetItemCommand({ TableName: config.chatsTable, Key: {} }));\n")
        res = self.check(self.ftree(body))
        self.assertTrue(found(res, "f", "dynamodb:GetItem", "table/other-things", "missing"), self.lines(res))
        body = ("let picked = globalThis.tableName;\nconst config = { chatsTable: picked };\n"
                "export const handler = async () => db.send(new GetItemCommand({ TableName: config.chatsTable, Key: {} }));\n")
        res = self.check(self.ftree(body))
        self.assertTrue(self.cnj(res, "f", "dynamodb:GetItem"), self.lines(res))
        self.assertEqual(bad(res, "f"), [])

    # ---- P13: the cloudwatch:namespace condition
    def metric_files(self, ns_expr):
        tf = BASE_TF + '''
resource "aws_iam_role" "m" { name = "m-role" }
resource "aws_lambda_function" "m" {
  function_name = "m"
  role          = aws_iam_role.m.arn
  handler       = "index.handler"
}
resource "aws_iam_role_policy" "m" {
  role = aws_iam_role.m.name
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = ["cloudwatch:PutMetricData"], Resource = "*",
                                       Condition = { StringEquals = { "cloudwatch:namespace" = "Naleko/Things" } } }] })
}
'''
        js = ("import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';\nconst cw = new CloudWatchClient({});\n"
              "export const handler = async (e) => cw.send(new PutMetricDataCommand({ Namespace: %s, MetricData: [] }));\n" % ns_expr)
        return {"infra/main.tf": tf, "lambda/m/index.mjs": js}

    def test_p13_cloudwatch_namespace(self):
        res = self.check(self.metric_files("'Naleko/Things'"))
        self.assertEqual([f for f in res.findings if f.subject == "m"], [], [f.line() for f in res.findings])
        self.assertEqual(res.allowed, 1)
        res = self.check(self.metric_files("'Other/Place'"))
        self.assertTrue(found(res, "m", "cloudwatch:PutMetricData", "", "missing"), [f.line() for f in res.findings])
        res = self.check(self.metric_files("e.ns"))
        self.assertTrue(self.cnj(res, "m", "cloudwatch:PutMetricData"), [f.line() for f in res.findings])
        self.assertEqual(bad(res, "m"), [])

    def test_leading_keys_stays_could_not_judge(self):
        tf = '''
resource "aws_iam_role_policy" "lk" {
  role = aws_iam_role.f.name
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = ["dynamodb:Query"], Resource = aws_dynamodb_table.other.arn,
                                       Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["DEPT#*"] } } }] })
}
'''
        res = self.check(self.ftree("export const handler = async () => db.send(new QueryCommand({ TableName: 'other-things' }));\n", tf_extra=tf))
        self.assertTrue(self.cnj(res, "f", "dynamodb:Query"), self.lines(res))
        self.assertEqual(bad(res, "f"), [])

    # ---- item 8: the reviewed list "[cannot be judged]"
    UNREADABLE = ("export async function one(e) {\n  await db.send(new UpdateItemCommand({ TableName: e.body.t, Key: {} }));\n}\n"
                  "export const handler = async (e) => one(e);\n")

    def list_file(self, text):
        p = Path(tempfile.mkdtemp()) / "exceptions.txt"
        self.addCleanup(lambda: p.unlink() if p.exists() else None)
        p.write_text(text, encoding="utf-8")
        return str(p)

    REVIEWED = ("[cannot be judged]\n"
                "f | dynamodb:UpdateItem | lambda/f/index.mjs | one | %d | table name comes from the request | read by hand on 28 Nov: only the two test tables | 2026-11-28\n")

    def test_reviewed_line_accepts_up_to_its_count(self):
        files = self.ftree(self.UNREADABLE)
        c, out = self.report(files, "--exceptions", self.list_file(self.REVIEWED % 1))
        self.assertEqual(c, 0)
        acc = [x for x in out.splitlines() if x.startswith("accepted") and "dynamodb:UpdateItem" in x]
        self.assertEqual(len(acc), 1, out)
        self.assertIn("table name comes from the request", acc[0])
        self.assertIn("could not judge: 0,", counts_line(out))
        # two such calls, a count of one: the second stays could not judge
        two = self.UNREADABLE.replace("Key: {} }));\n}", "Key: {} }));\n  await db.send(new UpdateItemCommand({ TableName: e.body.u, Key: {} }));\n}", 1)
        c, out = self.report(self.ftree(two), "--exceptions", self.list_file(self.REVIEWED % 1))
        self.assertIn("could not judge: 1,", counts_line(out))
        self.assertEqual(len([x for x in out.splitlines() if x.startswith("accepted") and "dynamodb:UpdateItem" in x]), 1, out)
        # a count of two takes both
        c, out = self.report(self.ftree(two), "--exceptions", self.list_file(self.REVIEWED % 2))
        self.assertIn("could not judge: 0,", counts_line(out))

    def test_reviewed_line_must_match_the_code_function(self):
        other = (self.REVIEWED % 1).replace("| one |", "| two |")
        c, out = self.report(self.ftree(self.UNREADABLE), "--exceptions", self.list_file(other))
        self.assertIn("could not judge: 1,", counts_line(out))
        self.assertTrue([x for x in out.splitlines() if "stale" in x and "dynamodb:UpdateItem" in x], out)

    def test_reviewed_line_must_match_the_action_and_the_file(self):
        for other, word in (((self.REVIEWED % 1).replace("dynamodb:UpdateItem", "dynamodb:PutItem"), "dynamodb:PutItem"),
                            ((self.REVIEWED % 1).replace("lambda/f/index.mjs", "lambda/f/other.mjs"), "lambda/f/other.mjs")):
            c, out = self.report(self.ftree(self.UNREADABLE), "--exceptions", self.list_file(other))
            self.assertIn("could not judge: 1,", counts_line(out))
            self.assertTrue([x for x in out.splitlines() if "stale" in x and word in x], out)

    def test_reviewed_line_that_matches_nothing_is_stale(self):
        c, out = self.report(self.ftree("export const handler = async () => db.send(new GetItemCommand({ TableName: 'things', Key: {} }));\n"),
                             "--exceptions", self.list_file(self.REVIEWED % 1))
        self.assertEqual(c, 0)
        self.assertTrue([x for x in out.splitlines() if "stale" in x and "dynamodb:UpdateItem" in x], out)

    def test_reviewed_line_without_why_or_checker_is_an_error(self):
        for bad_line in ("f | dynamodb:UpdateItem | lambda/f/index.mjs | one | 1 |  | read by hand | 2026-11-28\n",
                         "f | dynamodb:UpdateItem | lambda/f/index.mjs | one | 1 | from the request |  | 2026-11-28\n",
                         "f | dynamodb:UpdateItem | lambda/f/index.mjs | one | 1 | from the request | read by hand\n"):
            c, out = self.report(self.ftree(self.UNREADABLE), "--exceptions", self.list_file("[cannot be judged]\n" + bad_line))
            self.assertTrue([x for x in out.splitlines() if x.startswith("ERROR")], (bad_line, out))
            self.assertIn("could not judge: 1,", counts_line(out))

    # ---- item 11: the counts line
    def test_counts_line_keeps_its_fields_and_adds_one_at_the_end(self):
        c, out = self.report(self.ftree(self.UNREADABLE))
        self.assertRegex(counts_line(out), r"^functions read: \d+, workflows read: \d+, calls found: \d+, allowed: \d+, missing: \d+, "
                                           r"key missing: \d+, could not judge: \d+, warnings: \d+, accepted: \d+, new could not judge: 0$")
        lines = out.splitlines()
        self.assertEqual(lines[-1], "Judged on the dev setup. For services other than DynamoDB, S3, KMS, SQS and Secrets Manager only the action is judged.")

    # ---- P9, P10, P14: enforce mode with a base branch (real two-commit git repos)
    def enforce(self, repo):
        return self.cli("--root", str(repo), "--mode", "enforce", "--base-ref", "base", "--summary", "")

    READABLE = "export async function one(e) {\n  await db.send(new GetItemCommand({ TableName: 'things', Key: {} }));\n}\nexport const handler = async (e) => one(e);\n"
    LIST = "scripts/ci/permission-check-exceptions.txt"

    def test_p9_a_new_unreadable_call_blocks_unless_the_base_branch_reviewed_it(self):
        base = self.ftree(self.READABLE)
        pr = {"lambda/f/index.mjs": DDB_HEAD + self.UNREADABLE}
        c, out = self.enforce(self.git_repo(base, pr))
        self.assertEqual(c, 1, out)
        rows = [x for x in out.splitlines() if x.startswith("could not judge") and "dynamodb:UpdateItem" in x]
        self.assertEqual(len(rows), 1, out)
        self.assertRegex(rows[0], r"\bnew\b", "the line is tagged new")
        self.assertNotIn("[already on the base branch]", rows[0])
        self.assertTrue(counts_line(out).endswith("new could not judge: 1"), out)
        # the reviewed line landed on the base branch first: accepted, exit 0
        base_listed = dict(base)
        base_listed[self.LIST] = self.REVIEWED % 1
        c, out = self.enforce(self.git_repo(base_listed, pr))
        self.assertEqual(c, 0, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 0"), out)
        # the line only in the change's own copy of the list: never read, still exit 1
        pr_listed = dict(pr)
        pr_listed[self.LIST] = self.REVIEWED % 1
        c, out = self.enforce(self.git_repo(base, pr_listed))
        self.assertEqual(c, 1, out)
        # and the same when --exceptions points at the change's own copy
        repo = self.git_repo(base, pr_listed)
        c, out = self.cli("--root", str(repo), "--mode", "enforce", "--base-ref", "base", "--summary", "", "--exceptions", str(repo / self.LIST))
        self.assertEqual(c, 1, out)

    def test_p9_report_mode_never_blocks_but_still_counts_new(self):
        base = self.ftree(self.READABLE)
        repo = self.git_repo(base, {"lambda/f/index.mjs": DDB_HEAD + self.UNREADABLE})
        c, out = self.cli("--root", str(repo), "--mode", "report", "--base-ref", "base", "--summary", "")
        self.assertEqual(c, 0, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 1"), out)

    def test_p10_an_old_unreadable_call_does_not_block(self):
        base = self.ftree(self.UNREADABLE)
        c, out = self.enforce(self.git_repo(base, {}))
        self.assertEqual(c, 0, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 0"), out)
        # lines added above the call move its line number: still old (lock check round 1, R2)
        shifted = "// one\n// two\n" + self.UNREADABLE
        c, out = self.enforce(self.git_repo(base, {"lambda/f/index.mjs": DDB_HEAD + shifted}))
        self.assertEqual(c, 0, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 0"), out)
        # a name handed in by the caller: lines added above the caller, then above the helper's call
        caller = "import { putRow } from '../shared/put.mjs';\nexport async function one(e) { await putRow(e.body.t, {}); }\nexport const handler = async (e) => one(e);\n"
        base = self.ftree(caller, shared={"lambda/shared/put.mjs": self.PUT_HELPER})
        c, out = self.enforce(self.git_repo(base, {}))
        self.assertEqual(c, 0, out)
        self.assertTrue([x for x in out.splitlines() if x.startswith("could not judge") and "dynamodb:PutItem" in x], out)
        for rel, text in (("lambda/f/index.mjs", DDB_HEAD + "// one\n// two\n" + caller),
                          ("lambda/shared/put.mjs", self.PUT_HELPER.replace("export async function", "// one\n// two\nexport async function"))):
            c, out = self.enforce(self.git_repo(base, {rel: text}))
            self.assertEqual(c, 0, (rel, out))
            self.assertTrue(counts_line(out).endswith("new could not judge: 0"), (rel, out))

    def test_p10_same_function_action_file_in_another_code_function_is_new(self):
        base = self.ftree(self.UNREADABLE)
        two = self.UNREADABLE.replace("export const handler = async (e) => one(e);",
                                      "export async function two(e) {\n  await db.send(new UpdateItemCommand({ TableName: e.body.u, Key: {} }));\n}\n"
                                      "export const handler = async (e) => (e.x ? one(e) : two(e));")
        c, out = self.enforce(self.git_repo(base, {"lambda/f/index.mjs": DDB_HEAD + two}))
        self.assertEqual(c, 1, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 1"), out)
        # the call moved to another code function (the old one gone): still new, the code function is part of who it is
        moved = self.UNREADABLE.replace("export async function one(e)", "export async function two(e)").replace("=> one(e);", "=> two(e);")
        c, out = self.enforce(self.git_repo(base, {"lambda/f/index.mjs": DDB_HEAD + moved}))
        self.assertEqual(c, 1, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 1"), out)

    def test_p10_beyond_the_reviewed_lines_count_is_new(self):
        base = self.ftree(self.UNREADABLE)
        base[self.LIST] = self.REVIEWED % 1
        two = self.UNREADABLE.replace("Key: {} }));\n}", "Key: {} }));\n  await db.send(new UpdateItemCommand({ TableName: e.body.u, Key: {} }));\n}", 1)
        c, out = self.enforce(self.git_repo(base, {"lambda/f/index.mjs": DDB_HEAD + two}))
        self.assertEqual(c, 1, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 1"), out)
        self.assertIn("accepted: 1,", counts_line(out))

    def test_p10_a_second_unreadable_call_in_the_same_code_function_is_new(self):
        base = self.ftree(self.UNREADABLE)
        two = self.UNREADABLE.replace("Key: {} }));\n}", "Key: {} }));\n  await db.send(new UpdateItemCommand({ TableName: e.body.u, Key: {} }));\n}", 1)
        c, out = self.enforce(self.git_repo(base, {"lambda/f/index.mjs": DDB_HEAD + two}))
        self.assertEqual(c, 1, out)
        self.assertTrue(counts_line(out).endswith("new could not judge: 1"), out)

    def test_p14_a_reviewed_line_on_a_missing_finding_is_an_error(self):
        code_ = "export async function one(e) {\n  await db.send(new UpdateItemCommand({ TableName: 'things', Key: {} }));\n}\nexport const handler = async (e) => one(e);\n"
        base = self.ftree(code_)
        base[self.LIST] = self.REVIEWED % 1
        c, out = self.enforce(self.git_repo(base, {}))
        self.assertTrue([x for x in out.splitlines() if x.startswith("ERROR")], out)
        self.assertEqual(c, 1, out)
        self.assertTrue([x for x in out.splitlines() if x.startswith("MISSING") and "dynamodb:UpdateItem" in x], out)
        # report mode prints the same ERROR and still exits 0
        c, out = self.cli("--root", str(self.git_repo(base, {})), "--mode", "report", "--summary", "")
        self.assertEqual(c, 0, out)
        self.assertTrue([x for x in out.splitlines() if x.startswith("ERROR")], out)


# ---------------------------------------------------------------------------------------------
# Step 4b, section 5: what the check must never do
# ---------------------------------------------------------------------------------------------
class NeverDoes(unittest.TestCase):
    SCRIPT = HERE / "check-permissions.py"

    def test_script_imports_only_the_standard_library(self):
        import ast
        tree = ast.parse(self.SCRIPT.read_text(encoding="utf-8"))
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                names.add((node.module or "").split(".")[0])
        self.assertEqual(sorted(n for n in names if n not in sys.stdlib_module_names), [])
        self.assertNotIn("socket", names)

    def test_a_run_opens_no_socket(self):
        import socket

        def refuse(*a, **k):
            raise AssertionError("the check opened a socket")
        orig = socket.socket
        socket.socket = refuse
        try:
            for pr in ("407", "447"):
                cp.analyze(FIX / pr / "before", EXC.known_keys)
            cp.analyze(FIX / "485" / "before", EXC.known_keys)
        finally:
            socket.socket = orig

    def test_no_argument_run_is_report_mode_and_exits_zero(self):
        # locked rec-06.2 runs the script with no arguments and expects exit 0
        p = subprocess.run([sys.executable, "-B", str(self.SCRIPT)], capture_output=True, text=True,
                           env={k: v for k, v in os.environ.items() if not k.startswith("PERMISSION_CHECK")}, timeout=300)
        self.assertEqual(p.returncode, 0, p.stdout[-2000:] + p.stderr[-2000:])
        self.assertIn("Mode: report.", p.stdout)

    def test_files_avoid_the_words_two_frozen_tests_look_for(self):
        # MOD-01 AC-7 reads every .py under scripts/ for the bare word (it strips the shared file's name first);
        # ONB-11 AC-4 refuses an AI client package name in quotes outside lambda/.
        word = re.compile(r"\b" + "mod" + r"ules\b")
        strip = re.compile("mod" + r"ules\.mjs|set-" + "mod" + "ules|" + "mod" + "ule-seeds|sys\\." + "mod" + "ules")
        ai = re.compile(r"client-" + "bedrock" + r"-runtime['\"]|client-" + "textract" + r"['\"]")
        for f in (self.SCRIPT, Path(__file__).resolve()):
            text = f.read_text(encoding="utf-8")
            self.assertIsNone(word.search(strip.sub("", text)), f)
            self.assertIsNone(ai.search(text), f)


# ---------------------------------------------------------------------------------------------
# Step 4b replays: the trees just before PRs 473, 485 and 511 (copies of the files the check reads for the
# functions named below, scripts/ci/permission-fixtures/<pr>/before). The whole MISSING and KEY MISSING list must be
# exactly the real one: no line lost, no false line added.
# ---------------------------------------------------------------------------------------------
TENANTS = "table/naleko-people-dev-tenants"
SHARED_MOD = "lambda/shared/" + "mod" + "ules.mjs:50"     # the shared file that asks whether Recruitment is on
MEMBERSHIP = "lambda/shared/membership.mjs:21"            # companiesOf, the Query on the company list
UPLOADS = "bucket/pepla-dev-document-uploads-424556617428"


class Replays(unittest.TestCase):
    def blocking(self, pr):
        res = cp.analyze(FIX / pr / "before", EXC.known_keys)
        EXC.apply(res.findings)
        return sorted((f.kind, f.subject, f.action, f.resource, f.where) for f in res.findings if f.kind in cp.BLOCKING), res

    def test_before_473_only_record_not_hired(self):
        rows, res = self.blocking("473")
        self.assertEqual(rows, [("key missing", "recordNotHired", "dynamodb:GetItem", TENANTS, SHARED_MOD)], [f.line() for f in res.findings])

    def test_before_485_both_manage_roles_lines_and_nothing_else(self):
        # the Query is reached only through a destructured Promise.all import (recruitment-actions/roles.mjs:151);
        # addMember (membership.mjs:44, PutItem) and getCandidates are imported but never called
        rows, res = self.blocking("485")
        self.assertEqual(rows, sorted([("key missing", "manageRoles", "dynamodb:GetItem", TENANTS, SHARED_MOD),
                                       ("key missing", "manageRoles", "dynamodb:Query", TENANTS, MEMBERSHIP)]),
                         [f.line() for f in res.findings])

    def test_before_511_manage_offers_and_the_offer_expiry(self):
        # PR 511 put manageOffers on the key's encrypt list ("signs uploads into the bucket this key encrypts") and both
        # functions on its read list (infra/kms.tf). approversOf (offers.mjs:310) calls companiesOf, so the Query is real.
        # monitorTalentFlowSLAs only calls expireOffers: its Query and PutItem, and manageRoles' GSI1 Query, are not.
        rows, res = self.blocking("511")
        off = "lambda/shared/recruitment-actions/offers.mjs:"
        self.assertEqual(rows, sorted([("key missing", "manageOffers", "dynamodb:GetItem", TENANTS, SHARED_MOD),
                                       ("key missing", "manageOffers", "dynamodb:Query", TENANTS, MEMBERSHIP),
                                       ("key missing", "manageOffers", "s3:GetObject", UPLOADS, off + "396"),
                                       ("key missing", "manageOffers", "s3:PutObject", UPLOADS, off + "426"),
                                       ("key missing", "monitorTalentFlowSLAs", "dynamodb:GetItem", TENANTS, SHARED_MOD)]),
                         [f.line() for f in res.findings])
        self.assertEqual([f for f in res.findings if f.action == "s3:HeadObject"], [])


class ShadowedNames(unittest.TestCase):
    """Child lock .1 (review of PR 569, R1): a name reused for something else is never read. The role allows the table the
    wrong guess would give, so a guess shows as allowed. Each case must stay could not judge, with nothing allowed."""
    tree, one, git_repo, cli = Made.tree, Made.one, Made.git_repo, Made.cli
    ftree, check, lines = Cure.ftree, Cure.check, Cure.lines
    GETTER = "const T = () => process.env.T_OTHER;\n"
    SEND = "db.send(new GetItemCommand({ TableName: %s, Key: {} }))"

    def never_allowed(self, body, shared=None):
        res = self.check(self.ftree(body, resource="aws_dynamodb_table.other.arn", shared=shared))
        mine = [f for f in res.findings if f.subject == "f"]
        self.assertEqual(res.allowed, 0, self.lines(res))
        self.assertEqual([f.kind for f in mine], ["could not judge"], self.lines(res))

    def test_s1b_getter_name_is_a_destructured_input_of_the_handler(self):
        self.never_allowed(self.GETTER + "export const handler = async ({ T }) => " + self.SEND % "T()" + ";\n")

    def test_s2b_inner_function_with_the_getters_name(self):
        self.never_allowed(self.GETTER + "export const handler = async (event) => { function T() { return event.t; } return "
                           + self.SEND % "T()" + "; };\n")

    def test_s4_imported_let_that_the_shared_file_reassigns(self):
        self.never_allowed("import { TBL } from '../shared/s.mjs';\nexport const handler = async (event) => " + self.SEND % "TBL" + ";\n",
                           shared={"lambda/shared/s.mjs": "export let TBL = process.env.T_OTHER;\nexport function setT(x) { TBL = x; }\n"})

    def test_s6_let_object_that_is_reassigned(self):
        self.never_allowed("let cfg = { t: process.env.T_OTHER };\nexport const handler = async (event) => { cfg = { t: event.t }; return "
                           + self.SEND % "cfg.t" + "; };\n")

    def test_s7_outer_input_hides_a_const_object_of_the_same_name(self):
        self.never_allowed("const config = { t: process.env.T_OTHER };\nexport const handler = async (config) => { const inner = async () => "
                           + self.SEND % "config.t" + "; return inner(); };\n")

    def test_s8_two_callers_each_with_a_local_of_the_same_name(self):
        self.never_allowed("async function helper(tbl) { return " + self.SEND % "tbl" + "; }\n"
                           "async function a() { const tbl = process.env.T_OTHER; return helper(tbl); }\n"
                           "async function b(event) { const tbl = event.t; return helper(tbl); }\n"
                           "export const handler = async (event) => { await a(); return b(event); };\n")

    def test_s1_s2_s3_stay_could_not_judge(self):
        self.never_allowed(self.GETTER + "export const handler = async (T) => " + self.SEND % "T()" + ";\n")
        self.never_allowed(self.GETTER + "export const handler = async (event) => { const T = () => event.t; return " + self.SEND % "T()" + "; };\n")
        self.never_allowed("let T = () => process.env.T_OTHER;\nexport const setT = (e) => { T = () => e; };\n"
                           "export const handler = async (event) => { setT(event.t); return " + self.SEND % "T()" + "; };\n")

    def test_a_plain_getter_is_still_read(self):
        res = self.check(self.ftree(self.GETTER + "export const handler = async () => " + self.SEND % "T()" + ";\n",
                                    resource="aws_dynamodb_table.other.arn"))
        self.assertEqual([f for f in res.findings if f.subject == "f"], [], self.lines(res))
        self.assertEqual(res.allowed, 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
