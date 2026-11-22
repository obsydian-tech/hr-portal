#!/usr/bin/env python3
"""
Switch Ask Batsi on for the two companies the TEN-04 company walk uses on pepla-dev: the founding company (its
"company A") and the walk company (its "company B").

Why: since CHAT-02 a company's Ask Batsi switch is off until an admin turns it on, and seed-dev.py puts the dev
companies back to their modules at the start of every run. With the switch off, every /v1/chats route answers 403 to both
companies, so the walk can neither read a chat list (it expects 200) nor look for a 404 across companies. With the
switch on, the walk really tests that company B cannot reach company A's chats.

Run by app-e2e-dev.yml right before the walk, after the main acceptance run (so MOD-01's checks on the seeded modules
are not disturbed). It only ADDS the key ask_batsi to the modules set of a company row that already exists, and
refuses to run outside pepla-dev. seed-dev.py is not changed: MOD-01 AC-10 locks what it seeds. Output: counts only.
"""
import importlib.util
import pathlib
import sys

import boto3
from botocore.exceptions import ClientError

spec = importlib.util.spec_from_file_location("seed_dev", pathlib.Path(__file__).with_name("seed-dev.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


def main() -> None:
    account = boto3.client("sts", region_name=seed.REGION).get_caller_identity()["Account"]
    if account != seed.DEV_ACCOUNT:
        sys.exit("::error::dev-ask-batsi-on only runs in pepla-dev")
    ddb = boto3.client("dynamodb", region_name=seed.REGION)
    changed = 0
    for tid in (seed.founding_tenant_id(), seed.WALK_TENANT_ID):
        try:
            ddb.update_item(
                TableName=seed.TENANTS_TABLE,
                Key={"pk": {"S": f"TENANT#{tid}"}, "sk": {"S": "PROFILE"}},
                UpdateExpression="ADD #m :k",
                ConditionExpression="attribute_exists(pk)",
                ExpressionAttributeNames={"#m": "modules"},
                ExpressionAttributeValues={":k": {"SS": ["ask_batsi"]}},
            )
            changed += 1
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    print(f"dev-ask-batsi-on: companies switched on {changed} of 2")


if __name__ == "__main__":
    main()
