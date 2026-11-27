#!/usr/bin/env python3
"""
REC-UI-03 server (NH-293) rule 6: fill the feedback-due rows for interviews booked before the rows existed.

  python3 scripts/tenancy/backfill-feedback-due.py --table <state table> [--profile <name>] [--region <name>] [--apply]

Dry run by default: it reads and prints counts. With --apply it writes, with put_item and attribute_not_exists(PK) only, so it never
overwrites a row (a DONE row is never reopened). For each SCHEDULED interview that carries a company, each panel person who has not
scored it (any VOTE#<person># row of that candidate whose interviewId is this interview, or a VOTED#<interview>#<person> row) gets one
OPEN row. Guests have no row. Safe to run again. Prints counts only, never an id, a name or an email.

Run by a person (prod: process/PROD-CATCH-UP-LIST.md) or by the dev seed (scripts/ci/seed-dev.py), never by a Lambda.
"""
import argparse
import sys
from datetime import datetime, timezone


def _s(item, key):
    v = item.get(key)
    return v.get("S") if isinstance(v, dict) else None


def _list(item, key):
    v = item.get(key)
    if not isinstance(v, dict):
        return []
    if "L" in v:
        return [x.get("S") for x in v["L"] if isinstance(x, dict) and x.get("S")]
    if "SS" in v:
        return list(v["SS"])
    return []


def _pages(ddb, op, **params):
    start = None
    while True:
        page = getattr(ddb, op)(**params, **({"ExclusiveStartKey": start} if start else {}))
        yield page
        start = page.get("LastEvaluatedKey")
        if not start:
            return


def _voted(ddb, table, candidate, interview, person):
    for page in _pages(ddb, "query", TableName=table, KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                       ExpressionAttributeValues={":pk": {"S": f"CANDIDATE#{candidate}"}, ":sk": {"S": f"VOTE#{person}#"}}):
        if any(_s(v, "interviewId") == interview for v in page.get("Items", [])):
            return True
    got = ddb.get_item(TableName=table, Key={"PK": {"S": f"CANDIDATE#{candidate}"}, "SK": {"S": f"VOTED#{interview}#{person}"}})
    return bool(got.get("Item"))


def run(ddb, table, apply):
    counts = {"interviews": 0, "scheduled": 0, "written": 0, "there": 0, "would_write": 0}
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    for page in _pages(ddb, "scan", TableName=table, FilterExpression="begins_with(PK, :c) AND begins_with(SK, :i)",
                       ExpressionAttributeValues={":c": {"S": "CANDIDATE#"}, ":i": {"S": "INTERVIEW#"}}):
        for iv in page.get("Items", []):
            counts["interviews"] += 1
            company = _s(iv, "tenant_id")
            if _s(iv, "status") != "SCHEDULED" or not company:
                continue
            counts["scheduled"] += 1
            candidate = _s(iv, "PK")[len("CANDIDATE#"):]
            interview = _s(iv, "SK")[len("INTERVIEW#"):]
            for person in _list(iv, "panelMemberIds"):
                if _voted(ddb, table, candidate, interview, person):
                    continue
                item = {
                    "PK": {"S": f"FEEDBACK_DUE#{company}#{person}"}, "SK": {"S": f"CANDIDATE#{candidate}#INTERVIEW#{interview}"},
                    "tenant_id": {"S": company}, "person_id": {"S": person}, "interview_id": {"S": interview}, "candidate_id": {"S": candidate},
                    "state": {"S": "OPEN"}, "updated_at": {"S": now},
                }
                if not apply:
                    there = ddb.get_item(TableName=table, Key={"PK": item["PK"], "SK": item["SK"]}).get("Item")
                    counts["there" if there else "would_write"] += 1
                    continue
                try:
                    ddb.put_item(TableName=table, Item=item, ConditionExpression="attribute_not_exists(PK)")
                    counts["written"] += 1
                except ddb.exceptions.ConditionalCheckFailedException:
                    counts["there"] += 1
    return counts


def main(argv=None):
    p = argparse.ArgumentParser(description="Fill feedback-due rows for interviews booked before they existed (dry run unless --apply).")
    p.add_argument("--table", required=True)
    p.add_argument("--profile")
    p.add_argument("--region")
    p.add_argument("--apply", action="store_true")
    a = p.parse_args(argv)
    import boto3
    session = boto3.Session(**({"profile_name": a.profile} if a.profile else {}), **({"region_name": a.region} if a.region else {}))
    ddb = session.client("dynamodb")
    c = run(ddb, a.table, a.apply)
    if a.apply:
        print(f"backfill-feedback-due: interviews read {c['interviews']}, scheduled {c['scheduled']}, rows written {c['written']}, rows already there {c['there']}")
    else:
        print(f"backfill-feedback-due (dry run): interviews read {c['interviews']}, scheduled {c['scheduled']}, rows it would write {c['would_write']}, rows already there {c['there']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
