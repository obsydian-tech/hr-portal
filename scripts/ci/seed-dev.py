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
  * Resets the employee persona to a clean start: stage INVITED, step INVITED, no documents.
  * Four documents for Naledi Dlamini (ONB-13), written straight to DynamoDB with
    fixed ids: no Textract, no ID number. Three wait for an HR decision, the
    matric certificate is already accepted. Each one also gets a one-page sample
    PDF (fake text only) in the dev upload bucket, so "Open the file" works
    (seed-dev-files.py puts the files there; this script only writes the keys).
    The files sit under seed-samples/, not uploads/, because anything under
    uploads/ starts the OCR Lambda.

  * TEN-02: a second company (B) with its own HR test login (group hr_staff, a Member row
    for B). Only that login belongs to B; every other test login stays in the first company.
  * TEN-01: the first company's row (TENANT#<id> / PROFILE) in the tenants table,
    written once and never changed after. The id comes from infra/env/dev.tfvars.
  * REC-01: two more Naleko-pool logins of the first company, a manager (group manager, no tick) and an HR login
    without the Recruitment tick (group hr_staff only); two candidates in talent-flow-state, the manager as hiring
    manager of one and not of the other; and an interview of the first with the employee login on its panel.
Output is role names and counts only: the repo and its Actions logs are public.
"""
import hashlib
import json
import pathlib
import re
import secrets
import string
import sys
import time
import uuid

import boto3
from botocore.exceptions import ClientError

DEV_ACCOUNT = "424556617428"
NS = uuid.UUID("6f1c2b1e-5d0a-4c55-9a59-2f1f0e1d7c11")
UPLOAD_BUCKET = f"pepla-dev-document-uploads-{DEV_ACCOUNT}"
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
# TEN-05: groups the Terraform apply adds after the merge. Until pepla-dev has them, the seed leaves them out
# (one warning) so the other tests still run; every other group stays required.
TEN05_GROUPS = {"admin", "manager", "guest", "perm-recruitment", "perm-it", "perm-approve-offers"}

NALEKO_PERSONAS = {
    "hr": {
        "attrs": {"custom:role": "hr_staff", "custom:staff_id": HR_STAFF_ID,
                  "given_name": "Thandi", "family_name": "Demo-HR"},
        "groups": ["hr_staff", "naleko-onboarding-hr", "naleko-talentflow-hr", "perm-recruitment"],
    },
    # TEN-02: the HR login of the second company (B). Its Member row is written below.
    "hr-b": {
        "attrs": {"custom:role": "hr_staff", "custom:staff_id": "E2EHRB1",
                  "given_name": "Zanele", "family_name": "Companyb-Lead"},
        "groups": ["hr_staff", "naleko-onboarding-hr", "naleko-talentflow-hr", "perm-recruitment"],
    },
    # TEN-05: an IT login and a guest login of company A in the Naleko pool.
    "it": {
        "attrs": {"given_name": "Lindo", "family_name": "Demo-IT"},
        "groups": ["naleko-it-provisioning", "perm-it"],
    },
    # TEN-04: the company walk. tf holds every TalentFlow role and tick in company A. The walk's "company B" callers
    # (hr-c, tf-b, it-b) belong to the THIRD company (WALK_TENANT_ID), which has Onboarding and Recruitment switched
    # on: company B has only Onboarding, so on B every Recruitment route would answer 403 (module off) instead of the
    # 404 the walk looks for. MOD-01 AC-10 keeps using company B (hr-b) unchanged. Each caller holds the roles, so a
    # 404 proves the row is hidden, not that a role is missing. victim is a company A user nobody signs in as: the
    # admin user routes need one to aim at. The test reads hr-c as E2E_HR_B (see app-e2e-dev.yml).
    "hr-c": {
        "attrs": {"custom:role": "hr_staff", "custom:staff_id": "E2EHRC1",
                  "given_name": "Cebo", "family_name": "Companyb-Walk"},
        "groups": ["hr_staff", "naleko-onboarding-hr", "naleko-talentflow-hr", "perm-recruitment"],
    },
    # REC-05 AC-11: the offer approver of company A; the Member row is written in main(). An employee with the Approve
    # offers tick, as the locked REC-UI-04 tests have it (D-T-04.3). Without a role the app refuses the sign-in ("This
    # account can't use Naleko People yet.") and REC-UI-04.2 AC-14.1 never gets a token. REC-05 AC-11 signs in through
    # the API and does not mind either way.
    "approver": {
        "attrs": {"given_name": "Anele", "family_name": "Demo-Approver"},
        "groups": ["employee", "perm-approve-offers"],
    },
    "tf": {
        "attrs": {"given_name": "Tessa", "family_name": "Demo-TF"},
        "groups": ["admin", "manager", "perm-recruitment", "perm-it", "perm-approve-offers"],
    },
    "tf-b": {
        "attrs": {"given_name": "Zola", "family_name": "Companyb-TF"},
        "groups": ["admin", "manager", "perm-recruitment", "perm-it", "perm-approve-offers"],
    },
    "it-b": {
        "attrs": {"given_name": "Zinhle", "family_name": "Companyb-IT"},
        "groups": ["naleko-it-provisioning", "perm-it"],
    },
    "victim": {
        "attrs": {"given_name": "Vic", "family_name": "Demo-Victim"},
        "groups": ["guest"],
    },
    "guest": {
        "attrs": {"given_name": "Nandi", "family_name": "Demo-Guest"},
        "groups": ["guest"],
    },
    # REC-01: a manager (hiring manager of one seeded candidate) and HR without the Recruitment tick.
    "manager": {
        "attrs": {"given_name": "Mpho", "family_name": "Demo-Manager"},
        "groups": ["manager"],
    },
    "hr-notick": {
        "attrs": {"custom:role": "hr_staff", "custom:staff_id": "E2EHRN1",
                  "given_name": "Hlengiwe", "family_name": "Demo-NoTick"},
        "groups": ["hr_staff"],
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

# ONB-10: Pieter's documents were due on 3 Nov 2026, so he is always overdue; Mwila starts in 2030, so he never is.
# Everyone else, and the test employee, start on 1 Dec 2026.
START_DATES = {("Pieter", "van Wyk"): "2026-11-10", ("Mwila", "Phiri"): "2030-01-01"}

# ONB-09: the stored onboarding step of each current stage. Chipo (TRAINING) and Ayesha (ONBOARDED)
# get none on purpose: pepla-dev keeps two rows like the prod ones, and the API answers their step from
# the stage.
STEP_OF_STAGE = {
    "INVITED": "INVITED",
    "ACTIVE": "DOCUMENTS",
    "DOCUMENTS_SUBMITTED": "IN_REVIEW",
    "VERIFIED": "VERIFIED",
}


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


def user_sub(cognito, pool: str, role: str) -> str:
    attrs = cognito.admin_get_user(UserPoolId=pool, Username=login(role))["UserAttributes"]
    return next((a["Value"] for a in attrs if a["Name"] == "sub"), "")


def employee_item(employee_id: str, first: str, last: str, email: str, dept: str,
                  title: str, stage: str, tenant_id: str = "", owner_sub: str = "",
                  start_date: str = "2026-12-01") -> dict:
    item = {
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
        "planned_start_date": {"S": start_date},
        "created_at": {"S": "2026-11-01T08:00:00.000Z"},
        "created_by": {"S": HR_STAFF_ID},
        "hr_staff_id": {"S": HR_STAFF_ID},
        "hr_staff_name": {"S": "Thandi Demo-HR"},
        "hr_staff_email": {"S": login("hr")},
        "seed": {"S": SEED_TAG},
    }
    if stage in STEP_OF_STAGE:
        item["step"] = {"S": STEP_OF_STAGE[stage]}
    # TEN-02: the seed rewrites these rows on every run, so it must give them their company (and the test
    # employee its sign-in id) again, as the backfill does. Without them the company checks refuse the rows.
    if tenant_id:
        item["tenant_id"] = {"S": tenant_id}
    if owner_sub:
        item["user_sub"] = {"S": owner_sub}
    return item


def reset_employee_consents(ddb, employee_id: str) -> int:
    """ONB-05: the test persona starts every run without having accepted the privacy notice (dev only)."""
    removed = 0
    try:
        for page in ddb.get_paginator("query").paginate(
                TableName="employee_consents",
                KeyConditionExpression="employee_id = :e",
                ExpressionAttributeValues={":e": {"S": employee_id}},
                ProjectionExpression="employee_id, notice_version"):
            for item in page["Items"]:
                ddb.delete_item(TableName="employee_consents", Key=item)
                removed += 1
    except ddb.exceptions.ResourceNotFoundException:
        return 0  # the table arrives with the apply after the merge; nothing to remove before then
    return removed


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


# ONB-14: made-up numbers so Show has something to show on dev. They fail the SA ID check digit and are zeros: never real.
# Nothing prints them.
MADE_UP_NUMBERS = {
    "NATIONAL_ID": {"idNumber": {"S": "9801010000001"}, "idNumber_last4": {"S": "0001"}},
    "BANK_CONFIRMATION": {"accountNumber": {"S": "0000000000"}},
}

# Naledi Dlamini's documents (ONB-13). (document_id, type, uploaded, ocr_status, confidence or None, decided)
NALEDI_DOCUMENTS = [
    ("doc_1762156800000", "NATIONAL_ID", "2026-11-03T08:00:00Z", "MANUAL_REVIEW", 96, False),
    ("doc_1762243200000", "BANK_CONFIRMATION", "2026-11-04T08:00:00Z", "MANUAL_REVIEW", 72, False),
    ("doc_1762329600000", "TERTIARY_QUALIFICATION", "2026-11-05T08:00:00Z", "PENDING", None, False),
    ("doc_1762070400000", "MATRIC_CERTIFICATE", "2026-11-02T08:00:00Z", "PASSED", 95, True),
]


def sample_key(employee_id: str, doc_id: str) -> str:
    return f"seed-samples/{employee_id}/{doc_id}.pdf"


def sample_pdf(title: str) -> bytes:
    """A one-page PDF with a fake line of text. Built by hand so the seed needs no extra package."""
    text = f"({title}) Tj".replace("\\", "\\\\")
    stream = f"BT /F1 20 Tf 72 720 Td {text} ET\nBT /F1 12 Tf 72 690 Td (Sample document. Fake data for testing only.) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def seed_documents(ddb, ns: uuid.UUID, employee_id: str, tenant_id: str = "") -> int:
    """Replace the person's documents with the fixed set. The ID and bank rows carry one made-up number each (ONB-14); never printed."""
    reset_employee_documents(ddb, employee_id)
    for doc_id, doc_type, uploaded, status, confidence, decided in NALEDI_DOCUMENTS:
        s3_key = sample_key(employee_id, doc_id)
        item = {
            "employee_id": {"S": employee_id},
            "document_id": {"S": doc_id},
            "document_type": {"S": doc_type},
            "file_name": {"S": f"{doc_type.lower()}.pdf"},
            # ONB-15: the file link route signs this key, so a sample file must sit behind it.
            # Not under uploads/: that prefix starts the OCR Lambda.
            "s3_key": {"S": s3_key},
            "upload_timestamp": {"S": uploaded},
            "ocr_status": {"S": status},
            "seed": {"S": SEED_TAG},
        }
        if tenant_id:
            item["tenant_id"] = {"S": tenant_id}
        if confidence is not None:
            vid = str(uuid.uuid5(ns, f"verification:{doc_id}"))
            item["verification_id"] = {"S": vid}
            ddb.put_item(TableName="document-verification", Item={
                "verificationId": {"S": vid},
                "employeeId": {"S": employee_id},
                "documentId": {"S": doc_id},
                "documentType": {"S": doc_type},
                "confidence": {"N": str(confidence)},
                "decision": {"S": status},
                # ONB-07: Batsi's check is stored on the row; 90 or more matches, as the screens showed before.
                "check": {"S": "MATCHES" if confidence >= 90 else "NEEDS_A_LOOK"},
                "createdAt": {"S": uploaded},
                "seed": {"S": SEED_TAG},
                **MADE_UP_NUMBERS.get(doc_type, {}),
                **({"tenant_id": {"S": tenant_id}} if tenant_id else {}),
            })
        if decided:
            item["hr_reviewed_at"] = {"S": "2026-11-06T08:00:00Z"}
            # ONB-15: a decision carries who made it, so the decided view has a name on dev.
            item["hr_reviewed_by"] = {"S": login("hr")}
            item["hr_reviewed_by_name"] = {"S": "Thandi Demo-HR"}
        ddb.put_item(TableName="documents", Item=item)
    return len(NALEDI_DOCUMENTS)


