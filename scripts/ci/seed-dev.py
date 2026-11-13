#!/usr/bin/env python3
"""
Seed pepla-dev with a made-up demo company and one test login per role.

Runs in CI (deploy-lambdas.yml, job "E2E on pepla-dev") with the dev OIDC
role, and refuses to run in any account other than pepla-dev.

What it makes, every run, idempotently:
  * Demo company "Kestrel Outdoor (demo)": fake people in the employees
    table, all tagged seed=pepla-demo. Names, phones and dates are invented;
    no ID numbers, so nothing is KMS-encrypted.
  * One Cognito user per role (Naleko pool: HR, employee; TalentFlow pool:
    one per group). Passwords are random, kept in Secrets Manager under
    pepla-dev/e2e/<role> as {"username", "password"}. Logins use the Postmark
    blackhole domain, so no real mailbox can ever receive anything.
  * Resets the employee persona to a clean start: stage INVITED, no documents.

Output is role names and counts only: the repo and its Actions logs are public.
"""
import json
import secrets
import string
import sys
import uuid

import boto3
from botocore.exceptions import ClientError

DEV_ACCOUNT = "424556617428"
REGION = "af-south-1"
SECRET_PREFIX = "pepla-dev/e2e/"
MAIL_DOMAIN = "blackhole.postmarkapp.com"
SEED_TAG = "pepla-demo"
NALEKO_POOL = "naleko-dev-user-pool"
TF_POOL = "talent-flow-user-pool"

HR_STAFF_ID = "E2EHR01"
EMPLOYEE_ID = "E2E-EMP-0001"  # custom:employee_id holds at most 20 characters

# AI cost guardrail: every test login is in this group, and the AI Lambdas
# never call Bedrock or Textract for its members (lambda/shared/ai-guard.mjs).
ROBOT_GROUP = "e2e-robots"

NALEKO_PERSONAS = {
    "hr": {
        "attrs": {"custom:role": "hr_staff", "custom:staff_id": HR_STAFF_ID,
                  "given_name": "Thandi", "family_name": "Demo-HR"},
        "groups": ["hr_staff", "naleko-onboarding-hr", "naleko-talentflow-hr"],
    },
    "employee": {
        "attrs": {"custom:role": "employee", "custom:employee_id": EMPLOYEE_ID,
                  "given_name": "Sipho", "family_name": "Demo-Starter"},
        "groups": ["employee"],
    },
}

TF_GROUPS = ["TalentFlowAdmin", "HiringManager", "PanelMember", "ComplianceOfficer",
             "ITAdmin", "FinanceLead", "HRDirector"]

# Invented people for the demo company. Stages cover the onboarding journey.
DEMO_PEOPLE = [
    ("Lerato", "Mokoena", "Sales", "Account Executive", "INVITED"),
    ("Pieter", "van Wyk", "Operations", "Warehouse Lead", "ACTIVE"),
    ("Naledi", "Dlamini", "Finance", "Bookkeeper", "DOCUMENTS_SUBMITTED"),
    ("Tendai", "Moyo", "Engineering", "Support Engineer", "VERIFIED"),
    ("Chipo", "Banda", "People", "HR Assistant", "TRAINING"),
    ("Ayesha", "Patel", "Marketing", "Content Lead", "ONBOARDED"),
    ("Kagiso", "Nkosi", "Sales", "Store Manager", "ACTIVE"),
    ("Mwila", "Phiri", "Operations", "Driver", "INVITED"),
]


def login(role: str) -> str:
    return f"pepla-e2e-{role.lower()}@{MAIL_DOMAIN}"


def new_password() -> str:
    # Meets both pools' policies: 12+ chars with upper, lower, digit, symbol.
    alphabet = string.ascii_letters + string.digits
    core = "".join(secrets.choice(alphabet) for _ in range(20))
    return f"Pp1!{core}"


def pool_id(cognito, name: str) -> str:
    ids = [p["Id"] for page in cognito.get_paginator("list_user_pools").paginate(MaxResults=60)
           for p in page["UserPools"] if p["Name"] == name]
    if len(ids) != 1:
        sys.exit(f"::error::expected one Cognito pool named {name}, found {len(ids)}")
    return ids[0]


def require_groups(cognito, pool: str, groups: list[str]) -> None:
    """Terraform owns the Naleko groups (infra/cognito.tf). Stop if one is missing."""
    existing = {g["GroupName"] for page in cognito.get_paginator("list_groups").paginate(UserPoolId=pool)
                for g in page["Groups"]}
    for g in groups:
        if g not in existing:
            sys.exit(f"::error::Cognito group {g} is missing: Terraform owns it (infra/cognito.tf), apply Terraform first")


def ensure_groups(cognito, pool: str, groups: list[str]) -> int:
    made = 0
    for g in groups:
        try:
            cognito.create_group(UserPoolId=pool, GroupName=g,
                                 Description="Seeded for pepla-dev (prod has it by hand)")
            made += 1
        except cognito.exceptions.GroupExistsException:
            pass
    return made


