"""Prints what api/openapi.yaml says about one field of one answer:
python3 openapi_field.py <spec> <path> <method> <status> <field path>

The field path walks the answer's schema: "employee.step" is the `step` property of the `employee` property;
"items[].step" is the `step` property of each item of the `items` array. $ref and allOf are followed.

Output (JSON): found (the path, method, status and field are all there), and for the field: type, enum,
nullable (OpenAPI 3.0 `nullable: true`, a 3.1 type list holding "null", or null in the enum) and description.
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
    """The schema of property `name` of `node`, following allOf; None when it has none."""
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
for part in field.split("."):
    array = part.endswith("[]")
    name = part[:-2] if array else part
    node = prop(node, name)
    if node is None:
        nothing()
    if array:
        node = resolve(node.get("items") or {})

types = node.get("type")
enum = node.get("enum")
nullable = bool(node.get("nullable")) or (isinstance(types, list) and "null" in types) or (isinstance(enum, list) and None in enum)
print(json.dumps({
    "found": True,
    "type": types,
    "enum": [e for e in enum if e is not None] if isinstance(enum, list) else None,
    "nullable": nullable,
    "description": node.get("description") or "",
}))
