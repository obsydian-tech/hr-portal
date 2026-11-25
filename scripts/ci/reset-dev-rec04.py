#!/usr/bin/env python3
"""
Put the hiring board's seeded roles and candidates back to their clean start in pepla-dev. Same write seed-dev.py
seed_rec04 does at the start of a run: Tendai Ncube back in Interview, the Not hired rows as seeded, a role a run closed open again.

It also deletes the candidates other dev tests add to the three seeded roles and leave open (REC-12 AC-9, REC-UI-02 AC-17), with every
row they hold, so the open count the company walk pins for REC-04 AC-10 starts clean. Only this company's candidates on the seeded
roles, and never one of the seeded ids.
Also deletes candidates with no seed tag that the manager test login is hiring manager for (a candidate added on a role a test opened): REC-01 AC-9 expects exactly one.

Run by app-e2e-dev.yml before the company walk (REC-04 AC-10), then before REC-UI-01 AC-13 at desktop and again before it at phone. The test records Tendai as Not hired,
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


def clear_extra_candidates(ddb, tenant_id: str, manager_sub: str) -> int:
    """Delete every candidate on a seeded REC-04 role, and every untagged one the manager login is hiring manager for,
    whose id is not a seeded one, with all the rows under it."""
    seeded_ids = {cid for cid, *_ in seed.REC04_CANDIDATES}
    role_ids = [rid for rid, *_ in seed.REC04_ROLES]
    names = {f":r{i}": {"S": rid} for i, rid in enumerate(role_ids)}
    kwargs = {"TableName": seed.STATE_TABLE, "IndexName": "GSI1",
              "KeyConditionExpression": "GSI1PK = :pk AND begins_with(GSI1SK, :p)",
              "FilterExpression": f"tenant_id = :t AND (role_id IN ({', '.join(names)}) OR (hiringManagerId = :m AND attribute_not_exists(seed)))",
              "ExpressionAttributeValues": {":pk": {"S": f"TENANT#{tenant_id}"}, ":p": {"S": "SAGA#"}, ":t": {"S": tenant_id}, ":m": {"S": manager_sub}, **names},
              "ProjectionExpression": "PK, candidateId"}
    removed = 0
    while True:
        page = ddb.query(**kwargs)
        for item in page.get("Items", []):
            if item.get("candidateId", {}).get("S") in seeded_ids:
                continue
            rows = ddb.query(TableName=seed.STATE_TABLE, KeyConditionExpression="PK = :pk",
                             ExpressionAttributeValues={":pk": item["PK"]}, ProjectionExpression="PK, SK")
            for row in rows.get("Items", []):
                ddb.delete_item(TableName=seed.STATE_TABLE, Key={"PK": row["PK"], "SK": row["SK"]})
            removed += 1
        if "LastEvaluatedKey" not in page:
            return removed
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def main() -> None:
    account = boto3.client("sts", region_name=seed.REGION).get_caller_identity()["Account"]
    if account != seed.DEV_ACCOUNT:
        sys.exit("::error::reset-dev-rec04 only runs in pepla-dev")
    cognito = boto3.client("cognito-idp", region_name=seed.REGION)
    ddb = boto3.client("dynamodb", region_name=seed.REGION)
    manager_sub = seed.user_sub(cognito, seed.pool_id(cognito, seed.NALEKO_POOL), "manager")
    tenant_id = seed.founding_tenant_id()
    removed = clear_extra_candidates(ddb, tenant_id, manager_sub)
    written = seed.seed_rec04(ddb, tenant_id, manager_sub)
    print(f"reset-dev-rec04: extra candidates removed {removed}; rows written {written}")


if __name__ == "__main__":
    main()
