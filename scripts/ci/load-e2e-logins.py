#!/usr/bin/env python3
"""
Hand the pepla-dev test logins to the Playwright run, masked.

Reads pepla-dev/e2e/<role> from Secrets Manager (made by seed-dev.py) and
appends E2E_<PREFIX>_EMAIL / _PASSWORD to $GITHUB_ENV, after telling Actions
to mask every password. Refuses to run outside pepla-dev. Prints nothing else.
"""
import json
import os
import sys

import boto3

DEV_ACCOUNT = "424556617428"
REGION = "af-south-1"
LOGINS = {"hr": "E2E_HR", "employee": "E2E_EMP"}


def main() -> None:
    if boto3.client("sts", region_name=REGION).get_caller_identity()["Account"] != DEV_ACCOUNT:
        sys.exit("::error::load-e2e-logins only runs in pepla-dev")
    sm = boto3.client("secretsmanager", region_name=REGION)
    lines = []
    for role, prefix in LOGINS.items():
        cred = json.loads(sm.get_secret_value(SecretId=f"pepla-dev/e2e/{role}")["SecretString"])
        print(f"::add-mask::{cred['password']}")
        lines += [f"{prefix}_EMAIL={cred['username']}", f"{prefix}_PASSWORD={cred['password']}"]
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as env:
        env.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
