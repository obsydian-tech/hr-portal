#!/usr/bin/env python3
"""Prints, as JSON, the enum of every `check` property in an OpenAPI file (ONB-07 AC-9)."""
import json
import sys

import yaml


def walk(node, found):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "check" and isinstance(v, dict) and isinstance(v.get("enum"), list):
                found.append([str(x) for x in v["enum"]])
            walk(v, found)
    elif isinstance(node, list):
        for v in node:
            walk(v, found)


with open(sys.argv[1], encoding="utf-8") as f:
    spec = yaml.safe_load(f)
found = []
walk(spec, found)
print(json.dumps(found))
