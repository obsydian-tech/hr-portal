#!/usr/bin/env python3
"""Fails when a data-holding resource can be destroyed by Terraform (OPS-05).

Every sign-in pool, table, bucket, KMS key and secret in infra/ and
talent-flow-infra/ (modules included) must carry

    lifecycle {
      prevent_destroy = true
    }

and sign-in pools and tables must also have AWS deletion protection on
(`deletion_protection = "ACTIVE"`, `deletion_protection_enabled = true`).
A new one added later gets the same in the same PR, or this check fails.

Run with no arguments from anywhere: it checks the infra/ and
talent-flow-infra/ folders next to its own scripts/ folder. Reads files
only; no Terraform, no AWS, no network.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
FOLDERS = ["infra", "talent-flow-infra"]

KINDS = {
    "aws_cognito_user_pool": ("deletion_protection", '"ACTIVE"'),
    "aws_dynamodb_table": ("deletion_protection_enabled", "true"),
    "aws_s3_bucket": None,
    "aws_kms_key": None,
    "aws_secretsmanager_secret": None,
}


def strip_comments(src):
    """Blank out # // and /* */ comments; keep strings."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while j < n and src[j] != '"' and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i = j + 1
        elif c == "#" or src.startswith("//", i):
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
        elif src.startswith("/*", i):
            end = src.find("*/", i + 2)
            stop = n if end < 0 else end + 2
            out.append(re.sub(r"[^\n]", " ", src[i:stop]))
            i = stop
        else:
            out.append(c)
            i += 1
    return "".join(out)


def close_brace(src, start):
    depth, i = 0, start
    while i < len(src):
        c = src[i]
        if c == '"':
            i += 1
            while i < len(src) and src[i] != '"':
                i += 2 if src[i] == "\\" else 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced braces")


def top_level(body):
    """Body text with nested blocks removed, so only its own attributes remain."""
    out, depth = [], 0
    i = 0
    while i < len(body):
        c = body[i]
        if c == '"':
            j = i + 1
            while j < len(body) and body[j] != '"':
                j += 2 if body[j] == "\\" else 1
            if depth == 0:
                out.append(body[i:j + 1])
            i = j + 1
            continue
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        elif depth == 0:
            out.append(c)
        i += 1
    return "".join(out)


RESOURCE = re.compile(r'^[ \t]*resource[ \t]+"([^"]+)"[ \t]+"([^"]+)"[ \t]*\{', re.M)
LIFECYCLE = re.compile(r"^[ \t]*lifecycle[ \t]*\{", re.M)


def check_file(path):
    problems = []
    src = strip_comments(path.read_text(encoding="utf-8"))
    for m in RESOURCE.finditer(src):
        kind, name = m.group(1), m.group(2)
        if kind not in KINDS:
            continue
        open_at = m.end() - 1
        body = src[open_at + 1:close_brace(src, open_at) - 1]
        where = f"{path.relative_to(ROOT)}: {kind}.{name}"
        lc = LIFECYCLE.search(body)
        prevent = False
        if lc:
            lc_open = lc.end() - 1
            lc_body = body[lc_open + 1:close_brace(body, lc_open) - 1]
            prevent = re.search(r"^\s*prevent_destroy\s*=\s*true\s*$", lc_body, re.M) is not None
        if not prevent:
            problems.append(f"{where} has no lifecycle {{ prevent_destroy = true }}")
        need = KINDS[kind]
        if need:
            attr, value = need
            own = top_level(body)
            if not re.search(rf"^\s*{attr}\s*=\s*{re.escape(value)}\s*$", own, re.M):
                problems.append(f"{where} needs {attr} = {value}")
    return problems


def main():
    problems, seen = [], 0
    for folder in FOLDERS:
        base = ROOT / folder
        if not base.is_dir():
            problems.append(f"{folder}/ not found next to scripts/")
            continue
        for path in sorted(base.rglob("*.tf")):
            if ".terraform" in path.parts:
                continue
            seen += 1
            problems.extend(check_file(path))
    if problems:
        print("Resources that hold data must not be destroyable by Terraform:")
        for p in problems:
            print(f"  - {p}")
        print("Add the lifecycle block (and deletion protection) in the same PR.")
        return 1
    print(f"prevent_destroy check passed ({seen} files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
