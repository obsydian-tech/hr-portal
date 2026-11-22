#!/usr/bin/env python3
"""
REC-14: runs the pepla-dev seed's departments part (scripts/ci/seed-dev.py, seed_departments) against an in-memory DynamoDB, with no AWS.
Copied from ../rec-04/seed-run.py (code added: the company list's key, transact_write_items, an equality condition joined with AND,
and node runs of the department seed).

  python3 seed-run.py <seed-dev.py> <world.json> <fake-aws folder>

world.json is {"tables": {name: [item, ...]}} with items in DynamoDB's AttributeValue form. The tables after the run, and the calls
made, are printed as one line: @@REC14@@{"tables": ..., "calls": [...], "returned": ...}. boto3 is replaced before the seed file is
loaded, so nothing reaches AWS. Only these calls are answered: put_item, delete_item, get_item, update_item (SET a = :x, ...), query (a
key condition of one equality and an optional begins_with), scan and transact_write_items (Put, Update, ConditionCheck). A condition may
be attribute_not_exists(x), attribute_exists(x) or x = :v, joined by AND. Anything else fails, with the words "seed-run: ... not understood".

The seed may run the department seed (scripts/tenancy/company-seeds/departments.mjs) with node through subprocess (run, call,
check_call or check_output). That run goes to the same fake AWS as the Lambda tests (support/rec-14/fake-aws, script-run.mjs) over this
world's tables, and its writes come back into them. Any other subprocess is refused.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import types

seed_path, world_path, fake_aws = sys.argv[1:4]
world = json.load(open(world_path))
tables = world.setdefault("tables", {})
calls = []
KEYS = {"naleko-people-dev-tenants": ["pk", "sk"], "talent-flow-state": ["PK", "SK"], "talent-flow-roles": ["pk", "sk"]}


class ResourceNotFoundException(Exception):
    pass


class ConditionalCheckFailedException(Exception):
    pass


class TransactionCanceledException(Exception):
    pass


def table(name):
    if name not in tables:
        raise ResourceNotFoundException(f"Requested resource not found: {name}")
    return tables[name]


def key_of(name, item):
    return {k: item[k] for k in KEYS.get(name, []) if k in item}


def same(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _values(kw):
    return kw.get("ExpressionAttributeValues", {})


def _name(n, kw):
    return kw.get("ExpressionAttributeNames", {}).get(n, n)


def _one_cond(part, kw, current):
    m = re.fullmatch(r"\s*attribute_not_exists\(\s*([#\w]+)\s*\)\s*", part)
    if m:
        return current is None or _name(m.group(1), kw) not in current
    m = re.fullmatch(r"\s*attribute_exists\(\s*([#\w]+)\s*\)\s*", part)
    if m:
        return current is not None and _name(m.group(1), kw) in current
    m = re.fullmatch(r"\s*([#\w]+)\s*=\s*(:\w+)\s*", part)
    if m:
        return current is not None and same(current.get(_name(m.group(1), kw)), _values(kw)[m.group(2)])
    raise RuntimeError(f"seed-run: condition not understood: {part}")


def _cond_ok(kw, current):
    c = kw.get("ConditionExpression")
    if not c:
        return True
    c = c.strip()
    if c.startswith("(") and c.endswith(")") and c.count("(") == 1:
        c = c[1:-1]
    return all(_one_cond(p, kw, current) for p in re.split(r"\s+AND\s+", c))


def _find(name, key):
    rows = table(name)
    return next((i for i, r in enumerate(rows) if same(key_of(name, r), key)), None)


def _put(kw, dry=False):
    rows = table(kw["TableName"])
    at = _find(kw["TableName"], key_of(kw["TableName"], kw["Item"]))
    if not _cond_ok(kw, rows[at] if at is not None else None):
        raise ConditionalCheckFailedException("The conditional request failed")
    if dry:
        return
    if at is None:
        rows.append(kw["Item"])
    else:
        rows[at] = kw["Item"]


def _update(kw, dry=False):
    rows = table(kw["TableName"])
    at = _find(kw["TableName"], kw["Key"])
    cur = rows[at] if at is not None else None
    if not _cond_ok(kw, cur):
        raise ConditionalCheckFailedException("The conditional request failed")
    if dry:
        return
    item = dict(cur or kw["Key"])
    expr = kw.get("UpdateExpression", "")
    m = re.fullmatch(r"\s*SET\s+(.*)", expr, re.S)
    if not m:
        raise RuntimeError(f"seed-run: update not understood: {expr}")
    for part in m.group(1).split(","):
        left, right = [x.strip() for x in part.split("=", 1)]
        if right not in _values(kw):
            raise RuntimeError(f"seed-run: update not understood: {expr}")
        item[_name(left, kw)] = _values(kw)[right]
    if at is None:
        rows.append(item)
    else:
        rows[at] = item


class FakeDdb:
    class exceptions:
        pass

    def __init__(self):
        self.exceptions.ResourceNotFoundException = ResourceNotFoundException
        self.exceptions.ConditionalCheckFailedException = ConditionalCheckFailedException
        self.exceptions.TransactionCanceledException = TransactionCanceledException

    def put_item(self, **kw):
        calls.append({"op": "put_item", "table": kw["TableName"]})
        _put(kw)
        return {}

    def delete_item(self, **kw):
        calls.append({"op": "delete_item", "table": kw["TableName"]})
        rows = table(kw["TableName"])
        tables[kw["TableName"]] = [r for r in rows if not same(key_of(kw["TableName"], r), kw["Key"])]
        return {}

    def get_item(self, **kw):
        calls.append({"op": "get_item", "table": kw["TableName"], "key": kw["Key"], "consistent": kw.get("ConsistentRead") is True})
        at = _find(kw["TableName"], kw["Key"])
        return {"Item": table(kw["TableName"])[at]} if at is not None else {}

    def update_item(self, **kw):
        calls.append({"op": "update_item", "table": kw["TableName"]})
        _update(kw)
        return {}

    def transact_write_items(self, **kw):
        calls.append({"op": "transact_write_items", "tables": sorted({list(t.values())[0]["TableName"] for t in kw["TransactItems"]})})
        steps = [(list(t.keys())[0], list(t.values())[0]) for t in kw["TransactItems"]]
        try:
            for kind, i in steps:
                if kind == "Put":
                    _put(i, dry=True)
                elif kind == "Update":
                    _update(i, dry=True)
                elif kind == "ConditionCheck":
                    at = _find(i["TableName"], i["Key"])
                    if not _cond_ok(i, table(i["TableName"])[at] if at is not None else None):
                        raise ConditionalCheckFailedException("The conditional request failed")
                else:
                    raise RuntimeError(f"seed-run: transaction step not understood: {kind}")
        except ConditionalCheckFailedException:
            raise TransactionCanceledException("Transaction cancelled [ConditionalCheckFailed]")
        for kind, i in steps:
            if kind == "Put":
                _put(i)
            elif kind == "Update":
                _update(i)
        return {}

    def query(self, **kw):
        calls.append({"op": "query", "table": kw["TableName"], "index": kw.get("IndexName")})
        if kw.get("IndexName"):
            raise RuntimeError("seed-run: the seed queries no index")
        expr = kw["KeyConditionExpression"]
        m = re.fullmatch(r"\s*([#\w]+)\s*=\s*(:\w+)\s*(?:AND\s+begins_with\(\s*([#\w]+)\s*,\s*(:\w+)\s*\))?\s*", expr)
        if not m:
            raise RuntimeError(f"seed-run: key condition not understood: {expr}")
        hk, hv = _name(m.group(1), kw), _values(kw)[m.group(2)]
        out = [r for r in table(kw["TableName"]) if same(r.get(hk), hv)]
        if m.group(3):
            rk, rv = _name(m.group(3), kw), _values(kw)[m.group(4)]["S"]
            out = [r for r in out if r.get(rk, {}).get("S", "").startswith(rv)]
        return {"Items": out, "Count": len(out)}

    def scan(self, **kw):
        calls.append({"op": "scan", "table": kw["TableName"]})
        return {"Items": list(table(kw["TableName"])), "Count": len(table(kw["TableName"]))}

    def get_paginator(self, op):
        me = self

        class P:
            def paginate(self, **kw):
                yield getattr(me, op)(**kw)
        return P()


def _refuse(*a, **k):
    raise RuntimeError("seed-run: no AWS client may be made")


# ---------------------------------------------------------------- node runs of the department seed

_real_run = subprocess.run
_real_popen = subprocess.Popen


def _run_node(cmd, **kw):
    """The harness's own node run: subprocess.run needs the real Popen, which the seed itself may not use."""
    subprocess.Popen = _real_popen
    try:
        return _real_run(cmd, **kw)
    finally:
        subprocess.Popen = _popen


