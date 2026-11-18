"""MOD-01: runs scripts/ci/seed-dev.py once against a fake boto3, so a test can read what the pepla-dev seed leaves
in the company list without touching AWS.

    python3 seed-run.py <seed-dev.py> <world.json> <after.json>

world.json: {"tables": {table name: [items as DynamoDB stores them]}}. after.json gets the tables after the run and
the calls made. STS says pepla-dev (424556617428). Cognito knows both pools and every group the seed names, and each
user's sub is "sub-<username>". Secrets Manager answers a password for any secret. DynamoDB keeps rows for the
tenants, employees, documents, document-verification and employee_consents tables and supports PutItem, UpdateItem (SET, ADD, REMOVE,
DELETE, if_not_exists), GetItem, DeleteItem and Query/Scan pages, with conditions made of attribute_exists,
attribute_not_exists, =, <>, AND, OR, NOT and parentheses. Any other call is recorded and answers {}.
"""
import json
import re
import runpy
import sys
import types

SEED, WORLD_IN, WORLD_OUT = sys.argv[1], sys.argv[2], sys.argv[3]
world = json.load(open(WORLD_IN))
tables = world.setdefault("tables", {})
calls = []
KEYS = {
    "naleko-people-dev-tenants": ["pk", "sk"],
    "employees": ["employee_id"],
    "documents": ["employee_id", "document_id"],
    "employee_consents": ["employee_id", "notice_version"],
    "document-verification": ["verificationId"],
}


class ClientError(Exception):
    def __init__(self, error_response=None, operation_name=""):
        self.response = error_response or {"Error": {"Code": "Unknown", "Message": ""}}
        self.operation_name = operation_name
        super().__init__(self.response["Error"].get("Message", ""))


def client_error(code):
    cls = type(code, (ClientError,), {})
    return cls


class Exceptions:
    def __init__(self, *names):
        for n in names:
            setattr(self, n, client_error(n))


def fail(exc_cls, code):
    return exc_cls({"Error": {"Code": code, "Message": code}}, "op")


# ---------------------------------------------------------------- expressions

def name_of(tok, names):
    tok = tok.strip()
    return names.get(tok, tok) if tok.startswith("#") else tok


def condition_holds(expr, item, names, values):
    if not expr:
        return True
    src = expr
    src = re.sub(r"attribute_not_exists\s*\(\s*([#\w.]+)\s*\)", lambda m: f" (not HAS({name_of(m.group(1), names)!r})) ", src)
    src = re.sub(r"attribute_exists\s*\(\s*([#\w.]+)\s*\)", lambda m: f" HAS({name_of(m.group(1), names)!r}) ", src)
    src = re.sub(r"([#\w.]+)\s*(=|<>)\s*(:\w+)", lambda m: f" {'EQ' if m.group(2) == '=' else 'NE'}({name_of(m.group(1), names)!r}, {m.group(3)!r}) ", src)
    src = re.sub(r"\bAND\b", " and ", src)
    src = re.sub(r"\bOR\b", " or ", src)
    src = re.sub(r"\bNOT\b", " not ", src)
    env = {
        "HAS": lambda n: n in item,
        "EQ": lambda n, v: n in item and item[n] == values.get(v),
        "NE": lambda n, v: not (n in item and item[n] == values.get(v)),
    }
    try:
        return bool(eval(src, {"__builtins__": {}}, env))
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"seed-run fake: cannot read the condition {expr!r}: {e}")


def split_top(s):
    out, depth, cur = [], 0, ""
    for c in s:
        if c == "(":
            depth += 1
        if c == ")":
            depth -= 1
        if c == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += c
    if cur.strip():
        out.append(cur.strip())
    return out


