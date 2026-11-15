#!/usr/bin/env python3
"""
BE-15 AC-6: a new employee added on pepla-dev gets a sign-in in the dev pool.

Runs in CI after the pepla-dev tests (app-e2e-dev.yml), with the dev CI role
and the seeded HR test login (E2E_HR_EMAIL / E2E_HR_PASSWORD in the
environment). It:
  1. signs the HR test login in to the Naleko pool through the pepla-web-dev
     app client and calls the real POST /v1/employees of pepla-dev, with an
     "e2e.run-..." email on the Postmark blackhole domain;
  2. reads that user from the pool named naleko-dev-user-pool (found by name,
     as seed-dev.py does): it must exist, be in group "employee" and have
     email_verified true.
The next step, cleanup-dev-e2e.py, deletes the employee and the Cognito user
(everything starting "e2e.run-"). Refuses to run outside pepla-dev, never
touches prod, calls no AI. Prints names and pass/fail only: the repo is public.
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

import boto3

DEV_ACCOUNT = "424556617428"
REGION = "af-south-1"
NALEKO_POOL = "naleko-dev-user-pool"
WEB_CLIENT = "pepla-web-dev"
EMPLOYEES_API = "employees"
MARKER = "e2e.run-"
MAIL_DOMAIN = "blackhole.postmarkapp.com"


def fail(message: str) -> None:
    print(f"::error::AC-6 {message}")
    sys.exit(1)


def main() -> None:
    if boto3.client("sts", region_name=REGION).get_caller_identity()["Account"] != DEV_ACCOUNT:
        sys.exit("::error::check-dev-signin only runs in pepla-dev")
    try:
        hr_email, hr_password = os.environ["E2E_HR_EMAIL"], os.environ["E2E_HR_PASSWORD"]
    except KeyError as e:
        fail(f"needs {e.args[0]} in the environment (load-e2e-logins.py sets it)")

    cognito = boto3.client("cognito-idp", region_name=REGION)
    pools = [p["Id"] for page in cognito.get_paginator("list_user_pools").paginate(MaxResults=60)
             for p in page["UserPools"] if p["Name"] == NALEKO_POOL]
    if len(pools) != 1:
        fail(f"expected one pool named {NALEKO_POOL}, found {len(pools)}")
    pool = pools[0]
    clients = [c["ClientId"] for page in cognito.get_paginator("list_user_pool_clients").paginate(UserPoolId=pool, MaxResults=60)
               for c in page["UserPoolClients"] if c["ClientName"] == WEB_CLIENT]
    if len(clients) != 1:
        fail(f"expected one app client named {WEB_CLIENT}, found {len(clients)}")
    apis = [a["ApiEndpoint"] for a in boto3.client("apigatewayv2", region_name=REGION).get_apis()["Items"]
            if a["Name"] == EMPLOYEES_API]
    if len(apis) != 1:
        fail(f"expected one API named {EMPLOYEES_API}, found {len(apis)}")

    token = cognito.initiate_auth(
        ClientId=clients[0], AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": hr_email, "PASSWORD": hr_password},
    )["AuthenticationResult"]["IdToken"]
    print(f"::add-mask::{token}")

    email = f"{MARKER}{uuid.uuid4().hex[:12]}@{MAIL_DOMAIN}"
    request = urllib.request.Request(
        f"{apis[0]}/v1/employees", method="POST",
        data=json.dumps({"first_name": "Be15", "last_name": "Check", "email": email,
                         "phone": "0820000000", "department": "Operations"}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        status = e.code
    if status != 201:
        fail(f"POST /v1/employees answered {status}, expected 201")

    try:
        user = cognito.admin_get_user(UserPoolId=pool, Username=email)
    except cognito.exceptions.UserNotFoundException:
        fail(f"the new employee has no sign-in in {NALEKO_POOL}")
    attrs = {a["Name"]: a["Value"] for a in user["UserAttributes"]}
    if attrs.get("email_verified") != "true":
        fail("the sign-in exists but email_verified is not true")
    groups = [g["GroupName"] for g in cognito.admin_list_groups_for_user(UserPoolId=pool, Username=email)["Groups"]]
    if "employee" not in groups:
        fail("the sign-in exists but is not in group employee")
    print(f"check-dev-signin: new employee has a sign-in in {NALEKO_POOL} (group employee, email verified)")


if __name__ == "__main__":
    main()