def _seed_run(argv, **kw):
    args = [str(a) for a in (argv if isinstance(argv, (list, tuple)) else str(argv).split())]
    script = next((a for a in args if a.replace("\\", "/").endswith("company-seeds/departments.mjs")), None)
    if script is None:
        calls.append({"op": "subprocess", "refused": args})
        raise RuntimeError(f"seed-run: subprocess refused: {' '.join(args)[:200]}")
    rest = args[args.index(script) + 1:]
    tmp = tempfile.mkdtemp(prefix="rec14-seed-")
    wfile, out = os.path.join(tmp, "world.json"), os.path.join(tmp, "after.json")
    json.dump({"tables": tables, "secrets": {}, "pageSize": 3, "cognito": {"users": []}}, open(wfile, "w"))
    env = {"PATH": f"{os.path.join(fake_aws, 'bin')}:{os.environ.get('PATH', '')}", "TEN03_WORLD": wfile, "TEN03_WORLD_OUT": out,
           "AWS_REGION": "af-south-1", "AWS_ACCESS_KEY_ID": "rec14-fake", "AWS_SECRET_ACCESS_KEY": "rec14-fake"}
    p = _run_node(["node", "--no-warnings", "--require", os.path.join(fake_aws, "cjs-hook.cjs"), "--import",
                   os.path.join(fake_aws, "register.mjs"), os.path.join(fake_aws, "script-run.mjs"), script, *rest],
                  capture_output=True, text=True, env=env, timeout=60)
    calls.append({"op": "node", "script": "company-seeds/departments.mjs", "args": rest, "code": p.returncode})
    if os.path.exists(out):
        after = json.load(open(out))
        tables.clear()
        tables.update(after["tables"])
    if kw.get("check") and p.returncode != 0:
        raise subprocess.CalledProcessError(p.returncode, args, p.stdout, p.stderr)
    return subprocess.CompletedProcess(args, p.returncode, p.stdout if kw.get("capture_output") or kw.get("stdout") else None, p.stderr if kw.get("capture_output") or kw.get("stderr") else None)


