#!/usr/bin/env python3
"""
Read only. Print which candidates the manager test login is hiring manager for in pepla-dev: candidate id, role id, seed tag, created date.
No names, no emails. REC-01 AC-9 expects exactly one; when it finds two this shows which row is the second one.
Run by app-e2e-dev.yml right after the main acceptance run. Refuses to run outside pepla-dev. Writes nothing.
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
        sys.exit("::error::show-manager-candidates only runs in pepla-dev")
    cognito = boto3.client("cognito-idp", region_name=seed.REGION)
    ddb = boto3.client("dynamodb", region_name=seed.REGION)
    manager_sub = seed.user_sub(cognito, seed.pool_id(cognito, seed.NALEKO_POOL), "manager")
    tenant_id = seed.founding_tenant_id()
    kwargs = {"TableName": seed.STATE_TABLE, "IndexName": "GSI1",
              "KeyConditionExpression": "GSI1PK = :pk AND begins_with(GSI1SK, :p)",
              "FilterExpression": "hiringManagerId = :m AND tenant_id = :t",
              "ExpressionAttributeValues": {":pk": {"S": f"TENANT#{tenant_id}"}, ":p": {"S": "SAGA#"}, ":m": {"S": manager_sub}, ":t": {"S": tenant_id}},
              "ProjectionExpression": "candidateId, role_id, seed, createdAt, currentStage"}
    found = []
    while True:
        page = ddb.query(**kwargs)
        found.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f"show-manager-candidates: manager is hiring manager for {len(found)} candidate(s)")
    for item in found:
        print("  " + ", ".join(f"{k}={item.get(k, {}).get('S', '-')}" for k in ("candidateId", "role_id", "seed", "createdAt", "currentStage")))


if __name__ == "__main__":
    main()