TENANTS_TABLE = "naleko-people-dev-tenants"
DEV_TFVARS = pathlib.Path(__file__).resolve().parents[2] / "infra" / "env" / "dev.tfvars"


def founding_tenant_id() -> str:
    m = re.search(r'^\s*founding_tenant_id\s*=\s*"(ten_[0-9a-z]{26})"', DEV_TFVARS.read_text(), re.M)
    if not m:
        sys.exit("::error::infra/env/dev.tfvars has no founding_tenant_id")
    return m.group(1)


def ensure_founding_company(ddb) -> int:
    """TEN-01: the first company's row. Written once; an existing row is left as it is."""
    tid = founding_tenant_id()
    try:
        ddb.put_item(TableName=TENANTS_TABLE, Item={
            "pk": {"S": f"TENANT#{tid}"}, "sk": {"S": "PROFILE"}, "tenant_id": {"S": tid},
            "name": {"S": "Founding client"}, "status": {"S": "ACTIVE"}, "country": {"S": "ZA"},
            "founding": {"BOOL": True}, "created_at": {"S": "2026-11-16T00:00:00Z"},
        }, ConditionExpression="attribute_not_exists(pk)")
        return 1
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return 0
        raise


def ensure_founding_member(ddb, sub: str) -> int:
    """REC-14 rule 12: a hiring manager needs a Member row (no legacy-company fallback). The manager login's row for the
    first company, written once; an existing row stays as it is."""
    tid = founding_tenant_id()
    try:
        ddb.put_item(TableName=TENANTS_TABLE, Item={
            "pk": {"S": f"USER#{sub}"}, "sk": {"S": f"TENANT#{tid}"}, "tenant_id": {"S": tid},
            "created_at": {"S": "2026-11-23T00:00:00Z"},
        }, ConditionExpression="attribute_not_exists(pk)")
        return 1
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return 0
        raise


# TEN-02: the second company. Fixed id, so every run finds the same rows.
SECOND_TENANT_ID = "ten_b2e2ec0mpanyb00000000000da"


def ensure_second_company(ddb, hr_b_sub: str) -> int:
    """The second company's row and its HR login's Member row. Each is written once; an existing row stays as it is."""
    written = 0
    items = [
        {"pk": {"S": f"TENANT#{SECOND_TENANT_ID}"}, "sk": {"S": "PROFILE"}, "tenant_id": {"S": SECOND_TENANT_ID},
         "name": {"S": "Company B (demo)"}, "status": {"S": "ACTIVE"}, "country": {"S": "ZA"},
         "created_at": {"S": "2026-11-17T00:00:00Z"}},
        {"pk": {"S": f"USER#{hr_b_sub}"}, "sk": {"S": f"TENANT#{SECOND_TENANT_ID}"}, "tenant_id": {"S": SECOND_TENANT_ID},
         "created_at": {"S": "2026-11-17T00:00:00Z"}},
    ]
    for item in items:
        try:
            ddb.put_item(TableName=TENANTS_TABLE, Item=item, ConditionExpression="attribute_not_exists(pk)")
            written += 1
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    return written


# TEN-04: the third company, for the company walk only. Fixed id, so every run finds the same rows.
WALK_TENANT_ID = "ten_c3w4lkc0mpanyc0000000000ab"


def ensure_walk_company(ddb, member_subs: tuple) -> int:
    """The walk company's row and a Member row for each of its logins. Each is written once; an existing row stays."""
    written = 0
    items = [{"pk": {"S": f"TENANT#{WALK_TENANT_ID}"}, "sk": {"S": "PROFILE"}, "tenant_id": {"S": WALK_TENANT_ID},
              "name": {"S": "Company C (walk)"}, "status": {"S": "ACTIVE"}, "country": {"S": "ZA"},
              "created_at": {"S": "2026-11-18T00:00:00Z"}}]
    for sub in member_subs:
        # An earlier version of the seed put tf-b and it-b in company B; take that membership away.
        ddb.delete_item(TableName=TENANTS_TABLE, Key={"pk": {"S": f"USER#{sub}"}, "sk": {"S": f"TENANT#{SECOND_TENANT_ID}"}})
        items.append({"pk": {"S": f"USER#{sub}"}, "sk": {"S": f"TENANT#{WALK_TENANT_ID}"}, "tenant_id": {"S": WALK_TENANT_ID},
                      "created_at": {"S": "2026-11-18T00:00:00Z"}})
    for item in items:
        try:
            ddb.put_item(TableName=TENANTS_TABLE, Item=item, ConditionExpression="attribute_not_exists(pk)")
            written += 1
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    return written


# MOD-01: the dev companies' modules, set on every run (the founding company both, company B Onboarding only), so a
# test that turned Recruitment on for B is put back. Only an existing Company row is changed. Prod is never seeded:
# there the set-modules script does it, with an audit row.
DEV_MODULES = {"founding": ["onboarding", "recruitment"], "second": ["onboarding"], "walk": ["onboarding", "recruitment"]}


def set_dev_modules(ddb) -> int:
    changed = 0
    for tid, keys in ((founding_tenant_id(), DEV_MODULES["founding"]), (SECOND_TENANT_ID, DEV_MODULES["second"]),
                      (WALK_TENANT_ID, DEV_MODULES["walk"])):
        try:
            ddb.update_item(TableName=TENANTS_TABLE, Key={"pk": {"S": f"TENANT#{tid}"}, "sk": {"S": "PROFILE"}},
                            UpdateExpression="SET #m = :m", ConditionExpression="attribute_exists(pk)",
                            ExpressionAttributeNames={"#m": "modules"}, ExpressionAttributeValues={":m": {"SS": keys}})
            changed += 1
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    return changed


# REC-01: two candidates of the first company, so the access checks have something to tell apart. Fixed ids, so every run
# finds the same rows; invented people on the blackhole domain. The manager login is the hiring manager of the first and
# not of the second; the employee login is on the panel of the first one's interview.
STATE_TABLE = "talent-flow-state"
SEED_CANDIDATES = [
    ("CAND-SEEDDEV00000000000000001", "Thabo", "Seed-One", "MANAGER"),
    ("CAND-SEEDDEV00000000000000002", "Naomi", "Seed-Two", "OTHER"),
]
SEED_INTERVIEW_ID = "iv-seed-dev-0001"
OTHER_HIRING_MANAGER = "seed-other-hiring-manager"


# REC-14: every dev company gets its department list. The starting names are read from the seed prod uses
# (scripts/tenancy/company-seeds/departments.mjs, STARTING), so there is one list of names; this file does not start node,
# because the BE-16 seed test runs seed-dev.py with a fake boto3 only. Like that seed, a company with a list keeps it.
# The founding company also gets "Fleet" with a fixed id for the company walk (support/ten-04/dev-ids.json `department`);
# a test that renamed or archived it is put back on every run. The second company gets a name of its own so the two
# lists differ. Nothing is ever deleted; a change writes the next version.
DEPARTMENTS_SEED = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "tenancy" / "company-seeds" / "departments.mjs"
WALK_DEPARTMENT = {"id": "dep_01TEN04A000000000000000001", "name": "Fleet"}
SECOND_COMPANY_DEPARTMENT = "Dispatch"
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def starting_departments() -> list:
    m = re.search(r"export const STARTING = \[([^\]]*)\];", DEPARTMENTS_SEED.read_text())
    names = re.findall(r"'([^']+)'", m.group(1)) if m else []
    if not names:
        sys.exit("::error::scripts/tenancy/company-seeds/departments.mjs has no STARTING list")
    return names


