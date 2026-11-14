#!/usr/bin/env python3
"""
Remove the records an E2E run created in pepla-dev.

Journeys mark everything they create with an email that starts with
"e2e.run-". This deletes those employees (and their documents), TalentFlow
candidates (every row of theirs in talent-flow-state) and any matching
Cognito users. Seeded demo people and test logins stay.
Refuses to run outside pepla-dev. Prints counts only.
"""
import sys

import boto3

DEV_ACCOUNT = "424556617428"
REGION = "af-south-1"
MARKER = "e2e.run-"
TF_STATE = "talent-flow-state"
EMPLOYEE_LOGIN_ID = "E2E-EMP-0001"  # the employee test login (scripts/ci/seed-dev.py)


def main() -> None:
    if boto3.client("sts", region_name=REGION).get_caller_identity()["Account"] != DEV_ACCOUNT:
        sys.exit("::error::cleanup-dev-e2e only runs in pepla-dev")

    ddb = boto3.client("dynamodb", region_name=REGION)
    cognito = boto3.client("cognito-idp", region_name=REGION)

    employees = docs = users = 0
    for page in ddb.get_paginator("scan").paginate(
            TableName="employees",
            FilterExpression="begins_with(email, :m)",
            ExpressionAttributeValues={":m": {"S": MARKER}},
            ProjectionExpression="employee_id"):
        for item in page["Items"]:
            for dpage in ddb.get_paginator("query").paginate(
                    TableName="documents",
                    KeyConditionExpression="employee_id = :e",
                    ExpressionAttributeValues={":e": item["employee_id"]},
                    ProjectionExpression="employee_id, document_id"):
                for d in dpage["Items"]:
                    ddb.delete_item(TableName="documents", Key=d)
                    docs += 1
            ddb.delete_item(TableName="employees", Key={"employee_id": item["employee_id"]})
            employees += 1

    for pool_page in cognito.get_paginator("list_user_pools").paginate(MaxResults=60):
        for pool in pool_page["UserPools"]:
            for upage in cognito.get_paginator("list_users").paginate(
                    UserPoolId=pool["Id"], Filter=f'email ^= "{MARKER}"'):
                for u in upage["Users"]:
                    cognito.admin_delete_user(UserPoolId=pool["Id"], Username=u["Username"])
                    users += 1

    candidates = remove_candidates(ddb)
    login_docs = remove_login_documents(ddb)
    print(f"cleanup-dev-e2e: employees {employees}; documents {docs}; "
          f"test login documents {login_docs}; candidates {candidates}; logins {users}")


def remove_login_documents(ddb) -> int:
    """ONB-07: the employee test login uploads a document; remove it (and its check) at the end of the run."""
    removed = 0
    for page in ddb.get_paginator("query").paginate(
            TableName="documents",
            KeyConditionExpression="employee_id = :e",
            ExpressionAttributeValues={":e": {"S": EMPLOYEE_LOGIN_ID}},
            ProjectionExpression="employee_id, document_id, verification_id"):
        for d in page["Items"]:
            vid = d.get("verification_id", {}).get("S")
            if vid:
                ddb.delete_item(TableName="document-verification", Key={"verificationId": {"S": vid}})
            ddb.delete_item(TableName="documents", Key={"employee_id": d["employee_id"], "document_id": d["document_id"]})
            removed += 1
    return removed


def remove_candidates(ddb) -> int:
    """Delete TalentFlow candidates whose email carries the run marker."""
    ids = []
    try:
        for page in ddb.get_paginator("scan").paginate(
                TableName=TF_STATE,
                FilterExpression="SK = :saga AND begins_with(email, :m)",
                ExpressionAttributeValues={":saga": {"S": "SAGA"}, ":m": {"S": MARKER}},
                ProjectionExpression="candidateId"):
            ids += [i["candidateId"]["S"] for i in page["Items"]]
        for cid in ids:
            # The candidate's own rows (SAGA, STAGE#..., events) ...
            for page in ddb.get_paginator("query").paginate(
                    TableName=TF_STATE, KeyConditionExpression="PK = :pk",
                    ExpressionAttributeValues={":pk": {"S": f"CANDIDATE#{cid}"}},
                    ProjectionExpression="PK, SK"):
                for key in page["Items"]:
                    ddb.delete_item(TableName=TF_STATE, Key=key)
            # ... and rows kept under other keys that name it (snapshots).
            for page in ddb.get_paginator("scan").paginate(
                    TableName=TF_STATE, FilterExpression="candidateId = :c",
                    ExpressionAttributeValues={":c": {"S": cid}},
                    ProjectionExpression="PK, SK"):
                for key in page["Items"]:
                    ddb.delete_item(TableName=TF_STATE, Key=key)
    except ddb.exceptions.ResourceNotFoundException:
        return 0
    return len(ids)


if __name__ == "__main__":
    main()
