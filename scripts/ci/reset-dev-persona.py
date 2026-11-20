#!/usr/bin/env python3
"""
Put the employee test login back to a clean start in pepla-dev: its row at stage INVITED, no documents, no accepted
privacy notice. Same reset seed-dev.py does at the start of a run (seed-dev.py reset_persona).

Run by app-e2e-dev.yml between the main acceptance run and ONB-10 AC-8, which needs a required document still to
give. Refuses to run outside pepla-dev. Counts only in the output.
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
        sys.exit("::error::reset-dev-persona only runs in pepla-dev")
    cognito = boto3.client("cognito-idp", region_name=seed.REGION)
    ddb = boto3.client("dynamodb", region_name=seed.REGION)
    employee_sub = seed.user_sub(cognito, seed.pool_id(cognito, seed.NALEKO_POOL), "employee")
    docs, consents = seed.reset_persona(ddb, seed.founding_tenant_id(), employee_sub)
    print(f"reset-dev-persona: documents removed {docs}; consents removed {consents}")


if __name__ == "__main__":
    main()
