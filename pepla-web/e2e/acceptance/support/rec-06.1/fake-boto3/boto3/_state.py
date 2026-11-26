"""REC-06.1: the fake world one back-fill run sees (read from REC061_WORLD) and every call it made. See __init__.py."""
import json
import os

_WORLD = json.load(open(os.environ["REC061_WORLD"]))
TABLES = _WORLD.setdefault("tables", {})
RACE = list(_WORLD.get("race", []))
PAGE_SIZE = int(_WORLD.get("pageSize", 3))
CALLS = []
KEYS = {"employees": ["employee_id"], "talent-flow-state": ["PK", "SK"]}
# The seed test (AC-10) lets put_item and delete_item run; the back-fill test (AC-8) never does.
WRITES = bool(_WORLD.get("allowWrites", False))
INDEXES = {"email-index": ["email"], "tenant-index": ["tenant_id"]}
# rec-06.1.1: the account id sts.get_caller_identity answers.
ACCOUNT = str(_WORLD.get("account", "000000000000"))
