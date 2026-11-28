"""REC-UI-03 feedback-due: the fake world one backfill run sees (read from RUI03T_WORLD) and every call it made. See __init__.py."""
import json
import os

_WORLD = json.load(open(os.environ["RUI03T_WORLD"]))
TABLES = _WORLD.setdefault("tables", {})
PAGE_SIZE = int(_WORLD.get("pageSize", 3))
CALLS = []
KEYS = {"talent-flow-state": ["PK", "SK"]}
# put_item and delete_item run only when the world allows writes.
WRITES = bool(_WORLD.get("allowWrites", False))
INDEXES = {"interview-id-index": ["interviewId"]}
