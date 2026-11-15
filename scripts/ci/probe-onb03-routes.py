#!/usr/bin/env python3
"""Diagnostic for ONB-03 on pepla-dev: what the two HR-only routes answer.
Signs in the HR test login, calls GET /v1/hr-partners and GET /v1/employees/email-check,
and asks the CORS preflight for both. Prints status codes, CORS headers and body shapes
only (no names or addresses: the repo is public). Refuses to run outside pepla-dev."""
import base64, json, os, sys, urllib.error, urllib.request
import boto3

DEV, REGION = "424556617428", "af-south-1"


def call(method, url, headers):
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()


def shape(text):
    try:
        data = json.loads(text)
    except Exception:
        return f"not json, {len(text)} bytes"
    if isinstance(data, dict):
        keys = {k: (len(v) if isinstance(v, list) else v if k in ("inUse", "error", "message") else "...") for k, v in data.items()}
        return json.dumps(keys)
    return f"{type(data).__name__}"


def main():
    if boto3.client("sts", region_name=REGION).get_caller_identity()["Account"] != DEV:
        sys.exit("only pepla-dev")
    cognito = boto3.client("cognito-idp", region_name=REGION)
    pool = [p["Id"] for pg in cognito.get_paginator("list_user_pools").paginate(MaxResults=60) for p in pg["UserPools"] if p["Name"] == "naleko-dev-user-pool"][0]
    client = [c["ClientId"] for pg in cognito.get_paginator("list_user_pool_clients").paginate(UserPoolId=pool, MaxResults=60) for c in pg["UserPoolClients"] if c["ClientName"] == "pepla-web-dev"][0]
    api = [a["ApiEndpoint"] for a in boto3.client("apigatewayv2", region_name=REGION).get_apis()["Items"] if a["Name"] == "employees"][0]
    tok = cognito.initiate_auth(ClientId=client, AuthFlow="USER_PASSWORD_AUTH", AuthParameters={"USERNAME": os.environ["E2E_HR_EMAIL"], "PASSWORD": os.environ["E2E_HR_PASSWORD"]})["AuthenticationResult"]["IdToken"]
    print(f"::add-mask::{tok}")
    claims = json.loads(base64.urlsafe_b64decode(tok.split(".")[1] + "=="))
    print("probe: groups claim =", claims.get("cognito:groups"))
    auth = {"Authorization": f"Bearer {tok}", "Origin": "http://127.0.0.1:4300"}
    for name, path in [("hr-partners", "/v1/hr-partners"), ("email-check", "/v1/employees/email-check?email=probe.free%40blackhole.postmarkapp.com")]:
        s, h, b = call("GET", api + path, auth)
        cors = {k: v for k, v in h.items() if k.lower().startswith("access-control")}
        print(f"probe: GET {name}: {s} body={shape(b)} cors={cors}")
        s, h, b = call("OPTIONS", api + path.split("?")[0], {"Origin": "http://127.0.0.1:4300", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"})
        cors = {k: v for k, v in h.items() if k.lower().startswith("access-control")}
        print(f"probe: OPTIONS {name}: {s} cors={cors}")
    s, h, b = call("OPTIONS", api + "/v1/employees", {"Origin": "http://127.0.0.1:4300", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,idempotency-key"})
    print(f"probe: OPTIONS POST with idempotency-key: {s} allow-headers={h.get('access-control-allow-headers')}")


main()
