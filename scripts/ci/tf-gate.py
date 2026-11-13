#!/usr/bin/env python3
"""The Terraform apply guard (OPS-05).

Reads a plan as `terraform show -json PLAN` prints it and answers four
questions for the apply workflows. Standard library only, no network.

  tf-gate.py list PLAN_JSON
      One line per resource that changes, "<action>\\t<address>", sorted.
      Actions: create, update, delete, replace, import, import+update, forget.
      Unchanged resources and data reads are left out.
  tf-gate.py destroys PLAN_JSON
      Only the delete and replace lines. Exit 0 when there are none, exit 3
      when there are some.
  tf-gate.py compare APPROVED_LIST PLAN_JSON
      APPROVED_LIST is what `list` wrote when Iggie approved. Exit 0 when the
      new plan has exactly the same lines, exit 4 and every differing address
      otherwise.
  tf-gate.py summary ROOT PLAN_JSON
      Markdown for the run summary: address, action and, for updates, the
      names of the changed attributes, with warning lines for IAM, Lambda
      environment and protected-resource changes.

The repo is public, so nothing here ever prints a value: only addresses,
actions and attribute names. Any plan it cannot read is an error (exit 2),
never "nothing to delete".
"""

import json
import sys

# The protected list from the OPS-05 spec, per root. A change to one of these
# raises the "Protected resource change" line. Deleting them is also blocked by
# prevent_destroy, AWS deletion protection and the apply roles' IAM denies.
PROTECTED = {
    "infra": {
        "aws_cognito_user_pool.naleko_dev",
        "aws_dynamodb_table.employees",
        "aws_dynamodb_table.documents",
        "aws_dynamodb_table.document_verification",
        "aws_dynamodb_table.external_verification_requests",
        "aws_dynamodb_table.onboarding_events",
        "aws_dynamodb_table.agent_audit",
        "aws_dynamodb_table.pending_actions",
        "aws_dynamodb_table.idempotency_keys",
        "aws_dynamodb_table.prompt_cache",
        "aws_dynamodb_table.naleko_ai_rate_limit",
        "aws_dynamodb_table.it_tasks",
        "aws_dynamodb_table.provisioning_bundles",
        "aws_dynamodb_table.talent_flow_events",
        "aws_s3_bucket.document_uploads",
        "aws_s3_bucket.audit_archive",
        "module.config[0].aws_s3_bucket.config_logs",
        "module.kms_pii.aws_kms_key.this",
        "aws_secretsmanager_secret.agent_api_key",
    },
    "talent-flow-infra": {
        "aws_cognito_user_pool.talent_flow",
        "aws_dynamodb_table.talent_flow_state",
        "aws_dynamodb_table.talent_flow_config",
        "aws_dynamodb_table.talent_flow_agent_audit",
        "aws_dynamodb_table.talent_flow_prompt_cache",
        "aws_dynamodb_table.talent_flow_pending_actions",
        "aws_dynamodb_table.talent_flow_ai_rate_limit",
        "aws_dynamodb_table.talent_flow_idempotency_keys",
        "aws_dynamodb_table.talent_flow_users",
        "aws_dynamodb_table.talent_flow_notifications",
        "aws_dynamodb_table.intelligence_dismissals",
        "aws_dynamodb_table.intelligence_events",
        "aws_s3_bucket.talent_flow_audit_archive",
        "aws_kms_key.talent_flow_state",
        "aws_kms_key.talent_flow_agent_audit",
        "aws_secretsmanager_secret.agent_api_key",
    },
}

DESTROYING = {"delete", "replace"}


class PlanError(Exception):
    pass


def load_plan(path):
    try:
        with open(path, encoding="utf-8") as f:
            plan = json.load(f)
    except (OSError, ValueError) as e:
        raise PlanError(f"cannot read plan {path}: {type(e).__name__}")
    if not isinstance(plan, dict):
        raise PlanError("plan is not a JSON object")
    changes = plan.get("resource_changes", [])
    if not isinstance(changes, list):
        raise PlanError("resource_changes is not a list")
    return changes


def classify(rc):
    """(action, address) for one resource change, or None when it changes nothing."""
    if not isinstance(rc, dict):
        raise PlanError("a resource change is not an object")
    address = rc.get("address")
    change = rc.get("change")
    if not isinstance(address, str) or not address or not isinstance(change, dict):
        raise PlanError("a resource change has no address or change")
    actions = change.get("actions")
    if not isinstance(actions, list) or not actions or not all(isinstance(a, str) for a in actions):
        raise PlanError(f"{address}: no actions")
    importing = change.get("importing") is not None

    if actions == ["read"]:
        return None
    if actions == ["no-op"]:
        return ("import", address) if importing else None
    if actions == ["create"]:
        return "create", address
    if actions == ["update"]:
        return ("import+update" if importing else "update"), address
    if actions == ["delete"]:
        return "delete", address
    if sorted(actions) == ["create", "delete"]:
        return "replace", address
    if actions == ["forget"]:
        return "forget", address
    raise PlanError(f"{address}: unknown actions {'+'.join(actions)}")


