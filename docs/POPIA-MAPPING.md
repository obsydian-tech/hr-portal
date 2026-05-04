# POPIA Compliance Mapping — Naleko HR Onboarding Platform

**Document version:** 1.0  
**Date:** 4 May 2026  
**Classification:** Internal — Compliance  
**Reference ticket:** NH-30  
**Review cadence:** Annually or on material system change

---

## 1. Data Controller & Processor Details

| Role | Entity | Details |
|---|---|---|
| **Data Controller** | Naleko Technologies (Pty) Ltd | Determines the purpose and means of processing personal information |
| **Cloud Processor** | Amazon Web Services (AWS) | Infrastructure processor — Cape Town region `af-south-1` |
| **Information Officer** | _[Name — to be confirmed by company]_ | _[email@naleko.co.za]_ — registered with Information Regulator |
| **Deputy Information Officer** | _[Name — to be confirmed by company]_ | _[email@naleko.co.za]_ |

> **POPIA s.55:** The Information Officer has been designated responsibility for encouraging compliance with POPIA, dealing with requests made under POPIA, and working with the Information Regulator.

---

## 2. Personal Information Processing Register

| Field | Classification | Storage Location | Encryption | Processing Purpose | Retention Period | Lawful Basis |
|---|---|---|---|---|---|---|
| Full Name (`first_name`, `last_name`) | Personal Information | DynamoDB `employees` table | KMS CMK at-rest (`alias/naleko-onboarding-pii`) | Employment onboarding identification | Duration of employment + 5 years | Contract (s.11(1)(b)) |
| SA ID Number (`id_number`) | Special Personal Information | DynamoDB `employees` — ciphertext only; `idNumberLast4` for display | KMS envelope encryption (NH-20) — plaintext never stored | Identity verification against Home Affairs records | 7 years post-employment termination | Legal obligation (s.11(1)(c)) |
| Email Address (`email`) | Personal Information | DynamoDB `employees` table + AWS Cognito | KMS CMK at-rest | System communications, authentication | Duration of employment + 5 years | Contract (s.11(1)(b)) |
| Employee ID (`employee_id`) | Personal Information | DynamoDB `employees` table | KMS CMK at-rest | Internal reference, audit linkage | Duration of employment + 5 years | Contract (s.11(1)(b)) |
| ID Document image (JPEG/PDF) | Special Personal Information (Biometric-adjacent) | S3 bucket `document-ocr-verification-uploads` | KMS CMK default SSE (NH-19) | Document authenticity verification via Textract OCR | 7 years post-employment termination | Legal obligation (s.11(1)(c)) |
| OCR Verification Record | Personal Information | DynamoDB `verifications` table | KMS CMK at-rest | Audit trail of verification outcome | 7 years post-employment termination | Legal obligation (s.11(1)(c)) |
| Cognito User Record | Personal Information | AWS Cognito User Pool `af-south-1_2LdAGFnw2` | AWS-managed encryption | Authentication and authorisation | Duration of employment | Contract (s.11(1)(b)) |
| Audit Log Entries | Personal Information | DynamoDB `onboarding-events` table (immutable) | KMS CMK at-rest (NH-27) | Immutable compliance audit trail | 7 years | Legal obligation (s.11(1)(c)) |
| Structured Logs | Personal Information — minimised | CloudWatch Logs | AWS-managed | Operational debugging — zero PII policy enforced (NH-32) | 90 days | Legitimate interest (s.11(1)(f)) |

### Data Minimisation measures

- SA ID number: Only the last 4 digits (`idNumberLast4`) are returned to the UI; the full ciphertext never leaves the backend boundary.
- Logs: Lambda structured logger (`@aws-lambda-powertools/logger`) configured to strip all PII fields before emission (NH-32).
- Presigned URLs: Document images are never proxied through Lambda — issued as time-limited S3 presigned URLs (max 15 minutes) to eliminate a PII data pathway (NH-21).

---

## 3. Third-Party Data Transfers

