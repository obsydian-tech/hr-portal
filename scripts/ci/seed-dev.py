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
Output is role names and counts only: the repo and its Actions logs are public.
"""
import json
import pathlib
import re
import secrets
import string
import sys
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
    # TEN-04: the company walk. tf holds every TalentFlow role and tick in company A; tf-b and it-b are company B's
    # callers (each holds the roles, so a 404 proves the row is hidden, not that the role is missing). victim is a
    # company A user nobody signs in as: the admin user routes need one to aim at.
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
                  title: str, stage: str, tenant_id: str = "", owner_sub: str = "") -> dict:
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
        "planned_start_date": {"S": "2026-12-01"},
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
    """Replace the person's documents with the fixed set. Verification rows carry no extracted data."""
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


# TEN-02: the second company. Fixed id, so every run finds the same rows.
SECOND_TENANT_ID = "ten_b2e2ec0mpanyb00000000000da"


def ensure_second_company(ddb, hr_b_sub: str, other_b_subs: tuple = ()) -> int:
    """The second company's row and its HR login's Member row. Each is written once; an existing row stays as it is."""
    written = 0
    items = [
        {"pk": {"S": f"TENANT#{SECOND_TENANT_ID}"}, "sk": {"S": "PROFILE"}, "tenant_id": {"S": SECOND_TENANT_ID},
         "name": {"S": "Company B (demo)"}, "status": {"S": "ACTIVE"}, "country": {"S": "ZA"},
         "created_at": {"S": "2026-11-17T00:00:00Z"}},
        {"pk": {"S": f"USER#{hr_b_sub}"}, "sk": {"S": f"TENANT#{SECOND_TENANT_ID}"}, "tenant_id": {"S": SECOND_TENANT_ID},
         "created_at": {"S": "2026-11-17T00:00:00Z"}},
    ]
    # TEN-04: the other company B logins (tf-b, it-b) get a Member row the same way.
    for sub in other_b_subs:
        items.append({"pk": {"S": f"USER#{sub}"}, "sk": {"S": f"TENANT#{SECOND_TENANT_ID}"}, "tenant_id": {"S": SECOND_TENANT_ID},
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
DEV_MODULES = {"founding": ["onboarding", "recruitment"], "second": ["onboarding"]}


def set_dev_modules(ddb) -> int:
    changed = 0
    for tid, keys in ((founding_tenant_id(), DEV_MODULES["founding"]), (SECOND_TENANT_ID, DEV_MODULES["second"])):
        try:
            ddb.update_item(TableName=TENANTS_TABLE, Key={"pk": {"S": f"TENANT#{tid}"}, "sk": {"S": "PROFILE"}},
                            UpdateExpression="SET #m = :m", ConditionExpression="attribute_exists(pk)",
                            ExpressionAttributeNames={"#m": "modules"}, ExpressionAttributeValues={":m": {"SS": keys}})
            changed += 1
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
    return changed


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
    hr_b_sub = user_sub(cognito, naleko, "hr-b")
    if not hr_b_sub:
        print("warning: the company B login has no sub; its Member row was not written")
    other_b_subs = tuple(sub for sub in (user_sub(cognito, naleko, "tf-b"), user_sub(cognito, naleko, "it-b")) if sub)
    second_written = ensure_second_company(ddb, hr_b_sub, other_b_subs) if hr_b_sub else 0
    modules_set = set_dev_modules(ddb)
    ten04_written = seed_ten04_rows(ddb, founding_tenant_id(), user_sub(cognito, naleko, "tf"))

    tid = founding_tenant_id()
    employee_sub = user_sub(cognito, naleko, "employee")
    ns = NS
    seeded_documents = 0
    for first, last, dept, title, stage in DEMO_PEOPLE:
        email = f"pepla-demo-{first.lower()}.{last.lower().replace(' ', '')}@{MAIL_DOMAIN}"
        eid = str(uuid.uuid5(ns, email))
        ddb.put_item(TableName="employees",
                     Item=employee_item(eid, first, last, email, dept, title, stage, tenant_id=tid))
        if (first, last) == ("Naledi", "Dlamini"):
            seeded_documents = seed_documents(ddb, ns, eid, tid)

    ddb.put_item(TableName="employees", Item=employee_item(
        EMPLOYEE_ID, "Sipho", "Demo-Starter", login("employee"),
        "Operations", "New Starter", "INVITED", tenant_id=tid, owner_sub=employee_sub))
    docs_removed = reset_employee_documents(ddb, EMPLOYEE_ID)
    consents_removed = reset_employee_consents(ddb, EMPLOYEE_ID)

    print(f"seed-dev: groups created {made_groups}; "
          f"logins {len(NALEKO_PERSONAS) + len(TF_GROUPS)}; "
          f"demo people {len(DEMO_PEOPLE) + 1}; persona documents reset {docs_removed}; "
          f"persona consents reset {consents_removed}; "
          f"demo documents {seeded_documents}; founding company row written {founding_written}; "
          f"second company rows written {second_written}; company modules set {modules_set}; "
          f"TEN-04 walk rows written {ten04_written}")


if __name__ == "__main__":
    main()
