#!/usr/bin/env python3
"""
Read only. Print the offer rows of the REC-05 seeded candidate in pepla-dev: the OFFER_LIVE lock row, the old-shape
CANDIDATE#<id>/OFFER row, and every company offer row that names the candidate. Keys, state, version and dates only:
no names, no emails, no salary. REC-05 AC-11 gets 409 OFFER_EXISTS when any of them still counts as live; this shows which.
Run by app-e2e-dev.yml after the main acceptance run and after the company walk. Refuses to run outside pepla-dev. Writes nothing.
"""
import importlib.util
import json
import pathlib
import sys

import boto3

spec = importlib.util.spec_from_file_location("seed_dev", pathlib.Path(__file__).with_name("seed-dev.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

SHOW = ("offer_id", "state", "version", "live_offer_id", "moved_to", "created_at", "updated_at", "seed", "tenant_id", "candidate_id")


def describe(item: dict) -> str:
    keys = ", ".join(f"{k}={v}" for k, v in (("PK", item.get("PK", {}).get("S")), ("SK", item.get("SK", {}).get("S"))))
    rest = ", ".join(f"{k}={list(item[k].values())[0]}" for k in SHOW if k in item)
    return f"  {keys}; attributes: {sorted(item.keys())}; {rest}"


def main() -> None:
    account = boto3.client("sts", region_name=seed.REGION).get_caller_identity()["Account"]
    if account != seed.DEV_ACCOUNT:
        sys.exit("::error::show-offer-rows only runs in pepla-dev")
    ddb = boto3.client("dynamodb", region_name=seed.REGION)
    tid = seed.founding_tenant_id()
    ids = json.loads((pathlib.Path(__file__).resolve().parents[2] / "pepla-web" / "e2e" / "acceptance" / "support" / "rec-05" / "dev-ids.json").read_text())
    cid = ids["candidate"]
    print(f"show-offer-rows: candidate {cid}")
    for label, key in (("lock", {"PK": {"S": f"TENANT#{tid}#OFFER_LIVE#{cid}"}, "SK": {"S": "LOCK"}}),
                       ("old-shape row", {"PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": "OFFER"}})):
        item = ddb.get_item(TableName=seed.STATE_TABLE, Key=key, ConsistentRead=True).get("Item")
        print(f" {label}: " + ("none" if not item else "\n" + describe(item)))
    kwargs = {"TableName": seed.STATE_TABLE, "IndexName": "GSI2", "KeyConditionExpression": "GSI2PK = :pk",
              "ExpressionAttributeValues": {":pk": {"S": f"TENANT#{tid}#OFFER"}, ":c": {"S": cid}}, "FilterExpression": "candidate_id = :c"}
    rows = []
    while True:
        page = ddb.query(**kwargs)
        rows.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    print(f" company offer rows naming the candidate: {len(rows)}")
    for item in rows:
        print(describe(item))


if __name__ == "__main__":
    main()
