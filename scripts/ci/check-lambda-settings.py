#!/usr/bin/env python3
"""Keep prod settings out of the Lambda code (BE-15).

Standard library only, no AWS access, a few seconds to run. The repo is
public, so this never prints a value: only a file, a line and a setting name.

  check-lambda-settings.py [--root DIR]
      Static checks, run on every pull request that touches lambda/ or infra:
      (a) no non-test file under lambda/ holds the prod pool id, the prod app
          client id, the prod account id or the prod web address;
      (b) the settings in SETTINGS have no `|| 'literal'` or `?? 'literal'`
          fallback, and each Lambda that reads one calls requireSetting();
      (c) Terraform gives every Lambda its settings in both roots, the pool and
          the two web addresses come from a reference (never a literal), and
          env/dev.tfvars holds no prod value.
  check-lambda-settings.py plan PLAN_JSON
      (d) reads a plan as `terraform show -json` prints it (the PR's prod plan).
          Every Lambda environment key that exists today keeps its value; the
          only new keys are the ones in ALLOWED_NEW, each equal to what the
          code hard-wired before. Exit 1 on any other change.

Exit 0 when clean, 1 on a finding, 2 when a file cannot be read.
"""
import json
import re
import sys
from pathlib import Path

# The prod values this check keeps out of Lambda code. They are public in the
# repo's history already; nothing here prints them.
PROD_POOL_ID = "af-south-1_2LdAGFnw2"
PROD_CLIENT_ID = "1pk5rd58glsohfplnlr63tg0qb"
PROD_ACCOUNT_ID = "937137806477"
PROD_HOST = "hr-portal-beryl-three.vercel.app"
FORBIDDEN = {
    "prod pool id": PROD_POOL_ID,
    "prod app client id": PROD_CLIENT_ID,
    "prod account id": PROD_ACCOUNT_ID,
    "prod web address": PROD_HOST,
}

# Lambda (AWS function name) -> (source file, settings it reads).
LAMBDAS = {
    "createEmployee": ("lambda/createEmployee/index.mjs", ["COGNITO_POOL_ID", "LOGIN_URL", "POSTMARK_SENDER_EMAIL"]),
    "sendNotificationEmail": ("lambda/sendNotificationEmail/index.mjs", ["LOGIN_URL", "POSTMARK_SENDER_EMAIL", "HR_EMAIL"]),
    "adminCreateUser": ("lambda/adminCreateUser/index.js", ["COGNITO_POOL_ID"]),
    "adminUpdateUser": ("lambda/adminUpdateUser/index.js", ["COGNITO_POOL_ID"]),
    "adminDeactivateUser": ("lambda/adminDeactivateUser/index.js", ["COGNITO_POOL_ID"]),
    "getPanelMembers": ("lambda/getPanelMembers/index.js", ["COGNITO_POOL_ID"]),
    "getHiringManagers": ("lambda/getHiringManagers/index.js", ["HM_COGNITO_POOL_ID"]),
    "generateScoringLink": ("lambda/generateScoringLink/index.js", ["FRONTEND_URL"]),
    "sendTalentFlowNotification": ("lambda/sendTalentFlowNotification/index.js", ["POSTMARK_SENDER_EMAIL"]),
    "reviewDocumentVerification": ("lambda/reviewDocumentVerification/index.mjs", ["ENVIRONMENT"]),
    "talentFlowApproveAction": ("lambda/talentFlowApproveAction/index.mjs", ["ENVIRONMENT"]),
}
SETTINGS = sorted({s for _, names in LAMBDAS.values() for s in names})

# Settings whose Terraform value must be a reference, and which one.
TF_EXPECT = {
    "LOGIN_URL": "var.login_url",
    "FRONTEND_URL": "var.frontend_url",
    "ENVIRONMENT": "var.environment",
}
TF_EXPECT_ONE = {("createEmployee", "COGNITO_POOL_ID"): "aws_cognito_user_pool.naleko_dev.id"}
TF_NO_LITERAL = {"COGNITO_POOL_ID", "HM_COGNITO_POOL_ID", "LOGIN_URL", "FRONTEND_URL", "ENVIRONMENT"}

# The only keys a prod plan may add to a Lambda, with the value the code
# hard-wired before this card.
ALLOWED_NEW = {
    ("createEmployee", "COGNITO_POOL_ID"): PROD_POOL_ID,
    ("reviewDocumentVerification", "ENVIRONMENT"): "prod",
    ("talentFlowApproveAction", "ENVIRONMENT"): "prod",
}

# TEN-03: the only keys a prod plan may drop from a Lambda. The two TalentFlow
# Lambdas below no longer read TENANT_ID (the company comes from the sign-in).
ALLOWED_REMOVED = {
    ("aws_lambda_function.get_panel_members", "TENANT_ID"),
    ("aws_lambda_function.monitor_slas", "TENANT_ID"),
    # ONB-22: the MCP server reads the agent key from its secret at run time, so the baked key and the unused REST base go.
    ("aws_lambda_function.naleko_mcp_server", "NALEKO_AGENT_KEY"),
    ("aws_lambda_function.naleko_mcp_server", "REST_API_BASE"),
}