def _check_call(argv, **kw):
    _seed_run(argv, check=True)
    return 0


def _call(argv, **kw):
    return _seed_run(argv).returncode


def _check_output(argv, **kw):
    return _seed_run(argv, check=True, capture_output=True).stdout or ""


def _popen(*a, **k):
    raise RuntimeError("seed-run: subprocess.Popen refused (use subprocess.run)")


subprocess.run = _seed_run
subprocess.check_call = _check_call
subprocess.call = _call
subprocess.check_output = _check_output
subprocess.Popen = _popen
os.system = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("seed-run: os.system refused"))

boto3 = types.ModuleType("boto3")
boto3.client = _refuse
boto3.resource = _refuse
botocore = types.ModuleType("botocore")
exc = types.ModuleType("botocore.exceptions")


class ClientError(Exception):
    pass


exc.ClientError = ClientError
botocore.exceptions = exc
sys.modules.update({"boto3": boto3, "botocore": botocore, "botocore.exceptions": exc})

spec = importlib.util.spec_from_file_location("seed_dev", seed_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
fn = getattr(mod, "seed_departments", None)
if fn is None:
    print("@@REC14@@" + json.dumps({"error": "scripts/ci/seed-dev.py has no seed_departments(ddb)"}))
    sys.exit(0)
try:
    returned = fn(FakeDdb())
    print("@@REC14@@" + json.dumps({"tables": tables, "calls": calls, "returned": returned}))
except Exception as e:  # noqa: BLE001 - the test reads the words
    print("@@REC14@@" + json.dumps({"error": f"{type(e).__name__}: {e}", "tables": tables, "calls": calls}))
