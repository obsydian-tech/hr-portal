"""ONB-19: what api/openapi.yaml says about one field of one answer, and which /v1/me paths it has.
python3 openapi_step.py <spec> <path> <method> <status> <field path>

Same walk as ONB-10's openapi_field.py (copied, code added only: `nullable` and `enum`, and the list of every path that
starts with /v1/me). Output (JSON): { found, type, nullable, enum, paths }.
"""
import json
import sys

import yaml

spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
path, method, status, field = sys.argv[2], sys.argv[3].lower(), sys.argv[4], sys.argv[5]
paths = sorted(p for p in (spec.get("paths") or {}) if p == "/v1/me" or p.startswith("/v1/me/"))


def resolve(node, depth=0):
    if depth > 30 or not isinstance(node, dict):
        return node if isinstance(node, dict) else {}
    if "$ref" in node:
        target = spec
        for part in node["$ref"][2:].split("/"):
            target = target[part]
        return resolve(target, depth + 1)
    return node


def prop(node, name, depth=0):
    node = resolve(node)
    if depth > 30:
        return None
    if name in (node.get("properties") or {}):
        return resolve(node["properties"][name])
    for part in node.get("allOf") or []:
        found = prop(part, name, depth + 1)
        if found is not None:
            return found
    return None


def nothing():
    print(json.dumps({"found": False, "paths": paths}))
    raise SystemExit(0)


op = ((spec.get("paths") or {}).get(path) or {}).get(method)
responses = (op or {}).get("responses") or {}
answer = responses.get(status) or responses.get(int(status))
if not op or not answer:
    nothing()
answer = resolve(answer)
schemas = [resolve(m.get("schema") or {}) for m in (answer.get("content") or {}).values()]
if not schemas:
    nothing()
node = schemas[0]
for part in field.split("."):
    node = prop(node, part)
    if node is None:
        nothing()

kind = node.get("type")
nullable = bool(node.get("nullable")) or (isinstance(kind, list) and "null" in kind)
if isinstance(kind, list):
    kind = next((k for k in kind if k != "null"), None)
print(json.dumps({"found": True, "type": kind, "nullable": nullable, "enum": node.get("enum"), "paths": paths}))
