"""Prints what api/openapi.yaml says about one answer: python3 openapi_fields.py <spec> <path> <method> <status>

Output (JSON): found (the path, method and status are there), description (the operation's description
and summary), and properties: for each top-level property of the answer's schema ($ref and allOf
followed), its type, the type and enum of its items, and its description.
"""
import json
import sys

import yaml

spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
path, method, status = sys.argv[2], sys.argv[3].lower(), sys.argv[4]


def resolve(node, depth=0):
    if depth > 30 or not isinstance(node, dict):
        return node or {}
    if "$ref" in node:
        target = spec
        for part in node["$ref"][2:].split("/"):
            target = target[part]
        return resolve(target, depth + 1)
    return node


def properties(node, out, depth=0):
    node = resolve(node)
    if depth > 30 or not isinstance(node, dict):
        return
    for part in node.get("allOf", []) or []:
        properties(part, out, depth + 1)
    for name, sub in (node.get("properties", {}) or {}).items():
        sub = resolve(sub)
        items = resolve(sub.get("items", {})) if isinstance(sub, dict) else {}
        out[name] = {
            "type": sub.get("type"),
            "items_type": items.get("type") if isinstance(items, dict) else None,
            "items_enum": items.get("enum") if isinstance(items, dict) else None,
            "description": sub.get("description") or "",
        }


op = ((spec.get("paths", {}) or {}).get(path) or {}).get(method)
responses = (op or {}).get("responses", {}) or {}
answer = responses.get(status) or responses.get(int(status))
if not op or not answer:
    print(json.dumps({"found": False, "description": "", "properties": {}}))
    raise SystemExit(0)
answer = resolve(answer)
props = {}
for media in (answer.get("content") or {}).values():
    properties(media.get("schema", {}), props)
print(json.dumps({
    "found": True,
    "description": f"{op.get('summary') or ''}\n{op.get('description') or ''}\n{answer.get('description') or ''}",
    "properties": props,
}))
