"""
Fake boto3 for the REC-06.2 back-fill test (AC-8). Never talks to AWS.

run-script.py puts this folder first, so the real scripts/backfill/lowercase-employee-emails.py imports this. It answers DynamoDB the way
the real service does for the calls a careful back-fill makes:

  * client("dynamodb") (also from Session(...).client): scan (pages of world.pageSize rows with LastEvaluatedKey, ProjectionExpression,
    FilterExpression), query (a table or an index, KeyConditionExpression and FilterExpression), get_item, update_item (SET and REMOVE,
    ConditionExpression; a failed condition raises ConditionalCheckFailedException as a ClientError, as boto3 does) and
    get_paginator("scan" | "query").
  * resource("dynamodb").Table(name): the same calls with plain Python values (strings, numbers, dicts) and string expressions.
  * put_item, delete_item, batch_write_item and transact_write_items are recorded and then refused: the back-fill must never write a
    whole row, merge or delete (REC-06.2 rule 9). Only when the world says allowWrites (the seed test, AC-10) do put_item and
    delete_item run, with their ConditionExpression; batch and transactions stay refused.
  * Any other service is refused.

world.race = [{employee_id, set}]: just before the first update_item on that employee's row, the row's attributes in `set` are changed,
as if someone else wrote it between the script's read and its write. Every call is recorded (op, params, error) in _state.CALLS.
"""
import copy
import json
import re

from botocore.exceptions import ClientError

from . import _state


# ---------------------------------------------------------------- expressions

_TOKEN = re.compile(r"\s*(<>|<=|>=|=|<|>|\(|\)|,|:[A-Za-z0-9_]+|#[A-Za-z0-9_]+(?:\.#?[A-Za-z0-9_]+)*|[A-Za-z_][A-Za-z0-9_]*(?:\.#?[A-Za-z0-9_]+)*)")


def _tokens(text):
    out, pos = [], 0
    text = text or ""
    while pos < len(text):
        if text[pos:].strip() == "":
            break
        m = _TOKEN.match(text, pos)
        if not m:
            raise RuntimeError(f"fake boto3: expression not understood: {text!r}")
        out.append(m.group(1))
        pos = m.end()
    return out


def _path(token, names):
    parts = []
    for part in token.split("."):
        if part.startswith("#"):
            if part not in (names or {}):
                raise ClientError({"Error": {"Code": "ValidationException", "Message": f"name {part} not defined"}}, "Expression")
            parts.append(names[part])
        else:
            parts.append(part)
    return parts


def _get(item, parts):
    cur = {"M": item}
    for p in parts:
        if not isinstance(cur, dict) or "M" not in cur or p not in cur["M"]:
            return None
        cur = cur["M"][p]
    return cur


def _cmp_key(v):
    if v is None:
        return None
    if "N" in v:
        return float(v["N"])
    if "S" in v:
        return v["S"]
    return json.dumps(v, sort_keys=True)