def listed(changes):
    out = []
    for rc in changes:
        c = classify(rc)
        if c:
            out.append(c)
    return sorted(out, key=lambda c: (c[1], c[0]))


def as_lines(pairs):
    return [f"{a}\t{addr}" for a, addr in pairs]


def changed_attributes(rc):
    """Top-level attribute names whose value differs (names only, never values)."""
    change = rc.get("change", {})
    before = change.get("before") or {}
    after = change.get("after") or {}
    unknown = change.get("after_unknown") or {}
    if not isinstance(before, dict) or not isinstance(after, dict):
        return []
    names = set()
    for k in set(before) | set(after):
        if before.get(k) != after.get(k):
            names.add(k)
    if isinstance(unknown, dict):
        names.update(k for k, v in unknown.items() if v)
    # tags_all always follows tags; keep the list short.
    if "tags" in names:
        names.discard("tags_all")
    return sorted(names)


def env_changed(rc):
    change = rc.get("change", {})
    before = change.get("before") or {}
    after = change.get("after") or {}
    unknown = change.get("after_unknown") or {}
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    if isinstance(unknown, dict) and unknown.get("environment"):
        return True
    return before.get("environment") != after.get("environment")


def rtype(address):
    parts = [p for p in address.split(".")]
    # module.x[0].aws_y.z -> aws_y ; data sources never reach here
    while parts and parts[0] == "module":
        parts = parts[2:]
    return parts[0] if parts else ""


def cell(text):
    return text.replace("|", "\\|")


def summary(root, changes):
    rows = []
    iam, env, protected = [], [], []
    by_address = {}
    for rc in changes:
        c = classify(rc)
        if not c:
            continue
        action, address = c
        by_address[address] = rc
        t = rtype(address)
        attrs = changed_attributes(rc) if action in ("update", "import+update") else []
        rows.append((address, action, attrs))
        if t.startswith("aws_iam_"):
            iam.append(address)
        if t == "aws_lambda_function" and action != "create" and env_changed(rc):
            env.append(address)
        if address in PROTECTED.get(root, set()):
            protected.append(address)
    rows.sort()

    md = [f"### Terraform plan: `{root}`", ""]
    if not rows:
        md.append("No changes.")
        return "\n".join(md) + "\n"
    warn = []
    if iam:
        warn.append(f"- :warning: **IAM change** ({len(iam)} resource(s)): check who gets which rights.")
    if env:
        warn.append(f"- :warning: **Lambda environment change** ({len(env)} function(s)).")
    if protected:
        warn.append(f"- :warning: **Protected resource change** ({len(protected)} resource(s)): sign-in pools, tables, data buckets, keys or agent key secrets.")
    if warn:
        md += warn + [""]
    counts = {}
    for _, a, _ in rows:
        counts[a] = counts.get(a, 0) + 1
    md.append(", ".join(f"{n} {a}" for a, n in sorted(counts.items())))
    md.append("")
    md.append("| Address | Action | Changed attributes |")
    md.append("| --- | --- | --- |")
    for address, action, attrs in rows:
        flag = " :warning:" if address in protected else ""
        md.append(f"| `{cell(address)}`{flag} | {action} | {cell(', '.join(attrs))} |")
    return "\n".join(md) + "\n"


def compare(approved_path, changes):
    try:
        with open(approved_path, encoding="utf-8") as f:
            approved = {l.strip() for l in f.read().splitlines() if l.strip()}
    except OSError as e:
        raise PlanError(f"cannot read approved list: {type(e).__name__}")
    now = set(as_lines(listed(changes)))
    if approved == now:
        print(f"The new plan matches the approved list ({len(now)} change(s)).")
        return 0
    print("The new plan differs from the approved one. Nothing is applied.")
    for l in sorted(now - approved, key=lambda x: x.split("\t")[-1]):
        print(f"+ not approved: {l}")
    for l in sorted(approved - now, key=lambda x: x.split("\t")[-1]):
        print(f"- approved but no longer in the plan: {l}")
    return 4


USAGE = __doc__


def main(argv):
    if len(argv) < 2:
        print(USAGE, file=sys.stderr)
        return 2
    cmd, args = argv[1], argv[2:]
    try:
        if cmd == "list" and len(args) == 1:
            for l in as_lines(listed(load_plan(args[0]))):
                print(l)
            return 0
        if cmd == "destroys" and len(args) == 1:
            found = [p for p in listed(load_plan(args[0])) if p[0] in DESTROYING]
            for l in as_lines(found):
                print(l)
            return 3 if found else 0
        if cmd == "compare" and len(args) == 2:
            return compare(args[0], load_plan(args[1]))
        if cmd == "summary" and len(args) == 2:
            sys.stdout.write(summary(args[0], load_plan(args[1])))
            return 0
    except PlanError as e:
        print(f"tf-gate: {e}", file=sys.stderr)
        return 2
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
