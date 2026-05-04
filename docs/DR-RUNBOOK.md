# Disaster Recovery Runbook — Naleko HR Portal

> **Classification:** Internal — Operations  
> **Owner:** Engineering Team  
> **Last Updated:** 2026-04-29  
> **Review Cycle:** Quarterly + after any incident

---

## 1. Recovery Objectives (RTO / RPO)

| Scenario | RTO | RPO | Mechanism |
|---|---|---|---|
| Lambda function failure | 5 min (auto-recover) | 0 (stateless) | CloudWatch alarm + auto-retry |
| DynamoDB table corruption | 1 hour | 24 hours | PITR (35-day window) |
| S3 document loss | 4 hours | 30 days | S3 Versioning |
| Cognito user pool corruption | 4 hours | Manual re-creation | Weekly export to S3 |
| KMS key deletion | 30 days (deletion window) | CMK recoverable | 30-day scheduled deletion |
| Full region outage | 8 hours | 24 hours | Manual failover procedure |

---

## 2. Backup Configuration

### 2.1 DynamoDB Point-in-Time Recovery (PITR)

All five DynamoDB tables have PITR enabled via Terraform:

| Table | Terraform Resource | PITR |
|---|---|---|
| `employees` | `aws_dynamodb_table.employees` | ✅ Enabled |
| `documents` | `aws_dynamodb_table.documents` | ✅ Enabled |
| `document-verification` | `aws_dynamodb_table.document_verification` | ✅ Enabled |
| `external-verification-requests` | `aws_dynamodb_table.external_verification_requests` | ✅ Enabled |
| `onboarding-events` | `aws_dynamodb_table.onboarding_events` | ✅ Enabled |

Retention window: **35 days**. All tables encrypted with the PII CMK (`module.kms_pii`).

**Restore a table to a point in time:**

```bash
# Restore employees table to 1 hour ago
aws dynamodb restore-table-to-point-in-time \
  --source-table-name employees \
  --target-table-name employees-restored-$(date +%Y%m%d-%H%M) \
  --restore-date-time $(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ")

# Monitor restore progress
aws dynamodb describe-table \
  --table-name employees-restored-$(date +%Y%m%d-%H%M) \
  --query "Table.TableStatus"

# Once ACTIVE, verify row count matches source
aws dynamodb scan --table-name employees --select COUNT
aws dynamodb scan --table-name employees-restored-$(date +%Y%m%d-%H%M) --select COUNT
```

> ⚠️ Restored tables do NOT inherit the original table's IAM policies or stream settings. Re-apply manually.

### 2.2 S3 Object Versioning

The `document-ocr-verification-uploads` bucket has versioning enabled (`aws_s3_bucket_versioning.document_uploads`). All objects are KMS-encrypted.

**List versions of an object:**

```bash
aws s3api list-object-versions \
  --bucket document-ocr-verification-uploads \
  --prefix employees/EMP-001/passport.pdf
```

**Restore a deleted object (un-delete):**

```bash
# Find the delete marker version ID
DELETE_MARKER_ID=$(aws s3api list-object-versions \
  --bucket document-ocr-verification-uploads \
  --prefix employees/EMP-001/passport.pdf \
  --query "DeleteMarkers[?IsLatest==\`true\`].VersionId" \
  --output text)

# Remove the delete marker to restore the object
aws s3api delete-object \
  --bucket document-ocr-verification-uploads \
  --key employees/EMP-001/passport.pdf \
  --version-id "$DELETE_MARKER_ID"
```

**Restore an overwritten object to a previous version:**

```bash
# List all versions to find the target VersionId
aws s3api list-object-versions \
  --bucket document-ocr-verification-uploads \
  --prefix employees/EMP-001/passport.pdf \
  --query "Versions[*].{VersionId:VersionId,LastModified:LastModified}"

# Copy an older version as the new latest
aws s3api copy-object \
  --bucket document-ocr-verification-uploads \
  --copy-source "document-ocr-verification-uploads/employees/EMP-001/passport.pdf?versionId=<TARGET_VERSION_ID>" \
  --key employees/EMP-001/passport.pdf
```

### 2.3 Cognito User Pool Backup

Export all users to S3 (run weekly via cron or EventBridge scheduled rule):

```bash
aws cognito-idp list-users \
  --user-pool-id <COGNITO_POOL_ID> \
  --output json > /tmp/cognito-users-$(date +%Y%m%d).json

aws s3 cp /tmp/cognito-users-$(date +%Y%m%d).json \
  s3://document-ocr-verification-uploads/backups/cognito/cognito-users-$(date +%Y%m%d).json
```

---

## 3. Incident Response Procedures

### 3.1 Security Breach (Unauthorised Data Access)

**Indicators:** Unexpected CloudTrail API calls, GuardDuty alert, user report.

1. **Disable compromised Cognito users immediately:**
   ```bash
   aws cognito-idp admin-disable-user \
     --user-pool-id <POOL_ID> \
     --username <USERNAME>
   ```
