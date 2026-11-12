#!/usr/bin/env python3
"""
Fail when the same AWS object is declared twice in Terraform.

infra/ and talent-flow-infra/ are separate roots with separate state files.
If both declare, say, the Lambda "adminGetUsers", each apply flips it back
to its own version and prod drifts forever (this happened with adminGetUsers in November 2026).
This check finds such pairs before they merge.

How: for each resource, work out the AWS name it creates (name,
function_name or bucket), resolving locals and variable defaults that are
plain text. Two resources of the same type with the same AWS name, in either
root, are a duplicate. Names built from things only known at apply time are
skipped (nothing to compare).

Prints type, AWS name and file:resource for each duplicate. Exit 1 if any.
Needs: pip install python-hcl2
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

import hcl2

ROOTS = ["infra", "talent-flow-infra"]

# The argument that holds the AWS name, per resource type we compare.
NAME_ARG = {
    "aws_lambda_function": "function_name",
    "aws_s3_bucket": "bucket",
}
NAMED_TYPES = {
    "aws_iam_role", "aws_iam_policy", "aws_iam_role_policy", "aws_lambda_function",
    "aws_dynamodb_table", "aws_s3_bucket", "aws_sqs_queue", "aws_sns_topic",
    "aws_cloudwatch_log_group", "aws_cloudwatch_event_rule", "aws_cloudwatch_metric_alarm",
    "aws_cloudwatch_dashboard", "aws_sfn_state_machine", "aws_cognito_user_pool",
    "aws_kms_alias", "aws_secretsmanager_secret", "aws_ssm_parameter", "aws_budgets_budget",
    "aws_apigatewayv2_api", "aws_glue_catalog_database", "aws_athena_workgroup",
    "aws_kinesis_firehose_delivery_stream", "aws_kinesis_stream", "aws_scheduler_schedule",
}
REF = re.compile(r"\$\{(local|var)\.([A-Za-z0-9_]+)\}")


def unwrap(v):
    """hcl2 wraps single values in lists in some versions."""
    while isinstance(v, list) and len(v) == 1:
        v = v[0]
    return unq(v)


def unq(v):
    """python-hcl2 8.x keeps the quotes: '"name"' -> 'name'."""
    if isinstance(v, str) and len(v) >= 2 and v[0] == v[-1] == '"':
        return v[1:-1]
    return v


def load_root(root: Path):
    locals_, defaults, resources = {}, {}, []
    for f in sorted(root.glob("*.tf")):
        try:
            doc = hcl2.loads(f.read_text())
        except Exception as e:  # unparsable file: say so, don't hide it
            sys.exit(f"::error file={f}::cannot parse ({e})")
        for block in doc.get("locals", []):
            for k, v in block.items():
                v = unwrap(v)
                if isinstance(v, str):
                    locals_[unq(k)] = v
        for block in doc.get("variable", []):
            for k, body in block.items():
                body = unwrap(body)
                d = unwrap(body.get("default")) if isinstance(body, dict) else None
                if isinstance(d, (str, int, float)) and not isinstance(d, bool):
                    defaults[unq(k)] = str(d)
        for block in doc.get("resource", []):
            for rtype, named in block.items():
                for rname, body in named.items():
                    resources.append((f, unq(rtype), unq(rname), unwrap(body)))
    return locals_, defaults, resources


def resolve(text: str, locals_: dict, defaults: dict) -> str | None:
    for _ in range(10):  # locals may refer to other locals
        new = REF.sub(lambda m: (locals_ if m[1] == "local" else defaults).get(m[2], m[0]), text)
        if new == text:
            break
        text = new
    if "${" in text:
        return None  # depends on something only known at apply time
    return text


def main() -> None:
    seen = defaultdict(list)
    for r in ROOTS:
        root = Path(r)
        if not root.is_dir():
            continue
        locals_, defaults, resources = load_root(root)
        for f, rtype, rname, body in resources:
            if rtype not in NAMED_TYPES or not isinstance(body, dict):
                continue
            raw = unwrap(body.get(NAME_ARG.get(rtype, "name")))
            if not isinstance(raw, str):
                continue
            name = resolve(raw, locals_, defaults)
            if name:
                seen[(rtype, name)].append(f"{f}:{rtype}.{rname}")
    dups = {k: v for k, v in seen.items() if len(v) > 1}
    checked = len(seen)
    if not dups:
        print(f"No duplicates: {checked} named AWS resources checked across {', '.join(ROOTS)}.")
        return
    for (rtype, name), where in sorted(dups.items()):
        print(f"::error::{rtype} \"{name}\" is declared {len(where)} times: {'; '.join(where)}")
    print(f"{len(dups)} duplicate(s). Keep each AWS object in ONE root; remove it from the other "
          "(terraform state rm there, so nothing is destroyed).")
    sys.exit(1)


if __name__ == "__main__":
    main()
