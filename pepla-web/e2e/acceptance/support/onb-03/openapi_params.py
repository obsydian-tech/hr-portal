"""Prints what api/openapi.yaml says about the query parameters of one route:
python3 openapi_params.py <spec> <path> <method>

Output (JSON): found (the path and method are there) and parameters: [{ name, in, required, type }], with $ref
followed (path-level parameters included).
"""
import json
import sys

import yaml

spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
path, method = sys.argv[2], sys.argv[3].lower()


def resolve(node, depth=0):
    if depth > 30 or not isinstance(node, dict):
        return node or {}
    if "$ref" in node:
        target = spec
        for part in node["$ref"][2:].split("/"):
            target = target[part]
        return resolve(target, depth + 1)
    return node


item = (spec.get("paths") or {}).get(path) or {}
op = item.get(method)
if not op:
    print(json.dumps({"found": False, "parameters": []}))
    raise SystemExit(0)
params = []
for p in (item.get("parameters") or []) + (op.get("parameters") or []):
    p = resolve(p)
    schema = resolve(p.get("schema") or {})
    params.append({"name": p.get("name"), "in": p.get("in"), "required": bool(p.get("required")), "type": schema.get("type")})
print(json.dumps({"found": True, "parameters": params}))
