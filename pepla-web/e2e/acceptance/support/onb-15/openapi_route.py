"""Prints what api/openapi.yaml says about one route: python3 openapi_route.py <spec> <path> <method>

Output (JSON): found (the path and method are there), responses (status codes), fields (for each
status code, every property name reachable from its schema: $ref, allOf, oneOf, anyOf, array items
and nested objects followed) and request (the request body's property names, the same way).
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
        ref = node["$ref"]
        if not ref.startswith("#/"):
            raise SystemExit(f"external $ref not supported: {ref}")
        target = spec
        for part in ref[2:].split("/"):
            target = target[part]
        return resolve(target, depth + 1)
    return node


def names(node, seen, out, depth=0):
    node = resolve(node)
    if depth > 40 or not isinstance(node, dict) or id(node) in seen:
        return
    seen.add(id(node))
    for key in ("allOf", "oneOf", "anyOf"):
        for part in node.get(key, []) or []:
            names(part, seen, out, depth + 1)
    if "items" in node:
        names(node.get("items", {}), seen, out, depth + 1)
    for name, sub in (node.get("properties", {}) or {}).items():
        out.add(name)
        names(sub, seen, out, depth + 1)
    extra = node.get("additionalProperties")
    if isinstance(extra, dict):
        names(extra, seen, out, depth + 1)


def schema_fields(container):
    out = set()
    container = resolve(container)
    for media in (container.get("content") or {}).values():
        names(media.get("schema", {}), set(), out)
    return sorted(out)


op = ((spec.get("paths", {}) or {}).get(path) or {}).get(method)
if not op:
    print(json.dumps({"found": False, "responses": [], "fields": {}, "request": []}))
    raise SystemExit(0)
responses = op.get("responses", {}) or {}
print(json.dumps({
    "found": True,
    "responses": sorted(str(k) for k in responses.keys()),
    "fields": {str(k): schema_fields(v) for k, v in responses.items()},
    "request": schema_fields(op.get("requestBody") or {}),
}))