def _department_id() -> str:
    t = int(time.time() * 1000)
    stamp = ""
    for _ in range(10):
        stamp = _CROCKFORD[t % 32] + stamp
        t //= 32
    return "dep_" + stamp + "".join(secrets.choice(_CROCKFORD) for _ in range(16))


def _department_list(ddb, tid: str):
    item = ddb.get_item(TableName=TENANTS_TABLE, Key={"pk": {"S": f"TENANT#{tid}"}, "sk": {"S": "DEPARTMENTS"}},
                        ConsistentRead=True).get("Item")
    if not item:
        return None, []
    deps = [{"id": d["M"]["id"]["S"], "name": d["M"]["name"]["S"], "status": d["M"]["status"]["S"]}
            for d in item.get("departments", {}).get("L", [])]
    return int(item["version"]["N"]), deps


def _write_department_list(ddb, tid: str, version, deps: list) -> None:
    """Writes the next version (version None: the first one, only when there is still none)."""
    cond = ({"ConditionExpression": "attribute_not_exists(sk)"} if version is None else
            {"ConditionExpression": "#version = :read", "ExpressionAttributeNames": {"#version": "version"},
             "ExpressionAttributeValues": {":read": {"N": str(version)}}})
    ddb.put_item(TableName=TENANTS_TABLE, Item={
        "pk": {"S": f"TENANT#{tid}"}, "sk": {"S": "DEPARTMENTS"}, "tenant_id": {"S": tid},
        "version": {"N": str((version or 0) + 1)},
        "departments": {"L": [{"M": {"id": {"S": d["id"]}, "name": {"S": d["name"]}, "status": {"S": d["status"]}}} for d in deps]},
        "updated_at": {"S": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, "updated_by": {"S": "seed-dev"},
    }, **cond)


def seed_departments(ddb) -> int:
    """The three dev companies' lists, the walk's Fleet and company B's own name. A second run changes nothing."""
    founding = founding_tenant_id()
    written = 0
    for tid in (founding, SECOND_TENANT_ID, WALK_TENANT_ID):
        version, _ = _department_list(ddb, tid)
        if version is None:
            _write_department_list(ddb, tid, None, [{"id": _department_id(), "name": n, "status": "ACTIVE"} for n in starting_departments()])
            written += 1
    version, deps = _department_list(ddb, founding)
    want = {**WALK_DEPARTMENT, "status": "ACTIVE"}
    if want not in deps:
        if any(d["id"] != want["id"] and d["name"].lower() == want["name"].lower() for d in deps):
            print("warning: the founding company has another department called Fleet; the walk department was not put back")
        else:
            _write_department_list(ddb, founding, version, [d for d in deps if d["id"] != want["id"]] + [want])
            written += 1
    version, deps = _department_list(ddb, SECOND_TENANT_ID)
    if not any(d["name"].lower() == SECOND_COMPANY_DEPARTMENT.lower() for d in deps):
        _write_department_list(ddb, SECOND_TENANT_ID, version,
                               deps + [{"id": _department_id(), "name": SECOND_COMPANY_DEPARTMENT, "status": "ACTIVE"}])
        written += 1
    return written

def seed_candidates(ddb, tenant_id: str, manager_sub: str, employee_sub: str) -> int:
    """Write the two seeded candidates (and the interview with the employee login on its panel). Idempotent."""
    if not manager_sub or not employee_sub:
        print("warning: the manager or employee login has no sub; the seeded candidates were not written")
        return 0
    now = "2026-11-10T08:00:00.000Z"
    written = 0
    for cid, first, last, who in SEED_CANDIDATES:
        ddb.put_item(TableName=STATE_TABLE, Item={
            "PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": "SAGA"},
            "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#{now}#{cid}"},
            "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id},
            "firstName": {"S": first}, "lastName": {"S": last},
            "email": {"S": f"pepla-demo-{first.lower()}.{last.lower()}@{MAIL_DOMAIN}"},
            "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "department": {"S": "Operations"},
            "currentStage": {"S": "APPLIED"}, "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"},
            "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "appliedDate": {"S": now},
            "hiringManagerId": {"S": manager_sub if who == "MANAGER" else OTHER_HIRING_MANAGER},
            "seed": {"S": SEED_TAG},
        })
        written += 1
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": f"CANDIDATE#{SEED_CANDIDATES[0][0]}"}, "SK": {"S": f"INTERVIEW#{SEED_INTERVIEW_ID}"},
        "interviewId": {"S": SEED_INTERVIEW_ID}, "candidateId": {"S": SEED_CANDIDATES[0][0]}, "tenant_id": {"S": tenant_id},
        "interviewType": {"S": "HR_SCREEN"}, "status": {"S": "SCHEDULED"}, "scheduledAt": {"S": "2026-11-20T09:00:00.000Z"},
        "votesRequired": {"N": "2"}, "votesSubmitted": {"N": "0"}, "panelMemberIds": {"L": [{"S": employee_sub}]},
        "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
    })
    return written + 1


# REC-02: the candidate the dev test casts a Strong No on. The row, its interview and its votes are written again on every run,
# so the panel login can vote once each time and the Strong No count starts at nothing (D-T-12). Company A, MID level, in Interview;
# the employee login is on the panel and has not voted. The other manager is the hiring manager, so the manager test login
# still lists exactly one candidate (REC-01 AC-9); the test reads this candidate as HR and votes as the panel login.
REC02_CANDIDATE = "CAND-SEEDREC020000000000001"
REC02_INTERVIEW = "iv-seed-rec02-0001"


def active_config_version(ddb, tenant_id: str, config_type: str) -> str:
    """The version of one setting the company has active (the candidate is locked to it); "1" when the company has none yet."""
    try:
        r = ddb.query(TableName="talent-flow-config", IndexName="GSI1-active-configs",
                      KeyConditionExpression="GSI1PK = :pk AND GSI1SK = :sk",
                      ExpressionAttributeValues={":pk": {"S": f"TENANT#{tenant_id}#ACTIVE"}, ":sk": {"S": f"CONFIG#{config_type}"}}, Limit=1)
    except ddb.exceptions.ResourceNotFoundException:
        return "1"
    items = r.get("Items", [])
    return items[0].get("version", {}).get("N", "1") if items else "1"


def clear_rec02_test_candidates(ddb, tenant_id: str) -> int:
    """Delete the candidates the REC-02 (AC-12) and REC-03 (AC-11) dev tests create each run (first name Rec, last name
    Zero-Two or Zero-Three, email rec02.* or rec03.*) with every row they hold, so the manager test login is hiring manager
    for one candidate again (REC-01 AC-9). Only this company's rows, only those three markers together."""
    return sum(_clear_marked_candidates(ddb, tenant_id, last, prefix) for last, prefix in (("Zero-Two", "rec02."), ("Zero-Three", "rec03.")))


def _clear_marked_candidates(ddb, tenant_id: str, last: str, prefix: str) -> int:
    removed = 0
    kwargs = {"TableName": STATE_TABLE, "IndexName": "GSI1",
              "KeyConditionExpression": "GSI1PK = :pk AND begins_with(GSI1SK, :p)",
              "FilterExpression": "firstName = :f AND lastName = :l AND begins_with(email, :e) AND tenant_id = :t",
              "ExpressionAttributeValues": {":pk": {"S": f"TENANT#{tenant_id}"}, ":p": {"S": "SAGA#"}, ":f": {"S": "Rec"},
                                            ":l": {"S": last}, ":e": {"S": prefix}, ":t": {"S": tenant_id}},
              "ProjectionExpression": "PK"}
    while True:
        page = ddb.query(**kwargs)
        for item in page.get("Items", []):
            pk = item["PK"]
            rows = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk",
                             ExpressionAttributeValues={":pk": pk}, ProjectionExpression="PK, SK")
            for row in rows.get("Items", []):
                ddb.delete_item(TableName=STATE_TABLE, Key={"PK": row["PK"], "SK": row["SK"]})
            removed += 1
        if "LastEvaluatedKey" not in page:
            return removed
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def seed_rec02(ddb, tenant_id: str, manager_sub: str, employee_sub: str) -> int:
    """Write the REC-02 vote candidate fresh: no votes, no flags, no decision. Idempotent."""
    if not manager_sub or not employee_sub:
        print("warning: the manager or employee login has no sub; the REC-02 candidate was not written")
        return 0
    removed = clear_rec02_test_candidates(ddb, tenant_id)
    if removed:
        print(f"cleared {removed} candidate(s) an earlier REC-02 or REC-03 dev test left behind")
    now = "2026-11-10T08:00:00.000Z"
    pk = f"CANDIDATE#{REC02_CANDIDATE}"
    stale = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
                      ExpressionAttributeValues={":pk": {"S": pk}, ":p": {"S": "VOTE#"}}, ProjectionExpression="PK, SK")
    for item in stale.get("Items", []):
        ddb.delete_item(TableName=STATE_TABLE, Key={"PK": item["PK"], "SK": item["SK"]})
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": pk}, "SK": {"S": "SAGA"},
        "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#{now}#{REC02_CANDIDATE}"},
        "candidateId": {"S": REC02_CANDIDATE}, "tenant_id": {"S": tenant_id},
        "firstName": {"S": "Rec"}, "lastName": {"S": "Seed-Vote"},
        "email": {"S": f"pepla-demo-rec.seed-vote@{MAIL_DOMAIN}"},
        "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "department": {"S": "Operations"},
        "currentStage": {"S": "INTERVIEW"}, "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"},
        "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "appliedDate": {"S": now},
        "configVersion": {"S": active_config_version(ddb, tenant_id, "SCORING_WEIGHTS")},
        "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
    })
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": pk}, "SK": {"S": f"INTERVIEW#{REC02_INTERVIEW}"},
        "interviewId": {"S": REC02_INTERVIEW}, "candidateId": {"S": REC02_CANDIDATE}, "tenant_id": {"S": tenant_id},
        "interviewType": {"S": "HR_SCREEN"}, "status": {"S": "SCHEDULED"}, "scheduledAt": {"S": "2026-11-20T09:00:00.000Z"},
        "votesRequired": {"N": "2"}, "votesSubmitted": {"N": "0"}, "panelMemberIds": {"L": [{"S": employee_sub}]},
        "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
    })
    return 2


