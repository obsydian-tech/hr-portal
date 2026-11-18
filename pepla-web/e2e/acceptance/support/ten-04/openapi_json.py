"""Prints api/openapi.yaml as JSON, with every local $ref resolved (depth-limited) so a test can read an operation whole.

Usage: openapi_json.py <openapi.yaml> [raw]   (raw keeps $ref as written)
Output: { "paths": { "<path>": { "servers": [...]?, "<method>": <operation, resolved> } }, "servers": [...], "text_refs": n }
"""
import json
import sys

import yaml

RAW = len(sys.argv) > 2 and sys.argv[2] == "raw"
spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))


def resolve(node, depth=0):
    if depth > 12:
        return node
    if isinstance(node, dict):
        if "$ref" in node and isinstance(node["$ref"], str) and node["$ref"].startswith("#/"):
            target = spec
            for part in node["$ref"][2:].split("/"):
                target = target[part]
            return resolve(target, depth + 1)
        return {k: resolve(v, depth + 1) for k, v in node.items()}
    if isinstance(node, list):
        return [resolve(v, depth + 1) for v in node]
    return node


out = {"servers": spec.get("servers", []), "schemes": list((spec.get("components") or {}).get("securitySchemes", {}).keys()), "paths": {}}
for path, item in (spec.get("paths") or {}).items():
    entry = {}
    for key, value in item.items():
        entry[key] = (value if RAW else resolve(value)) if key in ("get", "post", "put", "patch", "delete") else value
    out["paths"][path] = entry
print(json.dumps(out))