class _Parser:
    def __init__(self, text, names, values):
        self.t, self.i, self.names, self.values = _tokens(text), 0, names or {}, values or {}

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self, want=None):
        tok = self.peek()
        if want is not None and (tok or "").upper() != want:
            raise RuntimeError(f"fake boto3: expected {want}, got {tok}")
        self.i += 1
        return tok

    def parse(self):
        f = self.orx()
        if self.peek() is not None:
            raise RuntimeError(f"fake boto3: expression not understood near {self.peek()}")
        return f

    def orx(self):
        f = self.andx()
        while (self.peek() or "").upper() == "OR":
            self.take()
            a, b = f, self.andx()
            f = (lambda a, b: lambda it: a(it) or b(it))(a, b)
        return f

    def andx(self):
        f = self.notx()
        while (self.peek() or "").upper() == "AND":
            self.take()
            a, b = f, self.notx()
            f = (lambda a, b: lambda it: a(it) and b(it))(a, b)
        return f

    def notx(self):
        if (self.peek() or "").upper() == "NOT":
            self.take()
            a = self.notx()
            return lambda it: not a(it)
        return self.atom()

    def operand(self):
        tok = self.take()
        if tok.startswith(":"):
            if tok not in self.values:
                raise ClientError({"Error": {"Code": "ValidationException", "Message": f"value {tok} not defined"}}, "Expression")
            v = self.values[tok]
            return lambda it: v
        parts = _path(tok, self.names)
        return lambda it: _get(it, parts)

    def atom(self):
        tok = self.peek()
        if tok == "(":
            self.take()
            f = self.orx()
            self.take(")")
            return f
        low = (tok or "").lower()
        if low in ("attribute_exists", "attribute_not_exists", "begins_with", "contains"):
            self.take()
            self.take("(")
            parts = _path(self.take(), self.names)
            arg = None
            if low in ("begins_with", "contains"):
                self.take(",")
                arg = self.operand()
            self.take(")")
            if low == "attribute_exists":
                return lambda it: _get(it, parts) is not None
            if low == "attribute_not_exists":
                return lambda it: _get(it, parts) is None
            if low == "begins_with":
                return lambda it: (_get(it, parts) or {}).get("S", None) is not None and _get(it, parts)["S"].startswith(arg(it).get("S", ""))
            return lambda it: (_get(it, parts) or {}).get("S", None) is not None and arg(it).get("S", "") in _get(it, parts)["S"]
        left = self.operand()
        op = self.take()
        if op.upper() == "BETWEEN":
            lo = self.operand()
            self.take("AND")
            hi = self.operand()
            return lambda it: left(it) is not None and _cmp_key(lo(it)) <= _cmp_key(left(it)) <= _cmp_key(hi(it))
        right = self.operand()
        if op == "=":
            return lambda it: left(it) is not None and json.dumps(left(it), sort_keys=True) == json.dumps(right(it), sort_keys=True)
        if op == "<>":
            return lambda it: json.dumps(left(it), sort_keys=True) != json.dumps(right(it), sort_keys=True)
        ops = {"<": lambda a, b: a < b, "<=": lambda a, b: a <= b, ">": lambda a, b: a > b, ">=": lambda a, b: a >= b}
        if op not in ops:
            raise RuntimeError(f"fake boto3: operator {op} not understood")
        return lambda it: left(it) is not None and right(it) is not None and type(_cmp_key(left(it))) is type(_cmp_key(right(it))) and ops[op](_cmp_key(left(it)), _cmp_key(right(it)))


def _cond(text, names, values):
    return _Parser(text, names, values).parse() if text else (lambda it: True)


def _project(item, text, names):
    if not text:
        return item
    keep = [_path(p.strip(), names)[0] for p in text.split(",")]
    return {k: v for k, v in item.items() if k in keep}


def _update(item, text, names, values):
    out = copy.deepcopy(item)
    names = names or {}
    for m in re.finditer(r"(SET|REMOVE)\s+(.*?)(?=\s+(?:SET|REMOVE|ADD|DELETE)\s|$)", text or "", re.S | re.I):
        kind, body = m.group(1).upper(), m.group(2)
        for clause in [c.strip() for c in body.split(",") if c.strip()]:
            if kind == "SET":
                lhs, rhs = [x.strip() for x in clause.split("=", 1)]
                if not rhs.startswith(":") or rhs not in (values or {}):
                    raise RuntimeError(f"fake boto3: SET {clause!r} not understood (only path = :value)")
                parts = _path(lhs, names)
                target = out
                for p in parts[:-1]:
                    target = target.setdefault(p, {"M": {}})["M"]
                target[parts[-1]] = values[rhs]
            else:
                parts = _path(clause, names)
                target = out
                for p in parts[:-1]:
                    target = target.get(p, {}).get("M", {})
                target.pop(parts[-1], None)
    return out


# ---------------------------------------------------------------- the client

class _Exceptions:
    def __init__(self):
        self._made = {"ClientError": ClientError}

    def __getattr__(self, code):
        if code.startswith("_"):
            raise AttributeError(code)
        if code not in self._made:
            self._made[code] = type(code, (ClientError,), {})
        return self._made[code]


_EXC = _Exceptions()


def _raise(code, op, message):
    raise getattr(_EXC, code)({"Error": {"Code": code, "Message": message}}, op)


def _table(name, op):
    if name not in _state.TABLES:
        _raise("ResourceNotFoundException", op, f"Requested resource not found: {name}")
    return _state.TABLES[name]


def _key_of(name, item):
    return {k: item[k] for k in _state.KEYS.get(name, []) if k in item}