# REC-03: three candidates the dev test reads after the stage move. They are written again on every run in the OLD form (the stage
# move, scripts/recruitment/migrate-stages.mjs, runs right after the seed and changes them), and anything an earlier move left on
# them (history rows) is removed first, so every run starts from the same three rows. Company A, MID level. Their hiring manager is
# the other manager, not the manager test login, so that login still lists exactly one candidate (REC-01 AC-9).
#   1 Applied with one interview: the level lock (LEVEL_LOCKED)
#   2 stored as INTERVIEWING: reads as INTERVIEW after the move, the old name kept as legacy_stage
#   3 stored as EVALUATION with status REJECTED and a rejection time: Not hired by the old system, on REC-02's list
REC03_CANDIDATES = [
    ("CAND-SEEDREC030000000000001", "Applied-One", "APPLIED", {}),
    ("CAND-SEEDREC030000000000002", "Old-Interview", "INTERVIEWING", {}),
    ("CAND-SEEDREC030000000000003", "Old-Rejected", "EVALUATION", {"status": "REJECTED", "evaluationCompletedAt": "2026-09-14T10:00:00.000Z"}),
]
REC03_INTERVIEW = "iv-seed-rec03-0001"


def seed_rec03(ddb, tenant_id: str, manager_sub: str) -> int:
    """Write the three REC-03 candidates fresh (and the one interview). Idempotent."""
    if not manager_sub:
        print("warning: the manager login has no sub; the REC-03 candidates were not written")
        return 0
    now = "2026-11-10T08:00:00.000Z"
    written = 0
    for cid, last, stage, extra in REC03_CANDIDATES:
        pk = f"CANDIDATE#{cid}"
        stale = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
                          ExpressionAttributeValues={":pk": {"S": pk}, ":p": {"S": "STAGE#"}}, ProjectionExpression="PK, SK")
        for item in stale.get("Items", []):
            ddb.delete_item(TableName=STATE_TABLE, Key={"PK": item["PK"], "SK": item["SK"]})
        item = {
            "PK": {"S": pk}, "SK": {"S": "SAGA"},
            "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#{now}#{cid}"},
            "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id},
            "firstName": {"S": "Rec"}, "lastName": {"S": last},
            "email": {"S": f"pepla-demo-rec.{last.lower()}@{MAIL_DOMAIN}"},
            "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "department": {"S": "Operations"},
            "currentStage": {"S": stage}, "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"},
            "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "appliedDate": {"S": now},
            "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
        }
        for k, v in extra.items():
            item[k] = {"S": v}
        ddb.put_item(TableName=STATE_TABLE, Item=item)
        written += 1
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": f"CANDIDATE#{REC03_CANDIDATES[0][0]}"}, "SK": {"S": f"INTERVIEW#{REC03_INTERVIEW}"},
        "interviewId": {"S": REC03_INTERVIEW}, "candidateId": {"S": REC03_CANDIDATES[0][0]}, "tenant_id": {"S": tenant_id},
        "interviewType": {"S": "HR_SCREEN"}, "status": {"S": "SCHEDULED"}, "scheduledAt": {"S": "2026-11-20T09:00:00.000Z"},
        "votesRequired": {"N": "0"}, "votesSubmitted": {"N": "0"}, "panelMemberIds": {"L": []},
        "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
    })
    return written + 1


# REC-04: the roles and candidates the hiring board reads on pepla-dev (REC-UI-01 AC-13, cards/rec-ui-01.md). Fixed ids, written
# again on every run, so whatever a dev run did to them (a candidate moved or Not hired, a history row, a role closed) is put back.
# The manager login is the hiring manager of Senior accountant only, and of no seeded candidate (REC-01 AC-9 counts its candidates).
ROLES_TABLE = "talent-flow-roles"
REC04_ROLES = [
    # (role id, title, department, level, hiring manager is the manager login)
    ("role-seed-rec04-fleet-controller", "Fleet controller", "Operations", "MID", False),
    ("role-seed-rec04-warehouse-supervisor", "Warehouse supervisor", "Operations", "SENIOR", False),
    ("role-seed-rec04-senior-accountant", "Senior accountant", "Finance", "SENIOR", True),
]
REC04_PANEL = {"JUNIOR": 2, "MID": 3, "SENIOR": 4}
REC04_CRITERIA = [("technical", "Technical"), ("communication", "Communication"), ("culturalFit", "Cultural fit"), ("problemSolving", "Problem solving")]
REC04_CANDIDATES = [
    # (candidate id, first, last, role id, stage, extra)
    ("CAND-SEEDREC040000000000001", "Amahle", "Dlamini", REC04_ROLES[0][0], "APPLIED", {}),
    ("CAND-SEEDREC040000000000002", "Tariro", "Moyo", REC04_ROLES[0][0], "SCREENING", {}),
    ("CAND-SEEDREC040000000000003", "Ayanda", "Mkhize", REC04_ROLES[0][0], "SCREENING", {}),
    ("CAND-SEEDREC040000000000004", "Tendai", "Ncube", REC04_ROLES[0][0], "INTERVIEW", {}),
    ("CAND-SEEDREC040000000000005", "Bongani", "Mthembu", REC04_ROLES[0][0], "INTERVIEW", {}),
    ("CAND-SEEDREC040000000000006", "Kagiso", "Molefe", REC04_ROLES[0][0], "OFFER", {}),
    ("CAND-SEEDREC040000000000007", "Nomvula", "Zulu", REC04_ROLES[0][0], "NOT_HIRED", {"reason_code": "WITHDREW", "decided_by_kind": "PERSON"}),
    ("CAND-SEEDREC040000000000008", "Farai", "Moyo", REC04_ROLES[0][0], "NOT_HIRED", {"reason_code": "NOT_RIGHT_SKILLS", "decided_by_kind": "PERSON"}),
    ("CAND-SEEDREC040000000000009", "Mpho", "Sithole", REC04_ROLES[1][0], "NOT_HIRED", {"status": "REJECTED", "decided_by_kind": "OLD_SYSTEM"}),
    # A live (not Not hired) candidate on a second role, so the Candidates list on pepla-dev shows more than one role (REC-UI-02 AC-15).
    # Warehouse supervisor is not the manager login's role and every row here names the other hiring manager, so REC-01 AC-9 still counts one.
    ("CAND-SEEDREC040000000000010", "Lerato", "Khumalo", REC04_ROLES[1][0], "APPLIED", {}),
]


def seed_rec04(ddb, tenant_id: str, manager_sub: str) -> int:
    """Write the REC-04 roles and candidates fresh, and remove the roles a dev run opened. Idempotent."""
    if not manager_sub:
        print("warning: the manager login has no sub; the REC-04 roles were not written")
        return 0
    now = "2026-11-10T08:00:00.000Z"
    written = 0
    # Roles the REC-04 dev test opened (and closed) on an earlier run.
    kwargs = {"TableName": ROLES_TABLE, "KeyConditionExpression": "pk = :pk AND begins_with(sk, :r)",
              "ExpressionAttributeValues": {":pk": {"S": f"TENANT#{tenant_id}"}, ":r": {"S": "ROLE#"}}}
    while True:
        page = ddb.query(**kwargs)
        for item in page.get("Items", []):
            if item.get("job_title", {}).get("S", "").startswith("REC-04 dev check") and item.get("tenant_id", {}).get("S") == tenant_id:
                ddb.delete_item(TableName=ROLES_TABLE, Key={"pk": item["pk"], "sk": item["sk"]})
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    roles = {}
    for rid, title, dept, level, mine in REC04_ROLES:
        roles[rid] = (title, level)
        ddb.put_item(TableName=ROLES_TABLE, Item={
            "pk": {"S": f"TENANT#{tenant_id}"}, "sk": {"S": f"ROLE#{rid}"}, "tenant_id": {"S": tenant_id}, "role_id": {"S": rid},
            "job_title": {"S": title}, "department": {"S": dept}, "level": {"S": level},
            "hiring_manager_id": {"S": manager_sub if mine else OTHER_HIRING_MANAGER},
            "criteria": {"L": [{"M": {"key": {"S": k}, "label": {"S": l}}} for k, l in REC04_CRITERIA]},
            "panel_size": {"N": str(REC04_PANEL[level])}, "status": {"S": "OPEN"}, "opened_at": {"S": now},
            "opened_by": {"S": "seed-dev"}, "legacy": {"BOOL": False}, "seed": {"S": SEED_TAG},
        })
        written += 1
    for cid, first, last, rid, stage, extra in REC04_CANDIDATES:
        pk = f"CANDIDATE#{cid}"
        stale = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
                          ExpressionAttributeValues={":pk": {"S": pk}, ":p": {"S": "STAGE#"}}, ProjectionExpression="PK, SK")
        for item in stale.get("Items", []):
            ddb.delete_item(TableName=STATE_TABLE, Key={"PK": item["PK"], "SK": item["SK"]})
        title, level = roles[rid]
        item = {
            "PK": {"S": pk}, "SK": {"S": "SAGA"},
            "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#{now}#{cid}"},
            "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id}, "role_id": {"S": rid},
            "firstName": {"S": first}, "lastName": {"S": last},
            "email": {"S": f"pepla-demo-{first.lower()}.{last.lower()}@{MAIL_DOMAIN}"},
            "positionTitle": {"S": title}, "positionLevel": {"S": level}, "department": {"S": "Operations"},
            "currentStage": {"S": stage}, "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"},
            "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "appliedDate": {"S": now},
            "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
        }
        for k, v in extra.items():
            item[k] = {"S": v}
        ddb.put_item(TableName=STATE_TABLE, Item=item)
        written += 1
        if stage == "OFFER":
            ddb.put_item(TableName=STATE_TABLE, Item={
                "PK": {"S": pk}, "SK": {"S": "OFFER"}, "offerId": {"S": f"OFFER#{cid}"}, "candidateId": {"S": cid},
                "tenant_id": {"S": tenant_id}, "state": {"S": "OFFER_SENT"}, "positionLevel": {"S": level},
                "createdAt": {"S": now}, "updatedAt": {"S": now}, "seed": {"S": SEED_TAG},
            })
            written += 1
    return written


