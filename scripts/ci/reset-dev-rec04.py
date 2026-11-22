#!/usr/bin/env python3
"""
Put the hiring board's seeded roles and candidates back to their clean start in pepla-dev. Same write seed-dev.py
seed_rec04 does at the start of a run: Tendai Ncube back in Interview, the Not hired rows as seeded, a role a run closed open again.

Run by app-e2e-dev.yml before REC-UI-01 AC-13 at desktop and again before it at phone. The test records Tendai as Not hired,
and the seed only runs once per run, so without this the phone run finds no Tendai in Interview. Refuses to run outside pepla-dev.
Counts only in the output.
"""
import importlib.util
import pathlib
import sys

import boto3

spec = importlib.util.spec_from_file_location("seed_dev", pathlib.Path(__file__).with_name("seed-dev.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


def main() -> None:
    account = boto3.client("sts", region_name=seed.REGION).get_caller_identity()["Account"]
    if account != seed.DEV_ACCOUNT:
        sys.exit("::error::reset-dev-rec04 only runs in pepla-dev")
    cognito = boto3.client("cognito-idp", region_name=seed.REGION)
    ddb = boto3.client("dynamodb", region_name=seed.REGION)
    manager_sub = seed.user_sub(cognito, seed.pool_id(cognito, seed.NALEKO_POOL), "manager")
    written = seed.seed_rec04(ddb, seed.founding_tenant_id(), manager_sub)
    print(f"reset-dev-rec04: rows written {written}")


if __name__ == "__main__":
    main()
