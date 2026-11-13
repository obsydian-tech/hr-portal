"""
Fake boto3 for the BE-16 acceptance tests (AC-4, AC-5). Never talks to AWS.

be-16.spec.ts runs the real scripts/ci/seed-dev.py with this folder first on
PYTHONPATH, so `import boto3` lands here. It behaves like the parts of AWS the
seed touches, the way the real services answer:

  * Cognito: pools and their groups come from the config. CreateGroup on an
    existing group raises GroupExistsException; GetGroup, and AdminAddUserToGroup
    into a group that does not exist, raise ResourceNotFoundException.
  * STS says the account is pepla-dev. Secrets Manager returns made-up logins.
    DynamoDB accepts writes and has no documents.

Every call, with its parameters and any error it raised, is appended as one
JSON line to the file named by BE16_CALLS. The config is the JSON file named
by BE16_FAKE: {"account", "pools": {name: {"id", "groups": [...]}}, "password"}.
"""
import json
import os

from botocore.exceptions import ClientError

_CFG = json.load(open(os.environ["BE16_FAKE"]))
_LOG = os.environ["BE16_CALLS"]
_POOLS = {name: {"id": p["id"], "groups": list(p["groups"])} for name, p in _CFG["pools"].items()}
_BY_ID = {p["id"]: p for p in _POOLS.values()}
_USERS = {}  # (pool id, username) -> set of groups


def _pascal(name):
    return "".join(part[:1].upper() + part[1:] for part in name.split("_"))


def _log(service, op, params, error=None):
    with open(_LOG, "a") as f:
        f.write(json.dumps({"service": service, "op": op, "params": params, "error": error}, default=str) + "\n")


class _Exceptions:
    """client.exceptions.<Code>: one ClientError subclass per error code, like botocore."""

    def __init__(self):
        self._made = {}

    def __getattr__(self, code):
        if code.startswith("_"):
            raise AttributeError(code)
        if code not in self._made:
            self._made[code] = type(code, (ClientError,), {})
        return self._made[code]


_EXC = _Exceptions()


def _raise(code, op, message="fake"):
    raise getattr(_EXC, code)({"Error": {"Code": code, "Message": message}}, op)


class _Paginator:
    def __init__(self, client, name):
        self._client, self._name = client, name

    def paginate(self, **params):
        yield getattr(self._client, self._name)(**params)


class _Client:
    service = "?"

    def __init__(self, region_name=None):
        self.exceptions = _EXC
        self.meta = type("Meta", (), {"region_name": region_name})()

    def get_paginator(self, name):
        return _Paginator(self, name)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        op = _pascal(name)

        def call(**params):
            handler = getattr(type(self), "_op_" + name, None)
            try:
                out = handler(self, op, **params) if handler else {}
            except ClientError as e:
                _log(self.service, op, params, e.response["Error"]["Code"])
                raise
            _log(self.service, op, params)
            return out

        return call


class _Sts(_Client):
    service = "sts"

    def _op_get_caller_identity(self, op, **_):
        return {"Account": _CFG["account"], "UserId": "FAKE", "Arn": f"arn:aws:sts::{_CFG['account']}:assumed-role/fake/ci"}


class _Cognito(_Client):
    service = "cognito-idp"

    def _pool(self, op, pool_id):
        if pool_id not in _BY_ID:
            _raise("ResourceNotFoundException", op, "User pool does not exist.")
        return _BY_ID[pool_id]

    def _op_list_user_pools(self, op, **_):
        return {"UserPools": [{"Id": p["id"], "Name": n} for n, p in _POOLS.items()]}

    def _op_describe_user_pool(self, op, UserPoolId, **_):
        self._pool(op, UserPoolId)
        name = next(n for n, p in _POOLS.items() if p["id"] == UserPoolId)
        return {"UserPool": {"Id": UserPoolId, "Name": name}}

    def _op_list_groups(self, op, UserPoolId, **_):
        return {"Groups": [{"GroupName": g, "UserPoolId": UserPoolId} for g in self._pool(op, UserPoolId)["groups"]]}

    def _op_get_group(self, op, GroupName, UserPoolId, **_):
        if GroupName not in self._pool(op, UserPoolId)["groups"]:
            _raise("ResourceNotFoundException", op, "Group not found.")
        return {"Group": {"GroupName": GroupName, "UserPoolId": UserPoolId}}

    def _op_create_group(self, op, GroupName, UserPoolId, **_):
        pool = self._pool(op, UserPoolId)
        if GroupName in pool["groups"]:
            _raise("GroupExistsException", op, "A group with the name already exists.")
        pool["groups"].append(GroupName)
        return {"Group": {"GroupName": GroupName, "UserPoolId": UserPoolId}}

    def _op_admin_create_user(self, op, UserPoolId, Username, **_):
        self._pool(op, UserPoolId)
        if (UserPoolId, Username) in _USERS:
            _raise("UsernameExistsException", op, "User account already exists.")
        _USERS[(UserPoolId, Username)] = set()
        return {"User": {"Username": Username}}

    def _user(self, op, UserPoolId, Username):
        self._pool(op, UserPoolId)
        if (UserPoolId, Username) not in _USERS:
            _raise("UserNotFoundException", op, "User does not exist.")
        return _USERS[(UserPoolId, Username)]

    def _op_admin_get_user(self, op, UserPoolId, Username, **_):
        self._user(op, UserPoolId, Username)
        return {"Username": Username, "UserAttributes": []}

    def _op_admin_update_user_attributes(self, op, UserPoolId, Username, **_):
        self._user(op, UserPoolId, Username)
        return {}

    def _op_admin_set_user_password(self, op, UserPoolId, Username, **_):
        self._user(op, UserPoolId, Username)
        return {}

    def _op_admin_add_user_to_group(self, op, UserPoolId, Username, GroupName, **_):
        groups = self._user(op, UserPoolId, Username)
        if GroupName not in self._pool(op, UserPoolId)["groups"]:
            _raise("ResourceNotFoundException", op, "Group not found.")
        groups.add(GroupName)
        return {}

    def _op_admin_list_groups_for_user(self, op, UserPoolId, Username, **_):
        return {"Groups": [{"GroupName": g} for g in sorted(self._user(op, UserPoolId, Username))]}


class _Secrets(_Client):
    service = "secretsmanager"

    def _op_get_secret_value(self, op, SecretId, **_):
        role = SecretId.rsplit("/", 1)[-1]
        return {"SecretString": json.dumps({"username": f"pepla-e2e-{role}@blackhole.postmarkapp.com",
                                            "password": _CFG["password"]})}


class _Dynamo(_Client):
    service = "dynamodb"

    def _op_query(self, op, **_):
        return {"Items": [], "Count": 0}

    def _op_scan(self, op, **_):
        return {"Items": [], "Count": 0}


_SERVICES = {"sts": _Sts, "cognito-idp": _Cognito, "secretsmanager": _Secrets, "dynamodb": _Dynamo}


def client(service_name, *args, region_name=None, **kwargs):
    if service_name not in _SERVICES:
        raise RuntimeError(f"fake boto3: no fake for {service_name}")
    return _SERVICES[service_name](region_name=region_name)


def resource(*args, **kwargs):
    raise RuntimeError("fake boto3: resource() is not supported")


from .session import Session  # noqa: E402  (after client is defined)