# TEN-04: the rows company A owns that the company B walk aims at. The ids are the ones in
# pepla-web/e2e/acceptance/support/ten-04/dev-ids.json; the word TEN04A is what the walk looks for in an answer.
# Written with put_item on every run, with A's company on each (Terraform never manages table data, and the seed must
# not wipe tenant_id: PR 374). A table pepla-dev does not have is skipped with a warning.
TEN04 = {
    "candidate": "CAND-01TEN04AAAAAAAAAAAAAAA1",
    "interview": "iv-ten04-a-0001",
    # A tile is not a stored row: its id is the candidate plus a rule, and the tile routes check the candidate is the caller's.
    "tile": "tile-CAND-01TEN04AAAAAAAAAAAAAAA1-RULE-SLA-002",
    "config": "cfg-ten04-a-0001",
    "itTask": "task-ten04-a-0001",
    "bundle": "bundle-ten04-a-0001",
    "notification": "NOTIF#2026-11-10T08:00:00.000Z#notif-ten04-a-0001",
    "action": "act-ten04-a-0001",
}


def seed_ten04_rows(ddb, tenant_id: str, tf_sub: str) -> int:
    now = "2026-11-10T08:00:00.000Z"
    cid = TEN04["candidate"]
    t = {"S": tenant_id}
    config_type = "TEN04A_" + TEN04["config"]
    rows = [
        ("talent-flow-state", {
            "PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": "SAGA"}, "GSI1PK": {"S": f"TENANT#{tenant_id}"},
            "GSI1SK": {"S": f"SAGA#{now}"}, "tenant_id": t, "candidateId": {"S": cid},
            "firstName": {"S": "TEN04A"}, "lastName": {"S": "Demo-Candidate"}, "email": {"S": "ten04a@example.com"},
            "phone": {"S": "0800000000"}, "positionTitle": {"S": "TEN04A Baker"}, "positionLevel": {"S": "JUNIOR"},
            "department": {"S": "Operations"}, "currentStage": {"S": "APPLICATION_REVIEW"},
            "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"}, "slaStatus": {"S": "ON_TRACK"},
            "appliedDate": {"S": now}, "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
        }),
        ("talent-flow-state", {
            "PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": f"INTERVIEW#{TEN04['interview']}"}, "tenant_id": t,
            "candidateId": {"S": cid}, "interviewId": {"S": TEN04["interview"]}, "interviewType": {"S": "HR_SCREEN"},
            "status": {"S": "SCHEDULED"}, "panelMemberIds": {"L": []}, "scheduledAt": {"S": "2026-12-01T09:00:00.000Z"},
            "notes": {"S": "TEN04A"}, "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
        }),
        ("talent-flow-state", {
            "PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": "OFFER"}, "tenant_id": t, "tenantId": t,
            "offerId": {"S": f"OFFER#{cid}"}, "candidateId": {"S": cid}, "state": {"S": "OFFER_CREATED"},
            "positionLevel": {"S": "JUNIOR"}, "role": {"S": "TEN04A Baker"}, "department": {"S": "Operations"},
            "approvalChain": {"L": []}, "currentApprovalStep": {"N": "0"}, "interactionLog": {"L": []},
            "createdAt": {"S": now}, "updatedAt": {"S": now},
        }),
        ("talent-flow-config", {
            "PK": {"S": f"TENANT#{tenant_id}"}, "SK": {"S": f"CONFIG#{config_type}#v1"},
            "GSI1PK": {"S": f"TENANT#{tenant_id}#ACTIVE"}, "GSI1SK": {"S": f"CONFIG#{config_type}"},
            "tenant_id": t, "configType": {"S": config_type}, "version": {"N": "1"},
            "isActive": {"BOOL": True}, "data": {"M": {"note": {"S": "TEN04A"}}}, "createdAt": {"S": now},
        }),
        ("it-tasks", {
            "taskId": {"S": TEN04["itTask"]}, "tenant_id": t, "candidateId": {"S": cid},
            "title": {"S": "TEN04A laptop"}, "status": {"S": "PENDING"}, "queue": {"S": "Hardware"},
            "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
        }),
        ("provisioning-bundles", {
            "bundleId": {"S": TEN04["bundle"]}, "tenant_id": t, "candidateId": {"S": cid},
            "candidateName": {"S": "TEN04A Demo-Candidate"}, "candidateRole": {"S": "Baker"},
            "startDate": {"S": "2026-12-01"}, "status": {"S": "DRAFT"}, "items": {"L": []},
            "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
        }),
        ("talent-flow-pending-actions", {
            "actionId": {"S": TEN04["action"]}, "tenant_id": t, "candidateId": {"S": cid},
            "status": {"S": "PENDING"}, "actionType": {"S": "TEN04A"}, "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
        }),
    ]
    if tf_sub:
        rows.append(("talent-flow-notifications", {
            "PK": {"S": f"USER#{tf_sub}"}, "SK": {"S": TEN04["notification"]}, "tenant_id": t,
            "title": {"S": "TEN04A"}, "read": {"BOOL": False}, "createdAt": {"S": now},
        }))
    written = 0
    for table, item in rows:
        try:
            ddb.put_item(TableName=table, Item=item)
            written += 1
        except ddb.exceptions.ResourceNotFoundException:
            print(f"warning: pepla-dev has no table {table}; a TEN-04 row was not written")
    return written


def remove_foreign_bundles(ddb, founding_tenant: str) -> int:
    """TEN-04.2: earlier walks left a bundle of another company that holds the founding company's seeded candidate.
    The route now refuses that, so such a row is stale test data. Found by a Query of the byCandidateId index (never a Scan),
    deleted by its own key, only while it still carries the same company and candidate (a changed row is left alone).
    Dev only: main() exits unless the account is pepla-dev, before anything runs. Counts only in the output."""
    removed = 0
    cid = TEN04["candidate"]
    kwargs = {
        "TableName": "provisioning-bundles", "IndexName": "byCandidateId",
        "KeyConditionExpression": "candidateId = :c", "FilterExpression": "tenant_id <> :f",
        "ExpressionAttributeValues": {":c": {"S": cid}, ":f": {"S": founding_tenant}},
    }
    while True:
        res = ddb.query(**kwargs)
        for item in res.get("Items", []):
            try:
                ddb.delete_item(
                    TableName="provisioning-bundles", Key={"bundleId": item["bundleId"]},
                    ConditionExpression="tenant_id = :t AND candidateId = :c",
                    ExpressionAttributeValues={":t": item["tenant_id"], ":c": {"S": cid}})
                removed += 1
            except ClientError as e:
                if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        if not res.get("LastEvaluatedKey"):
            return removed
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def reset_persona(ddb, tenant_id: str, employee_sub: str) -> tuple[int, int]:
    """The employee test login's own row, back to a clean start: stage INVITED, no documents, no accepted notice.
    The seed runs it once; the dev E2E workflow runs it again before the one test that needs the clean start
    (ONB-10 AC-8), because ONB-07 and ONB-08 upload and accept the persona's required documents earlier in the run."""
    ddb.put_item(TableName="employees", Item=employee_item(
        EMPLOYEE_ID, "Sipho", "Demo-Starter", login("employee"),
        "Operations", "New Starter", "INVITED", tenant_id=tenant_id, owner_sub=employee_sub))
    return reset_employee_documents(ddb, EMPLOYEE_ID), reset_employee_consents(ddb, EMPLOYEE_ID)


# ONB-22: the person and the documents the agent walk reads. The test person is a robot (test-domain email), so the
# summary and the risk check never reach the model. Company B has one waiting document of its own, for the 404 check.
ONB22_EMAIL = "onb22.agent.test@blackhole.postmarkapp.com"
ONB22_EMPLOYEE_ID = str(uuid.uuid5(NS, ONB22_EMAIL))
ONB22_DOCUMENT = "doc-onb22-0001"
ONB22_DOCUMENT_B = "doc-onb22-b-0001"


def seed_onb22(ddb, tenant_id: str) -> int:
    """A new person with one bank letter waiting for HR whose check is Matches, and company B's own waiting document."""
    written = 0
    for tid, eid, email, doc_id, first in ((tenant_id, ONB22_EMPLOYEE_ID, ONB22_EMAIL, ONB22_DOCUMENT, "Agent"),
                                           (SECOND_TENANT_ID, str(uuid.uuid5(NS, "onb22.b.test@blackhole.postmarkapp.com")),
                                            "onb22.b.test@blackhole.postmarkapp.com", ONB22_DOCUMENT_B, "Other")):
        ddb.put_item(TableName="employees", Item=employee_item(eid, first, "Walk-Test", email, "Operations", "New Starter", "ACTIVE", tenant_id=tid))
        reset_employee_documents(ddb, eid)
        vid = str(uuid.uuid5(NS, f"verification:{doc_id}"))
        ddb.put_item(TableName="document-verification", Item={
            "verificationId": {"S": vid}, "employeeId": {"S": eid}, "documentId": {"S": doc_id},
            "documentType": {"S": "BANK_CONFIRMATION"}, "confidence": {"N": "96"}, "decision": {"S": "MANUAL_REVIEW"},
            "check": {"S": "MATCHES"}, "createdAt": {"S": "2026-11-17T08:00:00Z"}, "seed": {"S": SEED_TAG}, "tenant_id": {"S": tid},
        })
        ddb.put_item(TableName="documents", Item={
            "employee_id": {"S": eid}, "document_id": {"S": doc_id}, "document_type": {"S": "BANK_CONFIRMATION"},
            "file_name": {"S": "bank_confirmation.pdf"}, "s3_key": {"S": sample_key(eid, doc_id)},
            "upload_timestamp": {"S": "2026-11-17T08:00:00Z"}, "ocr_status": {"S": "MANUAL_REVIEW"},
            "verification_id": {"S": vid}, "seed": {"S": SEED_TAG}, "tenant_id": {"S": tid},
        })
        written += 2
    return written


