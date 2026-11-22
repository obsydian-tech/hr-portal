"""ONB-10: what api/openapi.yaml says about one field of one answer, and whether the answer requires it.
python3 openapi_field.py <spec> <path> <method> <status> <field path>

Same walk as ONB-09's openapi_field.py (copied, code added only: `required`, whether the parent object lists the
field as required). "items[].documents_due" is the `documents_due` property of each item of the `items` array.
Output (JSON): { found, type, required }.
"""
import json
import sys

import yaml

spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
path, method, status, field = sys.argv[2], sys.argv[3].lower(), sys.argv[4], sys.argv[5]


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


def required_of(node, depth=0):
    node = resolve(node)
    out = list(node.get("required") or [])
    if depth < 30:
        for part in node.get("allOf") or []:
            out += required_of(part, depth + 1)
    return out


def nothing():
    print(json.dumps({"found": False}))
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
parent = node
name = ""
for part in field.split("."):
    array = part.endswith("[]")
    name = part[:-2] if array else part
    parent = node
    node = prop(node, name)
    if node is None:
        nothing()
    if array:
        node = resolve(node.get("items") or {})

print(json.dumps({"found": True, "type": node.get("type"), "required": name in required_of(parent)}))
