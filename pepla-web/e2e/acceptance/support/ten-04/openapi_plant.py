"""Makes one small change to a copy of api/openapi.yaml, for the planted-fault tests.

Usage: openapi_plant.py <file> <action> <method> <path> [value-json]
  delete-op    remove the operation
  drop-key     remove the operation's key named by value-json (a string)
  set-key      set the operation's key (value-json = [key, value])
  add-op       add a minimal operation (value-json = an object with security, x-tenant, x-roles)
The file is read with yaml and written back (comments are not kept: it is a planted copy).
"""
import json
import sys

import yaml

file, action, method, path = sys.argv[1:5]
value = json.loads(sys.argv[5]) if len(sys.argv) > 5 else None
spec = yaml.safe_load(open(file, encoding="utf-8"))
paths = spec.setdefault("paths", {})
method = method.lower()
if action == "delete-op":
    del paths[path][method]
    if not [k for k in paths[path] if k in ("get", "post", "put", "patch", "delete")]:
        del paths[path]
elif action == "drop-key":
    del paths[path][method][value]
elif action == "set-key":
    paths[path][method][value[0]] = value[1]
elif action == "add-op":
    paths.setdefault(path, {})[method] = {"summary": "Planted", "responses": {"200": {"description": "ok"}}, **(value or {})}
else:
    sys.exit(f"unknown action {action}")
yaml.safe_dump(spec, open(file, "w", encoding="utf-8"), sort_keys=False, width=200, allow_unicode=True)
