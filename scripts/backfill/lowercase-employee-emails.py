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
    ap.add_argument("--account", help="the 12-digit AWS account id; --apply refuses unless it matches the account the credentials are in")
    ap.add_argument("--legacy-tenant", help="the company id of the founding client: rows with no company field belong to it (without this they are skipped and reported)")
    a = ap.parse_args()
    session = boto3.Session(profile_name=a.profile, region_name=a.region) if (a.profile or a.region) else None
    make = session.client if session else boto3.client
    ddb = make("dynamodb")
    # The table is called employees in dev and prod, so say which account this is before anything is read, and refuse to write unless
    # the person named it (security review M-2). An account id is not personal data.
    account = make("sts").get_caller_identity()["Account"]
    print(f"AWS account: {account}  table: {a.table}")
    if a.apply and a.account != account:
        print(f"refused: --apply needs --account {account} (the account these credentials are in); nothing was read or written")
        return 2
    rows = []
    for page in ddb.get_paginator("scan").paginate(TableName=a.table, ProjectionExpression="employee_id, email, tenant_id"):
        for it in page.get("Items", []):
            rows.append((it["employee_id"]["S"], it.get("email", {}).get("S"), it.get("tenant_id", {}).get("S")))
    # Rows with no company field belong to the founding client in the app (tenantFilter, ownsRow): with --legacy-tenant they count as that
    # company's, so a lower-case form held by either kind of row is seen (security review M-1). They are never given a company.
    def group(tenant):
        return a.legacy_tenant if (tenant is None and a.legacy_tenant) else tenant

    have = collections.defaultdict(set)
    for _eid, email, tenant in rows:
        if email is not None:
            have[group(tenant)].add(email)
    counts = collections.defaultdict(lambda: collections.Counter())
    skipped, left = [], []
    for eid, email, tenant in rows:
        if email is None:
            continue
        lower = email.strip().lower()
        if email == lower:
            continue
        company = tenant or "(no company)"
        if tenant is None and not a.legacy_tenant:
            # Not safe to judge without the founding client's id: report it for the person running the script.
            skipped.append(eid)
            counts[company]["skipped"] += 1
            continue
        if lower == "":
            # An address of spaces only lowers to "": DynamoDB refuses an empty index key, so report it for HR instead of stopping the run.
            skipped.append(eid)
            counts[company]["skipped"] += 1
            continue
        if lower in have[group(tenant)]:
            skipped.append(eid)
            counts[company]["skipped"] += 1
            continue
        if not a.apply:
            counts[company]["would_change"] += 1
            have[group(tenant)].add(lower)  # so the dry run sees the same skips as --apply
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
            have[group(tenant)].add(lower)
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            left.append(eid)
            counts[company]["left_alone"] += 1
    print("mode:", "apply" if a.apply else "dry run")
    for company in sorted(counts):
        print(company, dict(sorted(counts[company].items())))
    if skipped:
        print("skipped (another row of the same company has the lower-case form, or the address is empty, or the row has no company and --legacy-tenant was not given):", " ".join(skipped))
    if left:
        print("left alone (changed since it was read):", " ".join(left))
    return 0


if __name__ == "__main__":
    sys.exit(main())
