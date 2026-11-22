#!/usr/bin/env python3
"""
REC-04: runs the pepla-dev seed's REC-04 part (scripts/ci/seed-dev.py, seed_rec04) against an in-memory DynamoDB, with no AWS.

  python3 seed-run.py <seed-dev.py> <world.json> <tenant id> <manager sub>

world.json is {"tables": {name: [item, ...]}} with items in DynamoDB's AttributeValue form. The tables after the run, and the
calls made, are printed as one line: @@REC04@@{"tables": ..., "calls": [...], "returned": ...}. boto3 is replaced before the seed
file is loaded, so nothing reaches AWS. Only the calls the seed functions use are answered: put_item, delete_item, get_item,
update_item (SET only), query (a key condition of one equality and an optional begins_with) and scan. Anything else fails.
"""
import importlib.util
import json
import re
import sys
import types

seed_path, world_path, tenant_id, manager_sub = sys.argv[1:5]
world = json.load(open(world_path))
tables = world.setdefault("tables", {})
calls = []
KEYS = {"talent-flow-state": ["PK", "SK"], "talent-flow-roles": ["pk", "sk"], "naleko-people-dev-tenants": ["pk", "sk"]}


class ResourceNotFoundException(Exception):
    pass


class ConditionalCheckFailedException(Exception):
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


def _names(kw):
    return kw.get("ExpressionAttributeNames", {})


def _name(n, kw):
    return _names(kw).get(n, n)


def _cond_ok(kw, current):
    c = kw.get("ConditionExpression")
    if not c:
        return True
    m = re.fullmatch(r"\s*attribute_not_exists\(\s*([#\w]+)\s*\)\s*", c)
    if m:
        return current is None or _name(m.group(1), kw) not in current
    m = re.fullmatch(r"\s*attribute_exists\(\s*([#\w]+)\s*\)\s*", c)
    if m:
        return current is not None and _name(m.group(1), kw) in current
    raise RuntimeError(f"seed-run: condition not understood: {c}")


class FakeDdb:
    class exceptions:
        pass

    def __init__(self):
        self.exceptions.ResourceNotFoundException = ResourceNotFoundException
        self.exceptions.ConditionalCheckFailedException = ConditionalCheckFailedException

    def put_item(self, **kw):
        calls.append({"op": "put_item", "table": kw["TableName"]})
        rows = table(kw["TableName"])
        k = key_of(kw["TableName"], kw["Item"])
        at = next((i for i, r in enumerate(rows) if same(key_of(kw["TableName"], r), k)), None)
        if not _cond_ok(kw, rows[at] if at is not None else None):
            raise ConditionalCheckFailedException("The conditional request failed")
        if at is None:
            rows.append(kw["Item"])
        else:
            rows[at] = kw["Item"]
        return {}

    def delete_item(self, **kw):
        calls.append({"op": "delete_item", "table": kw["TableName"]})
        rows = table(kw["TableName"])
        tables[kw["TableName"]] = [r for r in rows if not same(key_of(kw["TableName"], r), kw["Key"])]
        return {}

    def get_item(self, **kw):
        calls.append({"op": "get_item", "table": kw["TableName"]})
        for r in table(kw["TableName"]):
            if same(key_of(kw["TableName"], r), kw["Key"]):
                return {"Item": r}
        return {}

    def update_item(self, **kw):
        calls.append({"op": "update_item", "table": kw["TableName"]})
        rows = table(kw["TableName"])
        at = next((i for i, r in enumerate(rows) if same(key_of(kw["TableName"], r), kw["Key"])), None)
        cur = rows[at] if at is not None else None
        if not _cond_ok(kw, cur):
            raise ConditionalCheckFailedException("The conditional request failed")
        item = dict(cur or kw["Key"])
        expr = kw.get("UpdateExpression", "")
        m = re.fullmatch(r"\s*SET\s+(.*)", expr, re.S)
        if not m:
            raise RuntimeError(f"seed-run: update not understood: {expr}")
        for part in m.group(1).split(","):
            left, right = [x.strip() for x in part.split("=", 1)]
            item[_name(left, kw)] = _values(kw)[right]
        if at is None:
            rows.append(item)
        else:
            rows[at] = item
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
fn = getattr(mod, "seed_rec04", None)
if fn is None:
    print("@@REC04@@" + json.dumps({"error": "scripts/ci/seed-dev.py has no seed_rec04(ddb, tenant_id, manager_sub)"}))
    sys.exit(0)
try:
    returned = fn(FakeDdb(), tenant_id, manager_sub)
    print("@@REC04@@" + json.dumps({"tables": tables, "calls": calls, "returned": returned}))
except Exception as e:  # noqa: BLE001 - the test reads the words
    print("@@REC04@@" + json.dumps({"error": f"{type(e).__name__}: {e}", "tables": tables, "calls": calls}))