def apply_update(item, expr, names, values):
    marks = list(re.finditer(r"\b(SET|REMOVE|ADD|DELETE)\b", expr, re.I))
    if not marks:
        raise RuntimeError(f"seed-run fake: cannot read the update {expr!r}")
    for i, m in enumerate(marks):
        body = expr[m.end(): marks[i + 1].start() if i + 1 < len(marks) else len(expr)]
        kind = m.group(1).upper()
        for part in split_top(body):
            if kind == "SET":
                left, right = part.split("=", 1)
                n = name_of(left, names)
                right = right.strip()
                f = re.match(r"if_not_exists\s*\(\s*([#\w.]+)\s*,\s*(:\w+)\s*\)", right)
                if f:
                    cur = item.get(name_of(f.group(1), names))
                    item[n] = cur if cur is not None else values[f.group(2)]
                elif right.startswith(":"):
                    item[n] = values[right]
                else:
                    item[n] = item.get(name_of(right, names))
            elif kind == "REMOVE":
                item.pop(name_of(part, names), None)
            else:
                p, v = part.split()
                n = name_of(p, names)
                val = values[v]
                cur = item.get(n)
                if kind == "ADD":
                    if "SS" in val:
                        item[n] = {"SS": sorted(set((cur or {}).get("SS", [])) | set(val["SS"]))}
                    elif "N" in val:
                        item[n] = {"N": str(float((cur or {"N": "0"})["N"]) + float(val["N"]))}
                else:
                    if cur and "SS" in cur:
                        left = [x for x in cur["SS"] if x not in val["SS"]]
                        if left:
                            item[n] = {"SS": left}
                        else:
                            item.pop(n, None)
    return item


# ---------------------------------------------------------------- clients

class Paginator:
    def __init__(self, fn):
        self.fn = fn

    def paginate(self, **kw):
        return self.fn(**kw)


class Generic:
    service = "generic"

    def __getattr__(self, name):
        def call(*a, **kw):
            calls.append({"service": self.service, "op": name})
            return {}
        return call


class STS(Generic):
    service = "sts"

    def get_caller_identity(self, **kw):
        calls.append({"service": "sts", "op": "get_caller_identity"})
        return {"Account": "424556617428", "Arn": "arn:aws:sts::424556617428:assumed-role/pepla-github-deploy-dev/seed", "UserId": "AROASEED:seed"}


SEED_STRINGS = sorted(set(re.findall(r"""["']([\w-]+)["']""", open(SEED).read())))


class Cognito(Generic):
    service = "cognito-idp"

    def __init__(self):
        self.exceptions = Exceptions("GroupExistsException", "UsernameExistsException", "UserNotFoundException", "ResourceNotFoundException")

    def get_paginator(self, op):
        if op == "list_user_pools":
            return Paginator(lambda **kw: [{"UserPools": [{"Id": "af-south-1_NalekoFake", "Name": "naleko-dev-user-pool"}, {"Id": "af-south-1_TfFake", "Name": "talent-flow-user-pool"}]}])
        if op == "list_groups":
            return Paginator(lambda **kw: [{"Groups": [{"GroupName": g} for g in SEED_STRINGS]}])
        if op in ("list_users", "list_users_in_group"):
            return Paginator(lambda **kw: [{"Users": []}])
        raise RuntimeError(f"seed-run fake: no paginator {op}")

    def create_group(self, **kw):
        calls.append({"service": self.service, "op": "create_group"})
        raise fail(self.exceptions.GroupExistsException, "GroupExistsException")

    def admin_get_user(self, **kw):
        calls.append({"service": self.service, "op": "admin_get_user"})
        return {"Username": kw.get("Username"), "UserAttributes": [{"Name": "sub", "Value": "sub-" + str(kw.get("Username"))}, {"Name": "email", "Value": str(kw.get("Username"))}]}


class Secrets(Generic):
    service = "secretsmanager"

    def __init__(self):
        self.exceptions = Exceptions("ResourceNotFoundException")

    def get_secret_value(self, **kw):
        calls.append({"service": self.service, "op": "get_secret_value"})
        return {"SecretString": json.dumps({"username": "seed@example.test", "password": "Pp1!seedrunfakepassword"})}


