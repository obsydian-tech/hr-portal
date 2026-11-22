"""Prints what api/openapi.yaml says about one route: python3 -I openapi_route.py <spec> <path> <method>

Output (JSON): found; operation (x-tenant, x-roles, security, servers); responses (status codes); fields (for each status
code, every property name reachable from its schema, local $ref, allOf, oneOf, anyOf, array items and nested objects
followed); keys (the same, but each name with the path of properties above it, "verification.extracted_data.id_number");
request (the request body's property names, the same way).
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


def names(node, prefix, seen, out, depth=0):
    node = resolve(node)
    if depth > 40 or not isinstance(node, dict) or (id(node), prefix) in seen:
        return
    seen.add((id(node), prefix))
    for key in ("allOf", "oneOf", "anyOf"):
        for part in node.get(key, []) or []:
            names(part, prefix, seen, out, depth + 1)
    if "items" in node:
        names(node.get("items", {}), prefix, seen, out, depth + 1)
    for name, sub in (node.get("properties", {}) or {}).items():
        full = f"{prefix}.{name}" if prefix else name
        out.add(full)
        names(sub, full, seen, out, depth + 1)
    extra = node.get("additionalProperties")
    if isinstance(extra, dict):
        names(extra, prefix, seen, out, depth + 1)


def schema_keys(container):
    out = set()
    container = resolve(container)
    for media in (container.get("content") or {}).values():
        names(media.get("schema", {}), "", set(), out)
    return sorted(out)


op = ((spec.get("paths", {}) or {}).get(path) or {}).get(method)
if not op:
    print(json.dumps({"found": False, "operation": {}, "responses": [], "fields": {}, "keys": {}, "request": []}))
    raise SystemExit(0)
responses = op.get("responses", {}) or {}
servers = op.get("servers") or (spec.get("paths", {}).get(path) or {}).get("servers") or []
keys = {str(k): schema_keys(v) for k, v in responses.items()}
print(json.dumps({
    "found": True,
    "operation": {"x-tenant": op.get("x-tenant"), "x-roles": op.get("x-roles"), "security": op.get("security"), "servers": servers},
    "responses": sorted(str(k) for k in responses.keys()),
    "fields": {k: sorted({x.split(".")[-1] for x in v}) for k, v in keys.items()},
    "keys": keys,
    "request": sorted({x.split(".")[-1] for x in schema_keys(op.get("requestBody") or {})}),
}))
