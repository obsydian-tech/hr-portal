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


if __name__ == "__main__":
    unittest.main(verbosity=1)
