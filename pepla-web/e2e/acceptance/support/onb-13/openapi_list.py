"""Prints what api/openapi.yaml says GET /v1/verifications takes and answers.

Output (JSON): parameters (name and in of each), responses (status codes), and objects: every
object schema reachable from the 200 answer ($ref, allOf, oneOf, anyOf and array items followed),
each with its property names and, when it has an array property, the property names of that
array's items.
"""
import json
import sys

import yaml

spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))


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


def props(node, depth=0):
    """Property name -> schema of an object, allOf merged."""
    node = resolve(node)
    out = dict(node.get("properties", {}) or {})
    for part in node.get("allOf", []) or []:
        if depth < 30:
            out.update(props(part, depth + 1))
    return out


def walk(node, seen, objects, depth=0):
    node = resolve(node)
    if depth > 30 or not isinstance(node, dict) or id(node) in seen:
        return
    seen.add(id(node))
    for key in ("oneOf", "anyOf"):
        for alt in node.get(key, []) or []:
            walk(alt, seen, objects, depth + 1)
    if node.get("type") == "array" or "items" in node:
        walk(node.get("items", {}), seen, objects, depth + 1)
    p = props(node)
    if p:
        items = None
        for v in p.values():
            v = resolve(v)
            if v.get("type") == "array" or "items" in v:
                ip = props(v.get("items", {}))
                if ip:
                    items = sorted(set((items or []) + list(ip.keys())))
        objects.append({"properties": sorted(p.keys()), "items": items})
        for v in p.values():
            walk(v, seen, objects, depth + 1)


op = (spec.get("paths", {}).get("/v1/verifications") or {}).get("get") or {}
params = [resolve(p) for p in op.get("parameters", []) or []]
responses = op.get("responses", {}) or {}
ok = resolve(responses.get("200") or responses.get(200) or {})
objects = []
for media in (ok.get("content") or {}).values():
    walk(media.get("schema", {}), set(), objects)

print(json.dumps({
    "parameters": [{"name": p.get("name"), "in": p.get("in")} for p in params],
    "responses": sorted(str(k) for k in responses.keys()),
    "objects": objects,
}))