| Recipient | Country | Data Transferred | Purpose | Safeguard | Status |
|---|---|---|---|---|---|
| **AWS Textract** | `eu-west-1` (Ireland) | ID document images (JPEG/PDF) | OCR text extraction for identity verification | **⚠️ DEVIATION NOTED** — Textract is not available in `af-south-1`. Data is transferred to `eu-west-1` for processing and the result is returned to `af-south-1`. Standard Contractual Clauses (SCCs) under AWS DPA apply. Awaiting AWS regional expansion of Textract. | Active — documented deviation |
| **AWS (General)** | `af-south-1` (South Africa — Cape Town) | All personal information listed above | Cloud infrastructure processing | AWS Data Processing Addendum (DPA); POPIA-aligned data residency in South Africa | Compliant |
| **Postmark** | United States | Employee email address, name | Transactional email (onboarding notifications) | Standard Contractual Clauses (SCCs); Postmark DPA signed | Active |
| **Vercel** | United States | Frontend application (no PII) | Frontend hosting | **RESOLVED** — migrated to AWS CloudFront + S3 `af-south-1` (NH-38). `vercel.json` removed. | Resolved — no longer active post-NH-38 |

### Textract Deviation Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| POPIA s.72 cross-border transfer without adequate protection | Low | High | AWS SCCs in place; document images deleted from Textract after processing; no persistent storage outside af-south-1 |
| Information Regulator challenge | Low | Medium | Deviation explicitly documented; awaiting Textract regional availability; review board notified |

---

## 4. Data Subject Rights Procedures

POPIA Chapter 2 grants data subjects the following rights. Procedures for each:

### 4.1 Right to Access (s.23)
- **Mechanism:** `GET /v1/employees/{id}` — available to HR Partners authenticated via Cognito JWT.
- **Internal procedure:** Employee may request access in writing to the Information Officer. HR Partner retrieves record via system and provides within 30 days.
- **SLA:** 30 days from request receipt.

### 4.2 Right to Correction / Update (s.24)
- **Mechanism:** `PATCH /v1/employees/{id}` — to be implemented (Stage 4 roadmap).
- **Internal procedure (interim):** Employee submits correction request in writing. HR Partner updates record manually and confirms in writing.
- **SLA:** 30 days from request receipt.

### 4.3 Right to Erasure / Deletion (s.24)
- **Mechanism:** No automated endpoint yet — manual process.
- **Internal procedure:** Employee or HR submits erasure request to Information Officer. Steps:
  1. Disable Cognito user account immediately.
  2. Remove PII fields from DynamoDB `employees` record (replace with tombstone marker).
  3. Delete S3 document objects.
  4. Retain audit log entries in `onboarding-events` for legal retention period (anonymised — employee ID replaced with `[ERASED]`).
  5. Confirm erasure in writing within 30 days.
- **SLA:** 30 days from verified request.

### 4.4 Right to Object (s.11(3))
- **Mechanism:** Manual process.
- **Internal procedure:** Employee objects in writing to Information Officer. Processing halted pending review. Legal counsel advises on lawful basis assessment.
- **SLA:** Acknowledgement within 5 business days; resolution within 30 days.

