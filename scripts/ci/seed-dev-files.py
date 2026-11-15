#!/usr/bin/env python3
"""
Put a sample PDF behind each document that seed-dev.py wrote for Naledi Dlamini.

Run after seed-dev.py, with the dev OIDC role. Refuses to run outside pepla-dev.
Fake text only. Files go under seed-samples/, not uploads/, because uploads/
starts the OCR Lambda. Safe to re-run: it overwrites the same four files.
Output is a count only: the repo and its Actions logs are public.
"""
import importlib.util
import pathlib
import sys
import uuid

import boto3

spec = importlib.util.spec_from_file_location("seed_dev", pathlib.Path(__file__).with_name("seed-dev.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


def main() -> None:
    account = boto3.client("sts", region_name=seed.REGION).get_caller_identity()["Account"]
    if account != seed.DEV_ACCOUNT:
        sys.exit("::error::seed-dev-files only runs in pepla-dev")
    s3 = boto3.client("s3", region_name=seed.REGION)
    email = f"pepla-demo-naledi.dlamini@{seed.MAIL_DOMAIN}"
    employee_id = str(uuid.uuid5(seed.NS, email))
    for doc_id, doc_type, *_ in seed.NALEDI_DOCUMENTS:
        s3.put_object(Bucket=seed.UPLOAD_BUCKET, Key=seed.sample_key(employee_id, doc_id),
                      ContentType="application/pdf",
                      Body=seed.sample_pdf(doc_type.replace("_", " ").title()))
    print(f"seed-dev-files: sample files {len(seed.NALEDI_DOCUMENTS)}")


if __name__ == "__main__":
    main()