class DDB(Generic):
    service = "dynamodb"

    def __init__(self):
        self.exceptions = Exceptions("ResourceNotFoundException", "ConditionalCheckFailedException")

    def _rows(self, t):
        if t not in KEYS:
            raise fail(self.exceptions.ResourceNotFoundException, "ResourceNotFoundException")
        return tables.setdefault(t, [])

    def _find(self, t, key):
        for i, r in enumerate(self._rows(t)):
            if all(r.get(k) == key.get(k) for k in KEYS[t]):
                return i, r
        return -1, None

    def put_item(self, TableName, Item, ConditionExpression=None, ExpressionAttributeNames=None, ExpressionAttributeValues=None, **kw):
        calls.append({"service": self.service, "op": "PutItem", "table": TableName})
        at, old = self._find(TableName, Item)
        if not condition_holds(ConditionExpression, old or {}, ExpressionAttributeNames or {}, ExpressionAttributeValues or {}):
            raise fail(self.exceptions.ConditionalCheckFailedException, "ConditionalCheckFailedException")
        if at >= 0:
            tables[TableName][at] = Item
        else:
            tables[TableName].append(Item)
        return {}

    def update_item(self, TableName, Key, UpdateExpression, ConditionExpression=None, ExpressionAttributeNames=None, ExpressionAttributeValues=None, **kw):
        calls.append({"service": self.service, "op": "UpdateItem", "table": TableName})
        at, old = self._find(TableName, Key)
        names, values = ExpressionAttributeNames or {}, ExpressionAttributeValues or {}
        if not condition_holds(ConditionExpression, old or {}, names, values):
            raise fail(self.exceptions.ConditionalCheckFailedException, "ConditionalCheckFailedException")
        item = apply_update(json.loads(json.dumps(old)) if old else dict(Key), UpdateExpression, names, values)
        item.update(Key)
        if at >= 0:
            tables[TableName][at] = item
        else:
            tables[TableName].append(item)
        return {"Attributes": item}

    def get_item(self, TableName, Key, **kw):
        calls.append({"service": self.service, "op": "GetItem", "table": TableName})
        _, old = self._find(TableName, Key)
        return {"Item": old} if old else {}

    def delete_item(self, TableName, Key, **kw):
        calls.append({"service": self.service, "op": "DeleteItem", "table": TableName})
        at, _ = self._find(TableName, Key)
        if at >= 0:
            tables[TableName].pop(at)
        return {}

    def _query(self, TableName, KeyConditionExpression=None, ExpressionAttributeValues=None, ExpressionAttributeNames=None, **kw):
        rows = self._rows(TableName)
        m = re.match(r"\s*([#\w]+)\s*=\s*(:\w+)", KeyConditionExpression or "")
        if not m:
            return list(rows)
        n = name_of(m.group(1), ExpressionAttributeNames or {})
        v = (ExpressionAttributeValues or {})[m.group(2)]
        return [r for r in rows if r.get(n) == v]

    def query(self, **kw):
        calls.append({"service": self.service, "op": "Query", "table": kw.get("TableName")})
        return {"Items": self._query(**kw)}

    def get_paginator(self, op):
        if op == "query":
            return Paginator(lambda **kw: [{"Items": [dict(r) for r in self._query(**kw)]}])
        if op == "scan":
            return Paginator(lambda **kw: [{"Items": [dict(r) for r in self._rows(kw["TableName"])]}])
        raise RuntimeError(f"seed-run fake: no paginator {op}")


class S3(Generic):
    service = "s3"


def client(service, *a, **kw):
    return {"sts": STS, "cognito-idp": Cognito, "secretsmanager": Secrets, "dynamodb": DDB, "s3": S3}.get(service, Generic)()


boto3 = types.ModuleType("boto3")
boto3.client = client
botocore = types.ModuleType("botocore")
botocore_exceptions = types.ModuleType("botocore.exceptions")
botocore_exceptions.ClientError = ClientError
botocore.exceptions = botocore_exceptions
sys.modules["boto3"] = boto3
sys.modules["botocore"] = botocore
sys.modules["botocore.exceptions"] = botocore_exceptions

code = 0
try:
    runpy.run_path(SEED, run_name="__main__")
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
except Exception as e:  # noqa: BLE001
    print(f"seed-run: the seed failed: {type(e).__name__}: {e}", file=sys.stderr)
    code = 1
json.dump({"code": code, "tables": tables, "calls": calls}, open(WORLD_OUT, "w"))