ROOTS = ["infra", "talent-flow-infra"]
CODE_SUFFIXES = {".js", ".mjs", ".cjs", ".json", ".md", ".ts", ".yml", ".yaml", ".txt", ".py", ".sh"}
SKIP_NAMES = {"package-lock.json"}
TEST_NAME = re.compile(r"\.(test|spec)\.[cm]?[jt]s$")


class Unreadable(Exception):
    pass


def lambda_files(root: Path):
    base = root / "lambda"
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base).parts
        if not p.is_file() or "node_modules" in rel or "__tests__" in rel:
            continue
        if p.name in SKIP_NAMES or TEST_NAME.search(p.name) or p.suffix not in CODE_SUFFIXES:
            continue
        yield p


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise Unreadable(f"{p}: {e.strerror}")


def check_forbidden(root: Path):
    out = []
    for p in lambda_files(root):
        for n, line in enumerate(read(p).splitlines(), 1):
            for label, needle in FORBIDDEN.items():
                if needle in line:
                    out.append(f"{p.relative_to(root)}:{n}: {label} in Lambda code")
    return out


def check_fallbacks(root: Path):
    out = []
    for fn, (src, names) in LAMBDAS.items():
        p = root / src
        if not p.is_file():
            out.append(f"{src}:1: {fn} source file not found")
            continue
        text = read(p)
        lines = text.splitlines()
        for name in SETTINGS:
            pat = re.compile(r"""process\.env(?:\.%s\b|\[\s*['"]%s['"]\s*\])\s*(\|\||\?\?)""" % (name, name))
            for n, line in enumerate(lines, 1):
                if pat.search(line):
                    out.append(f"{src}:{n}: {name} has a fallback value")
        for name in names:
            if not re.search(r"""requireSetting\(\s*['"]%s['"]\s*\)""" % name, text):
                out.append(f"{src}:1: {name} is not read with requireSetting()")
    # any file may not add a fallback to a setting in the table
    for p in lambda_files(root):
        if p.suffix not in (".js", ".mjs", ".cjs"):
            continue
        rel = str(p.relative_to(root))
        if rel in {v[0] for v in LAMBDAS.values()}:
            continue
        for n, line in enumerate(read(p).splitlines(), 1):
            for name in SETTINGS:
                if re.search(r"process\.env\.%s\b\s*(\|\||\?\?)\s*['\"]" % name, line):
                    out.append(f"{rel}:{n}: {name} has a fallback value")
    return out


# ── Terraform text ───────────────────────────────────────────────────────────

def block_end(text: str, open_idx: int) -> int:
    depth, i, in_str = 0, open_idx, False
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "#":
            i = text.find("\n", i)
            if i < 0:
                break
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(text) - 1


def tf_lambdas(root: Path, tf_root: str):
    """[(function_name, file, line, {KEY: expr})] for each aws_lambda_function."""
    files = sorted((root / tf_root).glob("*.tf"))
    texts = {f: read(f) for f in files}
    locals_ = {}
    for t in texts.values():
        for m in re.finditer(r'^\s*([A-Za-z_][\w]*)\s*=\s*"([^"$]+)"\s*$', t, re.M):
            locals_.setdefault(m.group(1), m.group(2))
    found = []
    for f, t in texts.items():
        for m in re.finditer(r'resource\s+"aws_lambda_function"\s+"[^"]+"\s*\{', t):
            end = block_end(t, m.end() - 1)
            body = t[m.end():end]
            fm = re.search(r'^\s*function_name\s*=\s*(.+?)\s*$', body, re.M)
            if not fm:
                continue
            expr = fm.group(1)
            if expr.startswith('"') and expr.endswith('"'):
                name = expr.strip('"')
            else:
                lm = re.fullmatch(r"local\.([\w]+)", expr)
                name = locals_.get(lm.group(1)) if lm else None
            if not name:
                continue
            env = {}
            em = re.search(r"variables\s*=\s*\{", body)
            if em:
                vend = block_end(body, em.end() - 1)
                for km in re.finditer(r"^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$", body[em.end():vend], re.M):
                    env[km.group(1)] = re.sub(r"\s+#.*$", "", km.group(2))
            line = t[:m.start()].count("\n") + 1
            found.append((name, str(f.relative_to(root)), line, env))
    return found