def seed_rec07(ddb, tenant_id: str, panel_subs: tuple, manager_sub: str) -> int:
    """REC-07: put the scoring interview, its guest link and company B's forged link back every run (cards/rec-07.md, "REC-07 dev seed").

    Votes the last run left are removed, the link is unused again, so the dev check can score each time. Idempotent.
    """
    ids = json.loads((pathlib.Path(__file__).resolve().parents[2] / "pepla-web" / "e2e" / "acceptance" / "support" / "rec-07" / "dev-ids.json").read_text())
    if not manager_sub or len(panel_subs) < 2 or not all(panel_subs):
        print("warning: the manager or a panel login has no sub; the REC-07 rows were not written")
        return 0
    now = "2026-11-10T08:00:00.000Z"
    expires = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 7 * 86400))
    ttl = int(time.time()) + 7 * 86400
    criteria = {"L": [{"M": {"key": {"S": k}, "label": {"S": label}}} for k, label in REC04_CRITERIA]}
    written = 0

    # The list is read oldest first, so the later date in GSI1SK puts these candidates last: REC-01 AC-9 takes the first candidate that is not the manager's.
    def candidate(cid: str, tid: str, first: str, last: str, iv_id: str, panel: list, hm: str) -> None:
        pk = f"CANDIDATE#{cid}"
        stale = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
                          ExpressionAttributeValues={":pk": {"S": pk}, ":p": {"S": "VOTE#"}}, ProjectionExpression="PK, SK")
        for item in stale.get("Items", []):
            ddb.delete_item(TableName=STATE_TABLE, Key={"PK": item["PK"], "SK": item["SK"]})
        ddb.put_item(TableName=STATE_TABLE, Item={
            "PK": {"S": pk}, "SK": {"S": "SAGA"},
            "GSI1PK": {"S": f"TENANT#{tid}"}, "GSI1SK": {"S": f"SAGA#2026-12-31T00:00:00.000Z#{cid}"},
            "candidateId": {"S": cid}, "tenant_id": {"S": tid},
            "firstName": {"S": first}, "lastName": {"S": last},
            "email": {"S": f"pepla-demo-{first.lower()}.{last.lower()}@{MAIL_DOMAIN}"},
            "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "department": {"S": "Operations"},
            "currentStage": {"S": "INTERVIEW"}, "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"},
            "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "appliedDate": {"S": now},
            "hiringManagerId": {"S": hm}, "seed": {"S": SEED_TAG},
        })
        ddb.put_item(TableName=STATE_TABLE, Item={
            "PK": {"S": pk}, "SK": {"S": f"INTERVIEW#{iv_id}"},
            "interviewId": {"S": iv_id}, "candidateId": {"S": cid}, "tenant_id": {"S": tid},
            "interviewType": {"S": "HR_SCREEN"}, "status": {"S": "SCHEDULED"}, "scheduledAt": {"S": "2026-11-20T09:00:00.000Z"},
            "votesRequired": {"N": str(len(panel))}, "votesSubmitted": {"N": "0"},
            "panelMemberIds": {"L": [{"S": p} for p in panel]}, "criteria_snapshot": criteria,
            "PANEL_FEEDBACK_PENDING_COUNT": {"N": str(len(panel))}, "PANEL_SPLIT_FLAG": {"BOOL": False},
            "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
        })

    def link(token: str, link_tid: str, cid: str, iv_id: str) -> None:
        h = hashlib.sha256(token.encode()).hexdigest()
        ddb.put_item(TableName=STATE_TABLE, Item={
            "PK": {"S": f"SCORING_LINK#{h}"}, "SK": {"S": "META"}, "token_hash": {"S": h}, "tenant_id": {"S": link_tid},
            "interview_id": {"S": iv_id}, "candidate_id": {"S": cid}, "guest_email": {"S": f"pepla-demo-guest@{MAIL_DOMAIN}"},
            "expires_at": {"S": expires}, "used_at": {"NULL": True}, "created_at": {"S": now}, "ttl": {"N": str(ttl)}, "seed": {"S": SEED_TAG},
        })

    # REC-01 AC-9 (locked) says the manager login lists exactly one candidate, the one it is hiring for, so this candidate belongs to the
    # other hiring manager. The manager login sits on the panel as a third member so it can still open the sheet (it sees its own vote only).
    candidate(ids["candidate"], tenant_id, "Rec", "Seed-Score", ids["interview"], list(panel_subs[:2]) + [manager_sub], OTHER_HIRING_MANAGER)
    link(ids["guestToken"], tenant_id, ids["candidate"], ids["interview"])
    written += 3
    # REC-15 step D (lock check F-1): one history row by a company A login, so the dev check sees a name in the history. The row carries
    # company A's tenant_id (the history read drops a row that does not), and `by` is the IT login's sub. That login has no Member row of its own, so its name comes through the legacy-company rule (LEGACY_TENANT_ID on getCandidateEvents is company A on dev).
    stale = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
                      ExpressionAttributeValues={":pk": {"S": f"CANDIDATE#{ids['candidate']}"}, ":p": {"S": "STAGE#"}}, ProjectionExpression="PK, SK")
    for item in stale.get("Items", []):
        ddb.delete_item(TableName=STATE_TABLE, Key={"PK": item["PK"], "SK": item["SK"]})
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": f"CANDIDATE#{ids['candidate']}"}, "SK": {"S": f"STAGE#{now}#INTERVIEW"},
        "candidateId": {"S": ids["candidate"]}, "tenant_id": {"S": tenant_id}, "from": {"S": "APPLIED"}, "to": {"S": "INTERVIEW"},
        "by": {"S": panel_subs[1]}, "by_kind": {"S": "PERSON"}, "at": {"S": now}, "recordType": {"S": "STAGE_HISTORY"}, "seed": {"S": SEED_TAG},
    })
    written += 1
    # Company B's candidate and interview, and a link row that names company A for B's interview (the dev form of AC-7's forged row).
    b_candidate, b_interview = "CAND-REC07DEVBBBBBBBBBBBBBB1", "iv-rec07-dev-b-1"
    candidate(b_candidate, SECOND_TENANT_ID, "Rec", "Seed-ScoreB", b_interview, [OTHER_HIRING_MANAGER], OTHER_HIRING_MANAGER)
    link(ids["crossCompanyToken"], tenant_id, b_candidate, b_interview)
    return written + 3


def seed_int01(ddb, tenant_id: str, panel_subs: tuple) -> int:
    """INT-01: the dev candidate, a past interview booked the new way (two panel logins and a guest link in the R-21 format) and a
    future one. Everything the last run left on the candidate is removed first, so each run starts the same. Idempotent."""
    ids = json.loads((pathlib.Path(__file__).resolve().parents[2] / "pepla-web" / "e2e" / "acceptance" / "support" / "int-01" / "dev-ids.json").read_text())
    if len(panel_subs) < 2 or not all(panel_subs):
        print("warning: a panel login has no sub; the INT-01 rows were not written")
        return 0
    cid = ids["candidate"]
    pk = f"CANDIDATE#{cid}"
    now_s = time.time()
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))
    past_at, future_at = iso(now_s - 3600), iso(now_s + 3 * 86400)
    expires = iso(now_s - 3600 + 7 * 86400)
    old = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk", ExpressionAttributeValues={":pk": {"S": pk}}, ProjectionExpression="PK, SK")
    for item in old.get("Items", []):
        ddb.delete_item(TableName=STATE_TABLE, Key={"PK": item["PK"], "SK": item["SK"]})
    stamp = iso(now_s - 86400)
    criteria = {"L": [{"M": {"key": {"S": k}, "label": {"S": label}}} for k, label in REC04_CRITERIA]}
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": pk}, "SK": {"S": "SAGA"},
        "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#2026-12-31T00:00:00.000Z#{cid}"},
        "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id}, "firstName": {"S": "Int"}, "lastName": {"S": "Seed-Interview"},
        "email": {"S": f"pepla-demo-int.seed-interview@{MAIL_DOMAIN}"},
        "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "department": {"S": "Operations"},
        "currentStage": {"S": "INTERVIEW"}, "stageEnteredAt": {"S": stamp}, "status": {"S": "ACTIVE"},
        "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": stamp}, "appliedDate": {"S": stamp},
        "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
    })
    token_hash = hashlib.sha256(ids["guestToken"].encode()).hexdigest()

    def interview(iv_id: str, kind: str, at: str, guest: bool) -> None:
        item = {
            "PK": {"S": pk}, "SK": {"S": f"INTERVIEW#{iv_id}"}, "interviewId": {"S": iv_id}, "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id},
            "interviewType": {"S": kind}, "status": {"S": "SCHEDULED"}, "scheduledAt": {"S": at}, "length_minutes": {"N": "60"},
            "where": {"S": "ONLINE"}, "video_link": {"S": "https://meet.example.test/int-01-seed"}, "sequence": {"N": "1"},
            "booked_by": {"S": panel_subs[0]}, "booked_at": {"S": stamp}, "votesSubmitted": {"N": "0"},
            "panelMemberIds": {"L": [{"S": p} for p in panel_subs[:2]]}, "criteria_snapshot": criteria, "createdAt": {"S": stamp}, "seed": {"S": SEED_TAG},
        }
        if guest:
            item["guest_link_hash"] = {"S": token_hash}
        ddb.put_item(TableName=STATE_TABLE, Item=item)

    interview(ids["pastInterview"], "HR_SCREEN", past_at, True)
    interview(ids["futureInterview"], "FINAL", future_at, False)
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": f"SCORING_LINK#{token_hash}"}, "SK": {"S": "META"}, "token_hash": {"S": token_hash}, "tenant_id": {"S": tenant_id},
        "interview_id": {"S": ids["pastInterview"]}, "candidate_id": {"S": cid}, "guest_email": {"S": f"pepla-demo-guest@{MAIL_DOMAIN}"},
        "expires_at": {"S": expires}, "used_at": {"NULL": True}, "created_at": {"S": stamp}, "ttl": {"N": str(int(now_s) + 8 * 86400)}, "seed": {"S": SEED_TAG},
    })
    return 4