def _same(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


class _Paginator:
    def __init__(self, client, name):
        self._client, self._name = client, name

    def paginate(self, **params):
        start = params.pop("ExclusiveStartKey", None)
        while True:
            page = getattr(self._client, self._name)(**params, **({"ExclusiveStartKey": start} if start else {}))
            yield page
            start = page.get("LastEvaluatedKey")
            if not start:
                break


class _Dynamo:
    def __init__(self, region_name=None):
        self.exceptions = _EXC
        self.meta = type("Meta", (), {"region_name": region_name})()

    def get_paginator(self, name):
        if name not in ("scan", "query"):
            raise RuntimeError(f"fake boto3: no paginator {name}")
        return _Paginator(self, name)

    def _log(self, op, params, error=None):
        _state.CALLS.append({"op": op, "params": params, "error": error})

    def _run(self, op, params, fn):
        try:
            out = fn()
        except ClientError as e:
            self._log(op, params, e.response["Error"]["Code"])
            raise
        self._log(op, params)
        return out

    def scan(self, **p):
        def go():
            if p.get("IndexName"):
                raise RuntimeError("fake boto3: scan of an index not supported")
            rows = _table(p["TableName"], "Scan")
            start = 0
            if p.get("ExclusiveStartKey"):
                start = next(i for i, r in enumerate(rows) if _same(_key_of(p["TableName"], r), p["ExclusiveStartKey"])) + 1
            size = min(p.get("Limit") or _state.PAGE_SIZE, _state.PAGE_SIZE)
            page = rows[start:start + size]
            f = _cond(p.get("FilterExpression"), p.get("ExpressionAttributeNames"), p.get("ExpressionAttributeValues"))
            items = [_project(copy.deepcopy(r), p.get("ProjectionExpression"), p.get("ExpressionAttributeNames")) for r in page if f(r)]
            out = {"Items": items, "Count": len(items), "ScannedCount": len(page)}
            if start + size < len(rows) and page:
                out["LastEvaluatedKey"] = _key_of(p["TableName"], page[-1])
            return out
        return self._run("Scan", p, go)

    def query(self, **p):
        def go():
            rows = _table(p["TableName"], "Query")
            idx = p.get("IndexName")
            if idx and idx not in _state.INDEXES:
                _raise("ValidationException", "Query", f"no index {idx}")
            inside = [r for r in rows if not idx or all(a in r for a in _state.INDEXES[idx])]
            k = _cond(p["KeyConditionExpression"], p.get("ExpressionAttributeNames"), p.get("ExpressionAttributeValues"))
            f = _cond(p.get("FilterExpression"), p.get("ExpressionAttributeNames"), p.get("ExpressionAttributeValues"))
            items = [_project(copy.deepcopy(r), p.get("ProjectionExpression"), p.get("ExpressionAttributeNames")) for r in inside if k(r) and f(r)]
            return {"Items": items, "Count": len(items), "ScannedCount": len(items)}
        return self._run("Query", p, go)

    def get_item(self, **p):
        def go():
            rows = _table(p["TableName"], "GetItem")
            hit = next((r for r in rows if _same(_key_of(p["TableName"], r), p["Key"])), None)
            return {"Item": _project(copy.deepcopy(hit), p.get("ProjectionExpression"), p.get("ExpressionAttributeNames"))} if hit else {}
        return self._run("GetItem", p, go)

    def update_item(self, **p):
        def go():
            rows = _table(p["TableName"], "UpdateItem")
            at = next((i for i, r in enumerate(rows) if _same(_key_of(p["TableName"], r), p["Key"])), None)
            for race in list(_state.RACE):
                if at is not None and rows[at].get("employee_id", {}).get("S") == race["employee_id"]:
                    rows[at].update(copy.deepcopy(race["set"]))
                    _state.RACE.remove(race)
            old = rows[at] if at is not None else None
            if not _cond(p.get("ConditionExpression"), p.get("ExpressionAttributeNames"), p.get("ExpressionAttributeValues"))(old or {}):
                _raise("ConditionalCheckFailedException", "UpdateItem", "The conditional request failed")
            new = _update(old or dict(p["Key"]), p.get("UpdateExpression"), p.get("ExpressionAttributeNames"), p.get("ExpressionAttributeValues"))
            new.update(p["Key"])
            if at is None:
                rows.append(new)
            else:
                rows[at] = new
            return {"Attributes": new} if p.get("ReturnValues") in ("ALL_NEW", "UPDATED_NEW") else {}
        return self._run("UpdateItem", p, go)

    def _refused(self, op, p):
        self._log(op, p, "Refused")
        raise RuntimeError(f"fake boto3: {op} is not allowed in the back-fill (rule 9: it never writes whole rows, merges or deletes)")

    def put_item(self, **p):
        if not _state.WRITES:
            self._refused("PutItem", p)

        def go():
            rows = _table(p["TableName"], "PutItem")
            key = _key_of(p["TableName"], p["Item"])
            at = next((i for i, r in enumerate(rows) if _same(_key_of(p["TableName"], r), key)), None)
            if not _cond(p.get("ConditionExpression"), p.get("ExpressionAttributeNames"), p.get("ExpressionAttributeValues"))(rows[at] if at is not None else {}):
                _raise("ConditionalCheckFailedException", "PutItem", "The conditional request failed")
            if at is None:
                rows.append(copy.deepcopy(p["Item"]))
            else:
                rows[at] = copy.deepcopy(p["Item"])
            return {}
        return self._run("PutItem", p, go)

    def delete_item(self, **p):
        if not _state.WRITES:
            self._refused("DeleteItem", p)

        def go():
            rows = _table(p["TableName"], "DeleteItem")
            at = next((i for i, r in enumerate(rows) if _same(_key_of(p["TableName"], r), p["Key"])), None)
            if not _cond(p.get("ConditionExpression"), p.get("ExpressionAttributeNames"), p.get("ExpressionAttributeValues"))(rows[at] if at is not None else {}):
                _raise("ConditionalCheckFailedException", "DeleteItem", "The conditional request failed")
            if at is not None:
                rows.pop(at)
            return {}
        return self._run("DeleteItem", p, go)

    def batch_write_item(self, **p):
        self._refused("BatchWriteItem", p)

    def transact_write_items(self, **p):
        self._refused("TransactWriteItems", p)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        raise RuntimeError(f"fake boto3: dynamodb.{name} is not supported")


# ---------------------------------------------------------------- the resource (plain values)

from .dynamodb.types import TypeDeserializer, TypeSerializer  # noqa: E402

_SER, _DES = TypeSerializer(), TypeDeserializer()


def _to_av(d):
    return {k: _SER.serialize(v) for k, v in (d or {}).items()}


def _from_av(d):
    return {k: _DES.deserialize(v) for k, v in (d or {}).items()}


class _Table:
    def __init__(self, client, name):
        self._c, self.name, self.table_name = client, name, name

    def _wrap(self, p):
        p = dict(p, TableName=self.name)
        for k in ("Key", "ExclusiveStartKey"):
            if k in p:
                p[k] = _to_av(p[k])
        if "ExpressionAttributeValues" in p:
            p["ExpressionAttributeValues"] = _to_av(p["ExpressionAttributeValues"])
        for k in ("FilterExpression", "KeyConditionExpression", "ConditionExpression"):
            if k in p and not isinstance(p[k], str):
                raise RuntimeError("fake boto3: only string expressions are supported (boto3.dynamodb.conditions is not)")
        return p

    def _back(self, out):
        out = dict(out)
        if "Items" in out:
            out["Items"] = [_from_av(i) for i in out["Items"]]
        for k in ("Item", "Attributes", "LastEvaluatedKey"):
            if k in out:
                out[k] = _from_av(out[k])
        return out

    def scan(self, **p):
        return self._back(self._c.scan(**self._wrap(p)))

    def query(self, **p):
        return self._back(self._c.query(**self._wrap(p)))

    def get_item(self, **p):
        return self._back(self._c.get_item(**self._wrap(p)))

    def update_item(self, **p):
        return self._back(self._c.update_item(**self._wrap(p)))

    def put_item(self, **p):
        self._c.put_item(**p)

    def delete_item(self, **p):
        self._c.delete_item(**p)

    def batch_writer(self, *a, **k):
        self._c._refused("BatchWriteItem", {})


class _Resource:
    def __init__(self, region_name=None):
        self._c = _Dynamo(region_name)
        self.meta = type("Meta", (), {"client": self._c})()

    def Table(self, name):  # noqa: N802  (boto3's name)
        return _Table(self._c, name)


def client(service_name, *args, region_name=None, **kwargs):
    if service_name != "dynamodb":
        raise RuntimeError(f"fake boto3: no fake for {service_name}")
    return _Dynamo(region_name)


def resource(service_name, *args, region_name=None, **kwargs):
    if service_name != "dynamodb":
        raise RuntimeError(f"fake boto3: no fake for {service_name}")
    return _Resource(region_name)


from .session import Session  # noqa: E402,F401
