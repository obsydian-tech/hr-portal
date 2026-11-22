"""REC-14: prints api/openapi.yaml as JSON, exactly as written ($ref kept), so a test can hand its components to a schema validator.

Usage: openapi_doc.py <openapi.yaml>
"""
import json
import sys

import yaml

print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))