def seed_rec05(ddb, tenant_id: str, hr_sub: str) -> int:
    """REC-05: put the offer rows back every run (cards/rec-05.md, "REC-05 dev seed"). Idempotent."""
    ids = json.loads((pathlib.Path(__file__).resolve().parents[2] / "pepla-web" / "e2e" / "acceptance" / "support" / "rec-05" / "dev-ids.json").read_text())
    if not hr_sub:
        print("warning: the HR login has no sub; the REC-05 rows were not written")
        return 0
    now = "2026-11-20T08:00:00.000Z"
    for cid, first in ((ids["candidate"], "Seed-Offer"), (ids["draftCandidate"], "Seed-Draft")):
        ddb.put_item(TableName=STATE_TABLE, Item={
            "PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": "SAGA"}, "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#2026-12-31T00:00:00.000Z#{cid}"},
            "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id}, "firstName": {"S": "Rec"}, "lastName": {"S": first},
            "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "currentStage": {"S": "OFFER"}, "stageEnteredAt": {"S": now},
            "status": {"S": "ACTIVE"}, "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
        })
    # If the dev test stops before its last withdraw, this lock stays and every later run gets 409 OFFER_EXISTS. Clear it each run.
    ddb.delete_item(TableName=STATE_TABLE, Key={"PK": {"S": f"TENANT#{tenant_id}#OFFER_LIVE#{ids['candidate']}"}, "SK": {"S": "LOCK"}})
    oid = ids["draftOffer"]
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": f"OFFER#{oid}"}, "SK": {"S": "OFFER"}, "offer_id": {"S": oid}, "tenant_id": {"S": tenant_id}, "candidate_id": {"S": ids["draftCandidate"]},
        "candidate_name": {"S": "Rec Seed-Draft"}, "role_title": {"S": "Demo role"}, "department": {"S": "Operations"}, "state": {"S": "DRAFT"}, "version": {"N": "1"},
        "salary": {"N": "350000"}, "currency": {"S": "ZAR"}, "start_date": {"S": ids["startDate"]}, "expiry_date": {"S": ids["expiryDate"]},
        "drafted_by": {"S": hr_sub}, "drafted_by_name": {"S": "Thandi Demo-HR"}, "created_at": {"S": now}, "updated_at": {"S": now},
        "approval_history": {"L": []}, "history": {"L": []}, "GSI2PK": {"S": f"TENANT#{tenant_id}#OFFER"}, "GSI2SK": {"S": f"{now}#{oid}"}, "seed": {"S": SEED_TAG},
    })
    ddb.put_item(TableName=STATE_TABLE, Item={"PK": {"S": f"TENANT#{tenant_id}#OFFER_LIVE#{ids['draftCandidate']}"}, "SK": {"S": "LOCK"},
                                               "tenant_id": {"S": tenant_id}, "live_offer_id": {"S": oid}})
    return 4


def seed_rec06(ddb, tenant_id: str) -> int:
    """REC-06: put both conversion offers back to SENT each run and remove the employee the last run made (cards/rec-06.md, "Seed and clean-up").

    Both candidates use robot addresses (blackhole.postmarkapp.com), so even a later "send the invite again" can never email a real person. The
    ids are known, so only those employee rows are deleted, each on condition of the company. The rehire pair's employee is written again each run.
    """
    ids = json.loads((pathlib.Path(__file__).resolve().parents[2] / "pepla-web" / "e2e" / "acceptance" / "support" / "rec-06" / "dev-ids.json").read_text())
    now = "2026-11-20T08:00:00.000Z"
    namespace = uuid.UUID("6b7dcfde-d603-4673-9949-d5d39ac59e17")
    written = 0
    for cid, oid, email, first in ((ids["candidate"], ids["offer"], ids["email"], "Hire"), (ids["rehireCandidate"], ids["rehireOffer"], ids["rehireEmail"], "Rehire")):
        eid = str(uuid.uuid5(namespace, f"{tenant_id}:{oid}"))
        try:
            ddb.delete_item(TableName="employees", Key={"employee_id": {"S": eid}}, ConditionExpression="tenant_id = :t",
                            ExpressionAttributeValues={":t": {"S": tenant_id}})
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
        ddb.put_item(TableName=STATE_TABLE, Item={
            "PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": "SAGA"}, "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#2026-12-31T00:00:00.000Z#{cid}"},
            "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id}, "firstName": {"S": "Rec06"}, "lastName": {"S": f"Seed-{first}"}, "email": {"S": email},
            "phone": {"S": "0800000000"}, "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "department": {"S": "Operations"},
            "currentStage": {"S": "OFFER"}, "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"}, "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now},
            "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
        })
        ddb.put_item(TableName=STATE_TABLE, Item={
            "PK": {"S": f"OFFER#{oid}"}, "SK": {"S": "OFFER"}, "offer_id": {"S": oid}, "tenant_id": {"S": tenant_id}, "candidate_id": {"S": cid},
            "candidate_name": {"S": f"Rec06 Seed-{first}"}, "role_title": {"S": "Demo role"}, "department": {"S": "Operations"}, "state": {"S": "SENT"}, "version": {"N": "1"},
            "salary": {"N": "350000"}, "currency": {"S": "ZAR"}, "start_date": {"S": ids["startDate"]}, "expiry_date": {"S": "2030-01-15"},
            "drafted_by": {"S": "seed-drafter"}, "drafted_by_name": {"S": "Thandi Demo-HR"}, "created_at": {"S": now}, "updated_at": {"S": now}, "sent_at": {"S": now},
            "approval_history": {"L": []}, "history": {"L": []}, "GSI2PK": {"S": f"TENANT#{tenant_id}#OFFER"}, "GSI2SK": {"S": f"{now}#{oid}"}, "seed": {"S": SEED_TAG},
        })
        ddb.put_item(TableName=STATE_TABLE, Item={"PK": {"S": f"TENANT#{tenant_id}#OFFER_LIVE#{cid}"}, "SK": {"S": "LOCK"},
                                                   "tenant_id": {"S": tenant_id}, "live_offer_id": {"S": oid}})
        written += 3
    # The rehire pair: the candidate's address belongs to an employee of the company already.
    ddb.put_item(TableName="employees", Item=employee_item(ids["rehireEmployee"], "Rec06", "Seed-Rehire-Employee", ids["rehireEmail"], "Operations", "Clerk", "ACTIVE", tenant_id=tenant_id))
    return written + 1


def seed_recui04(ddb, tenant_id: str) -> int:
    """REC-UI-04.2: put back the candidate the offer screens' dev walk drafts an offer for (cards/rec-ui-04.2.md, "REC-UI-04.2 dev seed").

    One company A candidate in Offer with no role (a REC-04 role would be cleared by reset-dev-rec04.py and add to REC-04 AC-10's count),
    the other hiring manager, and the seed tag. Its live-offer lock and every offer row of this candidate are from earlier runs, so they
    are deleted, and the Offers list does not grow by a row per run. The offer rows are found with a filtered Scan, not the GSI2 index:
    the seed-run fakes of the locked rec-04 and rec-14 tests refuse any index read. Not on reset-dev-rec04.py's list. Idempotent.
    """
    ids = json.loads((pathlib.Path(__file__).resolve().parents[2] / "pepla-web" / "e2e" / "acceptance" / "support" / "rec-ui-04" / "dev-ids.json").read_text())
    cid = ids["candidate"]
    now = "2026-11-26T08:00:00.000Z"
    old = []
    for page in ddb.get_paginator("scan").paginate(
            TableName=STATE_TABLE, FilterExpression="begins_with(PK, :p) AND candidate_id = :c AND tenant_id = :t",
            ExpressionAttributeValues={":p": {"S": "OFFER#"}, ":c": {"S": cid}, ":t": {"S": tenant_id}}, ProjectionExpression="PK, SK, candidate_id, tenant_id"):
        old += [it for it in page.get("Items", []) if it.get("PK", {}).get("S", "").startswith("OFFER#")
                and it.get("candidate_id", {}).get("S") == cid and it.get("tenant_id", {}).get("S") == tenant_id]
    for it in old:
        ddb.delete_item(TableName=STATE_TABLE, Key={"PK": it["PK"], "SK": it["SK"]})
    ddb.delete_item(TableName=STATE_TABLE, Key={"PK": {"S": f"TENANT#{tenant_id}#OFFER_LIVE#{cid}"}, "SK": {"S": "LOCK"}})
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": f"CANDIDATE#{cid}"}, "SK": {"S": "SAGA"}, "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#{now}#{cid}"},
        "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id}, "firstName": {"S": ids["firstName"]}, "lastName": {"S": ids["lastName"]},
        "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "currentStage": {"S": "OFFER"}, "stageEnteredAt": {"S": now},
        "status": {"S": "ACTIVE"}, "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
    })
    return 1 + len(old)