def secret_password(sm, role: str) -> str:
    name = SECRET_PREFIX + role
    try:
        return json.loads(sm.get_secret_value(SecretId=name)["SecretString"])["password"]
    except sm.exceptions.ResourceNotFoundException:
        pw = new_password()
        sm.create_secret(Name=name, Description="pepla-dev E2E test login (fake persona)",
                         SecretString=json.dumps({"username": login(role), "password": pw}))
        return pw


def ensure_user(cognito, pool: str, role: str, password: str,
                attrs: dict[str, str], groups: list[str]) -> None:
    username = login(role)
    attr_list = [{"Name": "email", "Value": username}, {"Name": "email_verified", "Value": "true"}]
    attr_list += [{"Name": k, "Value": v} for k, v in attrs.items()]
    try:
        cognito.admin_create_user(UserPoolId=pool, Username=username,
                                  UserAttributes=attr_list, MessageAction="SUPPRESS")
    except cognito.exceptions.UsernameExistsException:
        if attrs:
            cognito.admin_update_user_attributes(
                UserPoolId=pool, Username=username,
                UserAttributes=[{"Name": k, "Value": v} for k, v in attrs.items()])
    cognito.admin_set_user_password(UserPoolId=pool, Username=username,
                                    Password=password, Permanent=True)
    for g in groups:
        cognito.admin_add_user_to_group(UserPoolId=pool, Username=username, GroupName=g)


def employee_item(employee_id: str, first: str, last: str, email: str, dept: str,
                  title: str, stage: str) -> dict:
    return {
        "employee_id": {"S": employee_id},
        "first_name": {"S": first},
        "middle_name": {"S": ""},
        "last_name": {"S": last},
        "email": {"S": email},
        "phone": {"S": "0800000000"},
        "department": {"S": dept},
        "job_title": {"S": title},
        "stage": {"S": stage},
        "offer_accept_date": {"S": "2026-11-01"},
        "planned_start_date": {"S": "2026-12-01"},
        "created_at": {"S": "2026-11-01T08:00:00.000Z"},
        "created_by": {"S": HR_STAFF_ID},
        "hr_staff_id": {"S": HR_STAFF_ID},
        "hr_staff_name": {"S": "Thandi Demo-HR"},
        "hr_staff_email": {"S": login("hr")},
        "seed": {"S": SEED_TAG},
    }


def reset_employee_documents(ddb, employee_id: str) -> int:
    removed = 0
    for page in ddb.get_paginator("query").paginate(
            TableName="documents",
            KeyConditionExpression="employee_id = :e",
            ExpressionAttributeValues={":e": {"S": employee_id}},
            ProjectionExpression="employee_id, document_id"):
        for item in page["Items"]:
            ddb.delete_item(TableName="documents", Key=item)
            removed += 1
    return removed


def main() -> None:
    account = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
    if account != DEV_ACCOUNT:
        sys.exit("::error::seed-dev only runs in pepla-dev")

    cognito = boto3.client("cognito-idp", region_name=REGION)
    sm = boto3.client("secretsmanager", region_name=REGION)
    ddb = boto3.client("dynamodb", region_name=REGION)

    naleko = pool_id(cognito, NALEKO_POOL)
    tf = pool_id(cognito, TF_POOL)
    require_groups(cognito, naleko, sorted({g for p in NALEKO_PERSONAS.values() for g in p["groups"]} | {ROBOT_GROUP}))
    made_groups = ensure_groups(cognito, tf, [ROBOT_GROUP])

    for role, p in NALEKO_PERSONAS.items():
        ensure_user(cognito, naleko, role, secret_password(sm, role), p["attrs"], p["groups"] + [ROBOT_GROUP])
    for group in TF_GROUPS:
        role = f"tf-{group.lower()}"
        ensure_user(cognito, tf, role, secret_password(sm, role), {}, [group, ROBOT_GROUP])

    ns = uuid.UUID("6f1c2b1e-5d0a-4c55-9a59-2f1f0e1d7c11")
    for first, last, dept, title, stage in DEMO_PEOPLE:
        email = f"pepla-demo-{first.lower()}.{last.lower().replace(' ', '')}@{MAIL_DOMAIN}"
        eid = str(uuid.uuid5(ns, email))
        ddb.put_item(TableName="employees",
                     Item=employee_item(eid, first, last, email, dept, title, stage))

    ddb.put_item(TableName="employees", Item=employee_item(
        EMPLOYEE_ID, "Sipho", "Demo-Starter", login("employee"),
        "Operations", "New Starter", "INVITED"))
    docs_removed = reset_employee_documents(ddb, EMPLOYEE_ID)

    print(f"seed-dev: groups created {made_groups}; "
          f"logins {len(NALEKO_PERSONAS) + len(TF_GROUPS)}; "
          f"demo people {len(DEMO_PEOPLE) + 1}; persona documents reset {docs_removed}")


if __name__ == "__main__":
    main()
