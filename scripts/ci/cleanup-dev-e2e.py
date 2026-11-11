#!/usr/bin/env python3
"""
Remove the records an E2E run created in pepla-dev.

Journeys mark everything they create with an email that starts with
"e2e.run-". This deletes those employees (and their documents) and any
matching Cognito users. Seeded demo people and test logins stay.
Refuses to run outside pepla-dev. Prints counts only.
"""
import sys

import boto3

DEV_ACCOUNT = "424556617428"
REGION = "af-south-1"
MARKER = "e2e.run-"


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

    print(f"cleanup-dev-e2e: employees {employees}; documents {docs}; logins {users}")


if __name__ == "__main__":
    main()
