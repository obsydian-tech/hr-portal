"""Prints what api/openapi.yaml says GET /v1/employees/{id}/verifications answers.

Output (JSON): responses (status codes), employee (property names of the 200
answer's employee), document (property name -> enum / nullable / type of each
document in the 200 answer's documents list). $ref and allOf are resolved.
"""
import json
import sys

import yaml

spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))


def resolve(node, depth=0):
    if depth > 20 or not isinstance(node, dict):
        return node or {}
    if "$ref" in node:
        ref = node["$ref"]
        if not ref.startswith("#/"):
            raise SystemExit(f"external $ref not supported: {ref}")
        target = spec
        for part in ref[2:].split("/"):
            target = target[part]
        return resolve(target, depth + 1)
    if "allOf" in node:
        merged = {"type": "object", "properties": {}}
        for part in node["allOf"]:
            p = resolve(part, depth + 1)
            merged["properties"].update(p.get("properties", {}))
        return merged
    return node


def props(node):
    return {k: resolve(v) for k, v in resolve(node).get("properties", {}).items()}


op = (spec.get("paths", {}).get("/v1/employees/{id}/verifications") or {}).get("get") or {}
responses = op.get("responses", {})
ok = resolve(responses.get("200") or responses.get(200) or {})
schema = resolve(ok.get("content", {}).get("application/json", {}).get("schema", {}))
top = props(schema)
employee = sorted(props(top.get("employee", {})).keys())
doc_items = resolve(resolve(top.get("documents", {})).get("items", {}))
document = {}
for name, p in props(doc_items).items():
    t = p.get("type")
    enum = p.get("enum")
    nullable = bool(p.get("nullable")) or (isinstance(t, list) and "null" in t) or (enum is not None and None in enum)
    if not enum and "oneOf" in p:
        enum = [v for alt in p["oneOf"] for v in (resolve(alt).get("enum") or [])]
        nullable = nullable or any(resolve(alt).get("type") == "null" or resolve(alt).get("nullable") for alt in p["oneOf"])
    document[name] = {"enum": enum, "nullable": nullable, "type": t}

print(json.dumps({"responses": sorted(str(k) for k in responses.keys()), "employee": employee, "document": document}))
