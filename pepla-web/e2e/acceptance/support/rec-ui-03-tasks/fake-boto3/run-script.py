#!/usr/bin/env python3
"""
REC-UI-03 feedback-due (NH-293) AC-12: runs the real backfill script (scripts/tenancy/backfill-feedback-due.py) once against an
in-memory DynamoDB, with no AWS. Copied from support/rec-06.2/fake-boto3/run-script.py.

  python3 run-script.py <script> [script args...]

The world is the JSON file named by RUI03T_WORLD: {"tables": {name: [item, ...]}, "pageSize": n, "allowWrites": true}. Items are in
DynamoDB's AttributeValue form. This folder's boto3 and botocore are put in front of everything else, so `import boto3` lands here. The
script's own output goes to stdout and stderr unchanged. When the script ends (return, sys.exit or an error), {"tables", "calls"} is
written to the file named by RUI03T_OUT.
"""
import json
import os
import runpy
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for name in list(sys.modules):
    if name == "boto3" or name.startswith("boto3.") or name == "botocore" or name.startswith("botocore."):
        del sys.modules[name]

import boto3  # noqa: E402  (this folder's)
from boto3 import _state  # noqa: E402

script, args = sys.argv[1], sys.argv[2:]
code = 0
try:
    if not os.path.exists(script):
        print(f"run-script: no script at {script}", file=sys.stderr)
        code = 2
    else:
        call = os.environ.get("RUI03T_CALL")
        if call:
            # AC-10: load the script without running its main(), then call one of its functions with a DynamoDB client and the args.
            sys.argv = [script]
            fns = runpy.run_path(script, run_name="rui03t_loaded")
            fns[call](boto3.client("dynamodb"), *args)
        else:
            sys.argv = [script, *args]
            runpy.run_path(script, run_name="__main__")
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
except BaseException:  # noqa: BLE001  (the run must always write its result)
    traceback.print_exc()
    code = 1
finally:
    with open(os.environ["RUI03T_OUT"], "w") as f:
        json.dump({"tables": _state.TABLES, "calls": _state.CALLS}, f, default=str)
sys.exit(code)