### 4.5 Right to Complain to the Information Regulator (s.74)
- **Contact:** Information Regulator (South Africa) — [www.justice.gov.za/inforeg](https://www.justice.gov.za/inforeg)
- Email: inforeg@justice.gov.za
- All staff must be informed of this right on request.

---

## 5. Breach Notification Procedure

POPIA s.22 requires notification to the Information Regulator and affected data subjects as soon as reasonably possible after a breach.

### 5.1 Detection
| Mechanism | Description |
|---|---|
| CloudWatch alarm `naleko-security-anomaly` | Composite alarm on `onboarding-events` anomalies, Lambda error spikes, and API 4xx/5xx surges (NH-35) |
| AWS Config rule violations | 5 managed rules + custom `af-south-1` region enforcement (NH-36) |
| X-Ray tracing | End-to-end trace anomaly detection (NH-33) |
| Manual report | Employee or HR Partner reports suspected breach to Information Officer |

### 5.2 Severity Classification
| Severity | Criteria | Response SLA |
|---|---|---|
| **P0 — Critical** | SA ID numbers or document images exposed externally | Notify IR + affected subjects within 72 hours |
| **P1 — High** | Internal PII accessed by unauthorised party | Notify IR within 72 hours; subjects within 30 days |
| **P2 — Medium** | Metadata or non-sensitive fields exposed | Internal investigation; notify IR if _reasonably likely to be prejudicial_ |

### 5.3 Notification Steps
1. **Contain:** Disable affected Cognito accounts; revoke active presigned URLs.
2. **Assess:** Determine scope using audit log (`onboarding-events` DynamoDB) and CloudTrail.
3. **Notify Information Regulator:** Within 72 hours via [Information Regulator Breach Notification Form](https://www.justice.gov.za/inforeg/docs.html).
   - CISO: _[name — to be confirmed]_ / _[email@naleko.co.za]_
4. **Notify affected data subjects:** As soon as reasonably possible after IR notification.
5. **Post-mortem:** Document root cause, remediation, and prevention measures within 14 days.

---

## 6. Technical & Organisational Measures

### 6.1 Technical Controls

| Control | Implementation | POPIA Condition | Ticket |
|---|---|---|---|
| Encryption at rest — DynamoDB | KMS CMK `alias/naleko-onboarding-pii` on all tables | Condition 7 (Security Safeguards) | NH-17, NH-18 |
| Encryption at rest — S3 | KMS CMK default SSE on `document-ocr-verification-uploads` | Condition 7 | NH-19 |
| Encryption in transit | TLS 1.2 enforced on all API Gateway endpoints; HTTPS-only CloudFront | Condition 7 | Baseline |
| PII envelope encryption | SA ID number stored as KMS ciphertext; only `idNumberLast4` exposed to UI | Condition 7 + Condition 4 (Further Processing) | NH-20 |
| Access control — authentication | AWS Cognito JWT authoriser on all API routes; no unauthenticated access | Condition 7 | NH-5 |
| Access control — authorisation | JWT claims determine role; `x-staff-id`/`x-role` headers removed | Condition 7 | NH-6 |
| Per-Lambda IAM roles | Least-privilege scoped IAM roles per Lambda — no `FullAccess` policies | Condition 7 | NH-8 |
| Presigned URL document access | Documents accessed via time-limited S3 presigned URLs (15 min TTL) — no public S3 URLs | Condition 7 | NH-7, NH-21 |
| Audit logging | EventBridge → Lambda → DynamoDB `onboarding-events` immutable log | Condition 7 | NH-27 |
| Zero-PII structured logging | `@aws-lambda-powertools/logger` strips PII before CloudWatch emission | Condition 7 | NH-32 |
| X-Ray distributed tracing | End-to-end trace on all Lambda functions and API Gateway | Condition 7 (monitoring) | NH-33 |
| AWS Config compliance rules | 5 managed rules + custom region enforcement; continuous compliance monitoring | Condition 7 | NH-36 |
| Frontend data residency | CloudFront + S3 `af-south-1` (post-NH-38); eliminates Vercel US hosting | Condition 8 (Transborder Flows) | NH-38 |

### 6.2 Organisational Measures

| Measure | Description |
|---|---|
| Information Officer designation | Designated and registered with the Information Regulator per s.55 |
| Staff training | All staff with access to PII trained on POPIA obligations on onboarding and annually |
| Data processing agreements | DPAs in place with AWS and Postmark |
| Retention schedule | Automated deletion procedures to be implemented; manual schedule documented above |
| Incident response plan | Breach notification procedure documented in §5 above |
| Privacy by design | PII minimisation, encryption-first, and audit logging built into system architecture from inception |

---

## 7. Condition-to-Control Traceability (POPIA 8 Conditions)

| Condition | Name | Controls Implemented |
|---|---|---|
| 1 | Accountability | Information Officer designated; compliance programme documented |
| 2 | Processing Limitation | Only data necessary for onboarding collected; purpose specified at collection |
| 3 | Purpose Specification | Purpose documented per field in §2; retention periods defined |
| 4 | Further Processing Limitation | No further processing beyond stated purpose; Textract deviation documented in §3 |
| 5 | Information Quality | HR Partner responsible for data accuracy; correction procedure in §4.2 |
| 6 | Openness | Privacy notice to be added to onboarding UI (pending — Stage 4) |
| 7 | Security Safeguards | Full technical and organisational measures documented in §6 |
| 8 | Data Subject Participation | Rights procedures documented in §4; Information Regulator contact in §4.5 |

---

## 8. Open Items & Review Actions

| Item | Owner | Target Date |
|---|---|---|
| Confirm Information Officer name and registration number | Legal/Executive | Before government tender submission |
| Confirm Deputy Information Officer | Legal/Executive | Before government tender submission |
| Add privacy notice to Angular onboarding UI | Engineering | Stage 4 |
| Implement `PATCH /v1/employees/{id}` correction endpoint | Engineering | Stage 4 |
| Implement automated retention/deletion procedures | Engineering | Stage 4 |
| Monitor Textract `af-south-1` availability and migrate when available | Engineering / AWS TAM | Ongoing |
| Annual POPIA compliance review | Information Officer | May 2027 |
| Verify NH-38 (Vercel removal) complete before tender submission | Engineering | NH-38 milestone |

---

_This document was authored by the Naleko engineering team and is subject to review and sign-off by the Information Officer before submission in any government tender. Last updated: 4 May 2026._