def seed_int03(ddb, tenant_id: str) -> int:
    """INT-03: put the old-path scoring link the dev check votes through back every run (INT-03.md AC-4).

    One throwaway candidate with a fixed id: its SAGA row (with the active SCORING_WEIGHTS version), one interview that needs 99 votes
    (so one vote never reaches a quorum and nothing publishes VotingCompleted), and the old-path link rows, unused. The votes the last
    run left are deleted. Not on reset-dev-rec04.py's list (it runs before the main run). Idempotent.
    """
    ids = json.loads((pathlib.Path(__file__).resolve().parents[2] / "pepla-web" / "e2e" / "acceptance" / "support" / "int-03" / "dev-ids.json").read_text())
    cid, iv_id, token, pm = ids["candidate"], ids["interview"], ids["token"], ids["panelMember"]
    now = "2026-11-10T08:00:00.000Z"
    ttl = int(time.time()) + 7 * 86400
    expires = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ttl))
    pk = f"CANDIDATE#{cid}"
    stale = ddb.query(TableName=STATE_TABLE, KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
                      ExpressionAttributeValues={":pk": {"S": pk}, ":p": {"S": "VOTE#"}}, ProjectionExpression="PK, SK")
    for item in stale.get("Items", []):
        ddb.delete_item(TableName=STATE_TABLE, Key={"PK": item["PK"], "SK": item["SK"]})
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": pk}, "SK": {"S": "SAGA"},
        "GSI1PK": {"S": f"TENANT#{tenant_id}"}, "GSI1SK": {"S": f"SAGA#{now}#{cid}"},
        "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id},
        "firstName": {"S": "Int"}, "lastName": {"S": "Seed-Token"},
        "email": {"S": f"pepla-demo-int.seed-token@{MAIL_DOMAIN}"},
        "positionTitle": {"S": "Demo role"}, "positionLevel": {"S": "MID"}, "department": {"S": "Operations"},
        "currentStage": {"S": "INTERVIEW"}, "stageEnteredAt": {"S": now}, "status": {"S": "ACTIVE"},
        "slaStatus": {"S": "ON_TRACK"}, "createdAt": {"S": now}, "appliedDate": {"S": now},
        "configVersion": {"S": active_config_version(ddb, tenant_id, "SCORING_WEIGHTS")},
        "votesSubmitted": {"N": "0"},
        "hiringManagerId": {"S": OTHER_HIRING_MANAGER}, "seed": {"S": SEED_TAG},
    })
    ddb.put_item(TableName=STATE_TABLE, Item={
        "PK": {"S": pk}, "SK": {"S": f"INTERVIEW#{iv_id}"},
        "interviewId": {"S": iv_id}, "candidateId": {"S": cid}, "tenant_id": {"S": tenant_id},
        "interviewType": {"S": "HR_SCREEN"}, "status": {"S": "SCHEDULED"}, "scheduledAt": {"S": "2026-11-20T09:00:00.000Z"},
        "votesRequired": {"N": "99"}, "votesSubmitted": {"N": "0"},
        "createdAt": {"S": now}, "seed": {"S": SEED_TAG},
    })
    link = {
        "token": {"S": token}, "candidateId": {"S": cid}, "tenantId": {"S": tenant_id}, "tenant_id": {"S": tenant_id},
        "panelMemberId": {"S": pm}, "panelMemberEmail": {"S": f"pepla-demo-guest@{MAIL_DOMAIN}"},
        "panelMemberName": {"S": "Int Seed Guest"}, "panelMemberRole": {"S": "Guest"}, "interviewId": {"S": iv_id},
        "createdBy": {"S": "seed-dev"}, "createdAt": {"S": now}, "expiresAt": {"S": expires}, "ttl": {"N": str(ttl)},
        "used": {"BOOL": False}, "seed": {"S": SEED_TAG},
    }
    ddb.put_item(TableName=STATE_TABLE, Item={"PK": {"S": f"SCORING_LINK#{token}"}, "SK": {"S": "META"}, **link})
    ddb.put_item(TableName=STATE_TABLE, Item={"PK": {"S": pk}, "SK": {"S": f"SCORING_LINK#{token}"}, **link})
    return 4


def main() -> None:
    account = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
    if account != DEV_ACCOUNT:
        sys.exit("::error::seed-dev only runs in pepla-dev")

    cognito = boto3.client("cognito-idp", region_name=REGION)
    sm = boto3.client("secretsmanager", region_name=REGION)
    ddb = boto3.client("dynamodb", region_name=REGION)

    naleko = pool_id(cognito, NALEKO_POOL)
    tf = pool_id(cognito, TF_POOL)
    wanted = {g for p in NALEKO_PERSONAS.values() for g in p["groups"]} | {ROBOT_GROUP}
    have = {g["GroupName"] for page in cognito.get_paginator("list_groups").paginate(UserPoolId=naleko)
            for g in page["Groups"]}
    not_yet = sorted((wanted & TEN05_GROUPS) - have)
    if not_yet:
        print(f"warning: pepla-dev does not have {', '.join(not_yet)} yet (Terraform adds them); logins are seeded without them")
    require_groups(cognito, naleko, sorted(wanted - set(not_yet)))
    made_groups = ensure_groups(cognito, tf, [ROBOT_GROUP])

    for role, p in NALEKO_PERSONAS.items():
        ensure_user(cognito, naleko, role, secret_password(sm, role), p["attrs"],
                    [g for g in p["groups"] if g not in not_yet] + [ROBOT_GROUP])
    for group in TF_GROUPS:
        role = f"tf-{group.lower()}"
        ensure_user(cognito, tf, role, secret_password(sm, role), {}, [group, ROBOT_GROUP])

    founding_written = ensure_founding_company(ddb)
    manager_member_sub = user_sub(cognito, naleko, "manager")
    if manager_member_sub:
        founding_written += ensure_founding_member(ddb, manager_member_sub)
    approver_member_sub = user_sub(cognito, naleko, "approver")
    if approver_member_sub:
        founding_written += ensure_founding_member(ddb, approver_member_sub)
    else:
        print("warning: the approver login has no sub; its Member row was not written")
    hr_b_sub = user_sub(cognito, naleko, "hr-b")
    if not hr_b_sub:
        print("warning: the company B login has no sub; its Member row was not written")
    second_written = ensure_second_company(ddb, hr_b_sub) if hr_b_sub else 0
    walk_subs = tuple(sub for sub in (user_sub(cognito, naleko, r) for r in ("hr-c", "tf-b", "it-b")) if sub)
    walk_written = ensure_walk_company(ddb, walk_subs)
    modules_set = set_dev_modules(ddb)
    departments_written = seed_departments(ddb)
    ten04_written = seed_ten04_rows(ddb, founding_tenant_id(), user_sub(cognito, naleko, "tf"))
    try:
        foreign_bundles_removed = remove_foreign_bundles(ddb, founding_tenant_id())
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the provisioning bundles table is not there; stale bundles were not looked for")
        foreign_bundles_removed = 0

    tid = founding_tenant_id()
    employee_sub = user_sub(cognito, naleko, "employee")
    ns = NS
    seeded_documents = 0
    for first, last, dept, title, stage in DEMO_PEOPLE:
        email = f"pepla-demo-{first.lower()}.{last.lower().replace(' ', '')}@{MAIL_DOMAIN}"
        eid = str(uuid.uuid5(ns, email))
        ddb.put_item(TableName="employees",
                     Item=employee_item(eid, first, last, email, dept, title, stage, tenant_id=tid,
                                        start_date=START_DATES.get((first, last), "2026-12-01")))
        if (first, last) == ("Naledi", "Dlamini"):
            seeded_documents = seed_documents(ddb, ns, eid, tid)

    onb22_written = seed_onb22(ddb, tid)

    try:
        seeded_candidates = seed_candidates(ddb, tid, user_sub(cognito, naleko, "manager"), employee_sub)
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the seeded candidates were not written")
        seeded_candidates = 0

    try:
        rec02_written = seed_rec02(ddb, tid, user_sub(cognito, naleko, "manager"), employee_sub)
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the REC-02 candidate was not written")
        rec02_written = 0

    try:
        rec03_written = seed_rec03(ddb, tid, user_sub(cognito, naleko, "manager"))
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the REC-03 candidates were not written")
        rec03_written = 0

    try:
        rec04_written = seed_rec04(ddb, tid, user_sub(cognito, naleko, "manager"))
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow roles table is not there yet; the REC-04 roles were not written")
        rec04_written = 0

    try:
        rec07_written = seed_rec07(ddb, tid, (employee_sub, user_sub(cognito, naleko, "it")), user_sub(cognito, naleko, "manager"))
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the REC-07 rows were not written")
        rec07_written = 0

    try:
        seed_int01(ddb, tid, (employee_sub, user_sub(cognito, naleko, "it")))
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the INT-01 rows were not written")

    try:
        seed_int03(ddb, tid)
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the INT-03 rows were not written")

    try:
        rec05_written = seed_rec05(ddb, tid, user_sub(cognito, naleko, "hr"))
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the REC-05 rows were not written")
        rec05_written = 0

    try:
        seed_rec06(ddb, tid)
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the REC-06 rows were not written")

    try:
        seed_recui04(ddb, tid)
    except ddb.exceptions.ResourceNotFoundException:
        print("warning: the TalentFlow state table is not there; the REC-UI-04.2 candidate was not written")

    docs_removed, consents_removed = reset_persona(ddb, tid, employee_sub)

    print(f"seed-dev: groups created {made_groups}; "
          f"logins {len(NALEKO_PERSONAS) + len(TF_GROUPS)}; "
          f"demo people {len(DEMO_PEOPLE) + 1}; persona documents reset {docs_removed}; "
          f"persona consents reset {consents_removed}; "
          f"demo documents {seeded_documents}; founding company row written {founding_written}; "
          f"second company rows written {second_written}; company modules set {modules_set}; "
          f"walk company rows written {walk_written}; department lists changed {departments_written}; TEN-04 walk rows written {ten04_written}; "
          f"agent walk rows written {onb22_written}; "
          f"stale bundles of another company removed {foreign_bundles_removed}; "
          f"recruitment rows seeded {seeded_candidates}; REC-02 rows seeded {rec02_written}; REC-03 rows seeded {rec03_written}; REC-04 rows seeded {rec04_written}; REC-07 rows seeded {rec07_written}")


if __name__ == "__main__":
    main()