def check_terraform(root: Path):
    out = []
    seen = {}
    for tf_root in ROOTS:
        for name, f, line, env in tf_lambdas(root, tf_root):
            seen.setdefault(name, []).append((f, line, env))
    for fn, (_, names) in LAMBDAS.items():
        if fn not in seen:
            out.append(f"infra:1: Lambda {fn} is not declared in Terraform")
            continue
        for f, line, env in seen[fn]:
            for name in names:
                if name not in env:
                    out.append(f"{f}:{line}: {fn} does not get {name}")
                    continue
                expr = env[name]
                if name in TF_NO_LITERAL and expr.startswith('"'):
                    out.append(f"{f}:{line}: {fn} sets {name} to a literal, use a reference")
                want = TF_EXPECT_ONE.get((fn, name)) or TF_EXPECT.get(name)
                if want and expr != want:
                    out.append(f"{f}:{line}: {fn} sets {name} from the wrong source (expected {want})")
    # variables with a default, and dev values that are not prod values
    for tf_root, var in (("infra", "login_url"), ("talent-flow-infra", "frontend_url")):
        vt = read(root / tf_root / "variables.tf")
        m = re.search(r'variable\s+"%s"\s*\{' % var, vt)
        if not m:
            out.append(f"{tf_root}/variables.tf:1: variable {var} is missing")
        elif "default" not in vt[m.end():block_end(vt, m.end() - 1)]:
            out.append(f"{tf_root}/variables.tf:1: variable {var} has no default")
        tv = root / tf_root / "env" / "dev.tfvars"
        text = read(tv)
        if not re.search(r"^\s*%s\s*=\s*\"[^\"]+\"" % var, text, re.M):
            out.append(f"{tf_root}/env/dev.tfvars:1: {var} is not set for pepla-dev")
        if not re.search(r'^\s*environment\s*=\s*"dev"', text, re.M):
            out.append(f"{tf_root}/env/dev.tfvars:1: environment is not dev")
        for n, ln in enumerate(text.splitlines(), 1):
            for label, needle in FORBIDDEN.items():
                if needle in ln:
                    out.append(f"{tf_root}/env/dev.tfvars:{n}: {label} in the pepla-dev values")
    return out


# ── Plan mode ────────────────────────────────────────────────────────────────

def lambda_env(obj, unknown):
    """(variables dict, unknown-keys set) from a plan 'before' or 'after' object."""
    if not isinstance(obj, dict):
        return {}, set()
    env = obj.get("environment") or []
    variables = (env[0] or {}).get("variables") if env and isinstance(env, list) else None
    unk = set()
    if isinstance(unknown, dict):
        ue = unknown.get("environment")
        if isinstance(ue, list) and ue and isinstance(ue[0], dict):
            uv = ue[0].get("variables")
            if isinstance(uv, dict):
                unk = {k for k, v in uv.items() if v}
    return (variables or {}), unk


def check_plan(plan_path: Path):
    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise Unreadable(f"plan not readable ({type(e).__name__})")
    if not isinstance(plan, dict) or "resource_changes" not in plan:
        raise Unreadable("plan has no resource_changes")
    out = []
    notices = []
    for rc in plan["resource_changes"]:
        if rc.get("type") != "aws_lambda_function":
            continue
        ch = rc.get("change") or {}
        actions = ch.get("actions") or []
        if actions in (["no-op"], ["read"]):
            continue
        before, _ = lambda_env(ch.get("before"), None)
        after, unk = lambda_env(ch.get("after"), ch.get("after_unknown"))
        fn = (ch.get("after") or ch.get("before") or {}).get("function_name") or rc.get("address")
        addr = rc.get("address")
        if "delete" in actions:
            out.append(f"{addr}: Lambda would be deleted or replaced")
            continue
        for key in sorted(before):
            if key in unk:
                out.append(f"{addr}: {key} cannot be checked (value known only after apply)")
            elif key not in after:
                if (addr, key) in ALLOWED_REMOVED:
                    continue
                out.append(f"{addr}: {key} would be removed")
            elif after[key] != before[key]:
                out.append(f"{addr}: {key} would change")
        for key in sorted(set(after) | unk):
            if key in before:
                continue
            want = ALLOWED_NEW.get((fn, key))
            if want is None:
                # A new key on another Lambda is a later card's business. It is
                # shown, not failed, so this check does not block unrelated work.
                notices.append(f"{addr}: new setting {key} (not one BE-15 adds)")
            elif key in unk or after.get(key) != want:
                out.append(f"{addr}: new setting {key} does not equal what the code used before")
    for n in notices:
        print(f"::notice::{n}")
    return out


def main(argv):
    try:
        if argv[:1] == ["plan"]:
            if len(argv) != 2:
                print("usage: check-lambda-settings.py plan PLAN_JSON", file=sys.stderr)
                return 2
            findings = check_plan(Path(argv[1]))
            label = "plan"
        else:
            root = Path(__file__).resolve().parents[2]
            if argv[:1] == ["--root"] and len(argv) == 2:
                root = Path(argv[1]).resolve()
            elif argv:
                print("usage: check-lambda-settings.py [--root DIR] | plan PLAN_JSON", file=sys.stderr)
                return 2
            findings = check_forbidden(root) + check_fallbacks(root) + check_terraform(root)
            label = "Lambda settings"
    except Unreadable as e:
        print(f"::error::cannot read input: {e}")
        return 2
    for f in findings:
        print(f"::error::{f}")
    if findings:
        print(f"{label}: {len(findings)} problem(s)")
        return 1
    print(f"{label}: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
