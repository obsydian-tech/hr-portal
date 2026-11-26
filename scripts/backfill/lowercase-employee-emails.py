#!/usr/bin/env python3
"""REC-06.1 rule 9: make old employee emails lower case. Dry run by default; --apply writes.

Reads employees (employee_id, email, tenant_id only). A row needs a change when its email is not already trimmed and lower case.
A row is skipped when another row of the same company holds the lower-case form. Each change is conditional on the email and the
company read, so a row changed meanwhile is left alone. Output: counts per company id and employee ids only.
"""
import argparse
import collections
import sys

import boto3
from botocore.exceptions import ClientError


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--table", default="employees")
    ap.add_argument("--profile")
    ap.add_argument("--region")
    a = ap.parse_args()
    session = boto3.Session(profile_name=a.profile, region_name=a.region) if (a.profile or a.region) else None
    ddb = session.client("dynamodb") if session else boto3.client("dynamodb")
    rows = []
    for page in ddb.get_paginator("scan").paginate(TableName=a.table, ProjectionExpression="employee_id, email, tenant_id"):
        for it in page.get("Items", []):
            rows.append((it["employee_id"]["S"], it.get("email", {}).get("S"), it.get("tenant_id", {}).get("S")))
    have = collections.defaultdict(set)
    for _eid, email, tenant in rows:
        if email is not None:
            have[tenant].add(email)
    counts = collections.defaultdict(lambda: collections.Counter())
    skipped, left = [], []
    for eid, email, tenant in rows:
        if email is None:
            continue
        lower = email.strip().lower()
        if email == lower:
            continue
        company = tenant or "(no company)"
        if lower in have[tenant]:
            skipped.append(eid)
            counts[company]["skipped"] += 1
            continue
        if not a.apply:
            counts[company]["would_change"] += 1
            continue
        values = {":lower": {"S": lower}, ":old": {"S": email}}
        if tenant is None:
            cond = "email = :old AND attribute_not_exists(tenant_id)"
        else:
            cond = "email = :old AND tenant_id = :t"
            values[":t"] = {"S": tenant}
        try:
            ddb.update_item(TableName=a.table, Key={"employee_id": {"S": eid}}, UpdateExpression="SET email = :lower",
                            ConditionExpression=cond, ExpressionAttributeValues=values)
            counts[company]["changed"] += 1
            have[tenant].add(lower)
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            left.append(eid)
            counts[company]["left_alone"] += 1
    print("mode:", "apply" if a.apply else "dry run")
    for company in sorted(counts):
        print(company, dict(sorted(counts[company].items())))
    if skipped:
        print("skipped (another row of the same company has the lower-case form):", " ".join(skipped))
    if left:
        print("left alone (changed since it was read):", " ".join(left))
    return 0


if __name__ == "__main__":
    sys.exit(main())