2. **Global sign-out** to revoke all active JWT tokens:
   ```bash
   aws cognito-idp admin-user-global-sign-out \
     --user-pool-id <POOL_ID> \
     --username <USERNAME>
   ```
3. **Schedule KMS key deletion** and create a replacement key:
   ```bash
   aws kms schedule-key-deletion --key-id <KEY_ID> --pending-window-in-days 30
   # Then apply Terraform to provision a new key
   ```
4. **Preserve audit evidence** — do NOT delete CloudTrail logs or `onboarding-events` table records.
5. **Notify Information Regulator within 72 hours** (POPIA Section 22):
   - Regulator: [https://inforegulator.org.za](https://inforegulator.org.za)
   - Internal contact: [CISO name + phone — insert here]
6. Document the incident timeline and affected data subjects.

---

### 3.2 Service Outage

**Indicators:** CloudWatch alarm triggers (NH-35), API Gateway 5xx errors, user reports.

1. **Identify failing component** — check CloudWatch alarms dashboard.
2. **Trace root cause** — check X-Ray service map for Lambda errors/timeouts.
3. **Roll back a Lambda function** to previous version:
   ```bash
   # List recent versions
   aws lambda list-versions-by-function --function-name <FUNCTION_NAME>

   # Point alias to previous version
   aws lambda update-alias \
     --function-name <FUNCTION_NAME> \
     --name live \
     --function-version <PREVIOUS_VERSION>
   ```
4. **Roll back frontend** — push previous git tag, CI/CD pipeline (NH-37) redeploys to Vercel.
5. **Roll back Terraform** — revert the relevant `.tf` file commit, then:
   ```bash
   cd infra && terraform apply
   ```
6. Verify CloudWatch alarms return to `OK` state.

---

### 3.3 Data Loss

**Indicators:** Missing DynamoDB records, missing S3 documents, employee report.

1. **Identify scope** — determine affected table, affected `employeeId`, and approximate time range.
2. **Cross-reference audit log** — query `onboarding-events` table for that `employeeId`:
   ```bash
   aws dynamodb query \
     --table-name onboarding-events \
     --index-name employeeId-timestamp-index \
     --key-condition-expression "employeeId = :eid" \
     --expression-attribute-values '{":eid": {"S": "EMP-001"}}'
   ```
3. **Restore from PITR** (DynamoDB) or **un-delete from versioning** (S3) — see Section 2.
4. **Verify restored data** — compare record count and spot-check key fields against audit log.
5. **Notify affected users** via HR contact.

---

## 4. Full System Restore Sequence

Use when recovering from total environment loss (e.g., accidental Terraform destroy, region failure).

| Step | Action | Command / Tool |
|---|---|---|
| 1 | Restore Terraform state | `terraform init && terraform apply` from last committed state |
| 2 | Restore DynamoDB tables | PITR restore for each table (see Section 2.1) |
| 3 | Re-enable S3 versioning | Applied automatically via Terraform |
| 4 | Restore KMS keys | Terraform provisions new keys; update key ARN references |
| 5 | Re-create Cognito users | Import from S3 backup (see Section 2.3) |
| 6 | Redeploy Lambda functions | CI/CD push to `main` triggers deployment |
| 7 | Verify API Gateway | Run smoke tests (`hr-portal/e2e/`) against the live endpoint |
| 8 | Verify documents | Sample-check S3 objects for KMS decryptability |
| 9 | Notify stakeholders | Send status to HR Director and Engineering lead |

---

## 5. Contact Escalation List

| Role | Name | Contact | Escalation Trigger |
|---|---|---|---|
| Engineering Lead | [Insert name] | [Insert phone/email] | Any P1 incident |
| CISO / Security | [Insert name] | [Insert phone/email] | Security breach, POPIA notification |
| HR Director | [Insert name] | [Insert phone/email] | Data affecting employees |
| AWS Support | — | [AWS Support Console](https://console.aws.amazon.com/support) | Region outage, service limits |
| Information Regulator (SA) | — | [inforegulator.org.za](https://inforegulator.org.za) · 010 023 5207 | Data breach (within 72 hrs) |

---

## 6. Monthly DR Test Checklist

Run these checks on the first Monday of each month.

- [ ] Restore `employees` table from PITR to `employees-drtest-YYYYMMDD`; verify count matches source; delete test table.
- [ ] Restore one document from S3 versioning to confirm version recovery works.
- [ ] Simulate Lambda failure: disable a Lambda, verify CloudWatch alarm triggers within 5 min.
- [ ] Verify S3 versioning is still `Enabled` (`aws s3api get-bucket-versioning`).
- [ ] Review CloudTrail for unexpected API calls in the past 30 days.
- [ ] Rotate test Cognito credentials; verify login/logout works post-rotation.
- [ ] Confirm Cognito weekly export exists in S3 backups prefix.
- [ ] Update this document if any procedure changed.

---

*Document maintained under version control. For changes, open a PR and request review from Engineering Lead.*
