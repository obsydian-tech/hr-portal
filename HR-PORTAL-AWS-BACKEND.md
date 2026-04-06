# HR Portal — AWS Backend Requirements

**Version:** 1.1 | **Last Updated:** 31 March 2026 | **Platform:** Naleko Digital Solutions HR Portal  
**Target Audience:** Senior AWS DevOps / Backend Engineer  
**Company:** Naleko Digital Solutions — *"Verifying people, building trust."*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Existing Prototype Resources](#4-existing-prototype-resources)
5. [Authentication — AWS Cognito](#5-authentication--aws-cognito)
6. [DynamoDB Tables](#6-dynamodb-tables)
7. [Lambda Functions](#7-lambda-functions)
8. [API Gateway REST Endpoints](#8-api-gateway-rest-endpoints)
9. [S3 Storage](#9-s3-storage)
10. [OCR Processing — Amazon Textract](#10-ocr-processing--amazon-textract)
11. [External Verification Partners](#11-external-verification-partners)
12. [Email Service — Amazon SES](#12-email-service--amazon-ses)
13. [Contact HR — Case Management](#13-contact-hr--case-management)
14. [POPIA & GDPR Compliance](#14-popia--gdpr-compliance)
15. [Infrastructure as Code](#15-infrastructure-as-code)
16. [Environment Configuration](#16-environment-configuration)
17. [CI/CD Pipeline](#17-cicd-pipeline)
18. [Monitoring & Logging](#18-monitoring--logging)
19. [Security](#19-security)
20. [Frontend Integration Points Reference](#20-frontend-integration-points-reference)
21. [WhatsApp Integration — Cloud API](#21-whatsapp-integration--cloud-api)

---

## 1. Executive Summary

### What Is Being Built

A serverless backend on AWS to power the Naleko HR Portal — an employee onboarding and document verification platform. The backend supports two access channels:

1. **HR Portal (Desktop)** — full-featured Angular 19 SPA for HR staff and employees
2. **WhatsApp Onboarding (Mobile)** — lightweight PWA accessed via WhatsApp magic link for employee document uploads on mobile

The backend must support two personas:

- **HR Staff** — register new employees, trigger WhatsApp onboarding invitations, review OCR-processed documents, manage verifications, view dashboards
- **Employees** — receive WhatsApp onboarding link, complete document uploads via mobile PWA, track verification status, contact HR

### Current State

A **prototype backend** exists with basic API Gateway + Lambda + DynamoDB resources in the default region. The **frontend is a fully-built Angular 19 + PrimeNG application** deployed to Vercel (temporary). All frontend data is currently mocked — zero HTTP calls exist. The frontend is production-ready in UI terms and waiting for backend integration.

### Key Constraints

| Constraint | Detail |
|-----------|--------|
| **Region** | `af-south-1` (Cape Town) — **MANDATORY** for POPIA data residency |
| **No AWS Amplify** | Amplify Gen 2 is **not available** in af-south-1. All infrastructure must be provisioned via **Terraform or CloudFormation** |
| **POPIA compliance** | All personal data must reside in South Africa. Encryption at rest and in transit. Consent tracking required |
| **Data isolation** | HR staff see only employees they manage. Employees see only their own data |
| **OCR** | Amazon Textract for document processing (SA National ID, bank confirmations) |
| **External verification** | VerifyNow (SA identity via Home Affairs) and AVS (bank account verification) |
| **WhatsApp Cloud API** | Meta-hosted WhatsApp Business Platform for onboarding invitations. Direct Cloud API integration (not AWS End User Messaging Social) |
| **Separate PWA** | Mobile onboarding app is a standalone Angular 19 PWA project, deployed to its own S3 + CloudFront distribution |

### Prototype → Production Migration

The approach is: **formalize the prototype** into a proper IaC-managed stack with proper security, multi-environment support, and CI/CD. The prototype Lambda functions and DynamoDB tables serve as reference — they should be rebuilt cleanly with proper naming, indexes, and configuration.

---

## 2. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular 19)                       │
│                    Deployed to S3 + CloudFront                      │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Amazon CloudFront                                │
│              CDN + SSL termination + SPA routing                    │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Cognito     │  │  API Gateway │  │  S3 (Static      │
│  User Pool   │  │  REST API    │  │  Hosting Bucket) │
│  (Auth)      │  │  (Backend)   │  │                  │
└──────────────┘  └──────┬───────┘  └──────────────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ Lambda   │ │ Lambda   │ │ Lambda   │
       │ Employees│ │ Documents│ │ Verific. │
       └────┬─────┘ └────┬─────┘ └────┬─────┘
            │             │             │
            ▼             ▼             ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ DynamoDB │ │ S3 Docs  │ │ DynamoDB │
       │ Employee │ │ Bucket   │ │ Verific. │
       └──────────┘ └────┬─────┘ └──────────┘
                         │
                    ┌────┴─────┐
                    │ Textract │
                    │ (OCR)    │
                    └──────────┘
```

### WhatsApp Onboarding Channel

```
┌──────────────────┐     ┌─────────────────────┐     ┌───────────────────┐
│  HR Portal       │ ───▶ │  WhatsApp Lambda   │ ───▶ │  Meta Cloud API    │
│  "Send Invite"   │     │  (generate token   │     │  graph.facebook.   │
│                  │     │   + send message)  │     │  com/v25.0/...     │
└──────────────────┘     └───────┬─────────────┘     └───────────────────┘
                            │                                   │
                            ▼                                   │
                     ┌───────────────────┐                       │
                     │  DynamoDB          │                       │
                     │  Onboarding Token  │                       │
                     │  Table             │                       │
                     └───────────────────┘                       │
                                                                ▼
                                                    ──────────────
                     ┌───────────────────┐     Employee’s WhatsApp
                     │  Onboarding PWA    │     receives magic link
                     │  (Separate App)    │     with CTA button
                     │  S3 + CloudFront   │            │
                     └─────────┬─────────┘            │
                               │   ◄─────────────────┘
                               │   Employee taps link,
                               │   PWA validates token,
                               ▼   uploads documents
                     ┌───────────────────┐
                     │  Same API Gateway  │
                     │  + Lambda + S3     │
                     │  + Textract        │
                     └───────────────────┘
```

### Data Flow — Employee Document Upload

```
Employee → Angular
  → POST /documents/upload-url (get presigned URL)
  → PUT {presignedUrl} (direct S3 upload, bypasses Lambda/API GW for large files)
  → S3 event notification triggers OCR Lambda
  → Textract processes document
  → Lambda writes OCR results to Document table
  → Frontend polls GET /documents/{docId}/status
  → HR receives notification for manual review (if confidence < threshold)
```

### Data Flow — External Verification

```
HR Staff → Angular
  → POST /verifications/external
  → Lambda calls VerifyNow (identity) or AVS (bank) API
  → Response stored in Verification table
  → Document status updated
  → Frontend receives result
```

### Data Flow — WhatsApp Onboarding

```
HR Staff → HR Portal
  → POST /onboarding/invite { employee_id, phone }
  → WhatsApp Lambda:
      1. Generate cryptographic token (UUID v4)
      2. Store token in Onboarding Token table (TTL: 15 min, single-use)
      3. Build magic link: https://onboard.naleko.co.za?token={token}
      4. Call Meta Cloud API: POST graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
         → Send template message with CTA button containing magic link
      5. Return { status: 'sent', whatsapp_message_id }

Employee taps WhatsApp CTA button → Opens PWA in mobile browser
  → PWA calls GET /onboarding/validate-token/{token}
  → Lambda validates: exists? not expired? not used?
  → If valid: mark token as used, return session JWT + employee context
  → Employee uploads documents via same presigned URL flow
  → Same OCR + verification pipeline processes uploads

Meta sends delivery webhook → POST /webhooks/whatsapp
  → Lambda verifies webhook signature
  → Updates message status (sent → delivered → read) in Employee table
```

---

## 3. Technology Stack

### AWS Services Required

| Service | Purpose | Region |
|---------|---------|--------|
| **Cognito** | User authentication (HR Staff + Employees) | af-south-1 |
| **API Gateway** | REST API (HTTPS endpoints) | af-south-1 |
| **Lambda** | Business logic (Node.js 20.x) | af-south-1 |
| **DynamoDB** | NoSQL database (Employee, Document, Verification, Case tables) | af-south-1 |
| **S3** | Document storage (uploads) + Frontend hosting | af-south-1 |
| **CloudFront** | CDN for frontend + API caching where appropriate | Global (origin in af-south-1) |
| **Textract** | OCR processing for document verification | af-south-1 (verify availability) or nearest supported region |
| **SES** | Transactional emails (invite, status updates) | af-south-1 or eu-west-1 |
| **CloudWatch** | Logging + monitoring + alarms | af-south-1 |
| **IAM** | Least-privilege Lambda execution roles | Global |
| **KMS** | Encryption key management for DynamoDB + S3 | af-south-1 |
| **WAF** | Web Application Firewall for API Gateway + CloudFront | af-south-1 |
| **Secrets Manager** | External API keys (VerifyNow, AVS) + WhatsApp access token | af-south-1 |
| **Meta WhatsApp Cloud API** | WhatsApp Business messaging for onboarding invitations (external service, not AWS) | Meta-hosted (graph.facebook.com) |
| **S3 (PWA Hosting)** | Separate S3 + CloudFront distribution for onboarding PWA | af-south-1 |

### Runtime Details

| Component | Runtime | Notes |
|-----------|---------|-------|
| Lambda functions | Node.js 20.x | ES modules, TypeScript compiled to JS |
| IaC | Terraform 1.5+ or CloudFormation | **Not Amplify** (unavailable in af-south-1) |
| SDK | AWS SDK v3 (modular imports) | `@aws-sdk/client-dynamodb`, `@aws-sdk/client-s3`, etc. |
| API responses | JSON | Standard `{ statusCode, body, headers }` Lambda proxy format |

> **⚠️ Textract Availability Note:** Verify that Amazon Textract `AnalyzeID` is available in af-south-1. If not, use a cross-region strategy: invoke Textract in the nearest supported region (e.g., `eu-west-1`) while keeping all PII data in af-south-1. The document bytes are sent to Textract for processing, but no data is stored outside af-south-1.

---

## 4. Existing Prototype Resources

The following AWS resources exist at prototype level and should be used as **reference only** — rebuild them cleanly with proper IaC.

### 4.1 Prototype API Gateway Endpoints

| Method | Function Name | Prototype Status | Maps to Frontend Method |
|--------|--------------|-----------------|------------------------|
| `POST` | `uploadDocument` | Working | `DocumentUploadService.upload()` |
| `GET` | `getAllDocumentVerifications` | Working | `HrApiService.getVerifications()` |
| `GET` | `getDocumentVerificationDetails` | Working | `HrApiService.getVerificationById()` |
| `GET` | `getDocumentVerificationForEmployee` | Working | `HrApiService.getEmployeeDocuments()` |
| `POST` | `createEmployee` | Working | `HrApiService.createEmployee()` |
| `GET` | `getEmployees` | Working | `HrApiService.getEmployees()` |

### 4.2 Prototype Resources Inventory

| Resource Type | Exists? | Notes |
|--------------|---------|-------|
| API Gateway REST API | ✅ Yes | Single stage, no custom domain |
| Lambda functions | ✅ Yes | 6 functions, Node.js runtime, basic implementations |
| DynamoDB tables | ✅ Yes | Basic schema, no secondary indexes |
| S3 bucket | ✅ Yes | Document storage, no lifecycle policies |
| Cognito | ❌ No | Not set up — must be created from scratch |
| CloudFront | ❌ No | Not set up — must be created |
| SES | ❌ No | Not set up — must be configured + verified |
| Textract | ❓ Partial | May have been tested manually, no automated pipeline |
| IaC | ❌ No | All resources were created manually via Console |
| CI/CD | ❌ No | No pipeline exists |

### 4.3 Migration Strategy

1. **Audit** existing prototype resources — document current table schemas, Lambda code, API Gateway routes
2. **Rebuild** everything in IaC (Terraform preferred) with proper naming: `naleko-{env}-{resource}` (e.g., `naleko-dev-employee-table`)
3. **Migrate** any useful Lambda code from prototype into new functions
4. **Decommission** prototype resources once production stack is validated

---

## 5. Authentication — AWS Cognito

### 5.1 User Pool Configuration

```
User Pool Name:    naleko-{env}-user-pool
Region:            af-south-1
Sign-in:           Email (primary identifier)
MFA:               Optional TOTP (recommended for HR Staff)
Password Policy:   Min 12 chars, upper, lower, number, special
Email Verification: Required (Cognito sends verification email)
```

### 5.2 User Groups

| Group | Description | Access Level |
|-------|-------------|-------------|
| `hr_staff` | HR managers and administrators | Full read/write on all employees, documents, verifications, cases |
| `employee` | Onboarding employees | Read/write on own data only (employee_id must match JWT claim) |

### 5.3 Custom Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `custom:staff_id` | String | HR Staff ID (e.g., "AS00001") — **HR only** |
| `custom:employee_id` | String | Employee ID (e.g., "EMP-0000011") — **Employee only** |
| `custom:department` | String | Department for routing (Engineering, Finance, etc.) |

### 5.4 App Client

```
App Client Name:   naleko-{env}-web-client
OAuth Flows:       Authorization Code (PKCE) for SPA
Scopes:            openid, email, profile
Token Validity:    Access: 1 hour, ID: 1 hour, Refresh: 30 days
Callback URLs:     https://{domain}/auth/callback
Logout URLs:       https://{domain}/
```

### 5.5 Frontend Integration (`environment.ts`)

```typescript
export const environment = {
  production: false,
  apiUrl: 'https://{api-id}.execute-api.af-south-1.amazonaws.com/{stage}',
  cognito: {
    userPoolId: 'af-south-1_XXXXXXXXX',
    clientId:   'xxxxxxxxxxxxxxxxxxxxxxxxxx',
    region:     'af-south-1',
    domain:     'naleko-{env}.auth.af-south-1.amazoncognito.com',
  },
  s3: {
    documentBucket: 'naleko-{env}-documents',
    region: 'af-south-1',
  },
};
```

### 5.6 JWT Claims Used by Frontend

The Angular frontend will read these from the Cognito ID token:

| Claim | Source | Frontend Usage |
|-------|--------|---------------|
| `email` | Standard | Display in topbar, profile |
| `name` / `given_name` / `family_name` | Standard | Display name, initials avatar |
| `cognito:groups` | Token | Route guards: `hr_staff` → HR portal, `employee` → Employee portal |
| `custom:staff_id` | Custom | Pass to `getEmployees(staffId)` API calls |
| `custom:employee_id` | Custom | Pass to employee-specific API calls, enforce data isolation |

### 5.7 Authentication Flow

```
Angular App → Cognito Hosted UI (login page)
  → User enters email + password
  → Cognito returns Authorization Code
  → Angular exchanges code for tokens (PKCE flow)
  → Tokens stored in memory (not localStorage for security)
  → Auth interceptor attaches accessToken to all API requests
  → API Gateway Cognito authorizer validates token
  → Lambda receives decoded claims in event.requestContext.authorizer
```

---

## 6. DynamoDB Tables

### 6.1 Employee Table

```
Table Name:     naleko-{env}-employees
Billing:        PAY_PER_REQUEST (on-demand)
Encryption:     AWS-managed KMS (SSE)
```

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `employee_id` | `S` | **PK** | `EMP-{XXXXXXX}` (auto-generated, 7-digit zero-padded) |
| `created_by` | `S` | **GSI1-PK** | Staff ID of the HR user who created this employee |
| `stage` | `S` | **GSI1-SK** | Current onboarding stage |
| `email` | `S` | **GSI2-PK** | Employee email (for uniqueness check + login lookup) |
| `first_name` | `S` | — | |
| `middle_name` | `S` | — | Optional |
| `last_name` | `S` | — | |
| `phone` | `S` | — | SA format: `+2783...` |
| `department` | `S` | — | Engineering, Finance, Marketing, HR, Legal, Operations |
| `job_title` | `S` | — | Optional |
| `offer_accept_date` | `S` | — | ISO 8601 date |
| `planned_start_date` | `S` | — | ISO 8601 date |
| `popia_consent_at` | `S` | — | ISO 8601 datetime — when consent was accepted |
| `popia_consent_ip` | `S` | — | IP address at time of consent |
| `created_at` | `S` | — | ISO 8601 datetime |
| `updated_at` | `S` | — | ISO 8601 datetime |

**Global Secondary Indexes:**

| GSI | PK | SK | Projection | Purpose |
|-----|----|----|-----------|---------|
| `GSI1-CreatedBy-Stage` | `created_by` | `stage` | ALL | HR query: "show me all employees I manage, filterable by stage" |
| `GSI2-Email` | `email` | — | KEYS_ONLY | Email uniqueness check during registration + Cognito post-confirm trigger |

### 6.2 Document Table

```
Table Name:     naleko-{env}-documents
Billing:        PAY_PER_REQUEST
Encryption:     AWS-managed KMS (SSE)
```

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `document_id` | `S` | **PK** | `doc_{timestamp}` (auto-generated) |
| `employee_id` | `S` | **GSI1-PK** | FK to Employee table |
| `document_type` | `S` | **GSI1-SK** | `NATIONAL_ID`, `BANK_CONFIRMATION`, `MATRIC_CERTIFICATE`, `TERTIARY_QUALIFICATION` |
| `file_name` | `S` | — | Original uploaded file name |
| `s3_key` | `S` | — | Full S3 object key: `{env}/{employee_id}/{document_type}/{filename}` |
| `s3_bucket` | `S` | — | Bucket name |
| `file_size` | `N` | — | File size in bytes |
| `mime_type` | `S` | — | `application/pdf`, `image/jpeg`, `image/png` |
| `ocr_status` | `S` | — | `PENDING`, `PROCESSING`, `MANUAL_REVIEW`, `PASSED`, `FAILED` |
| `ocr_completed_at` | `S` | — | ISO datetime when Textract finished |
| `ocr_result` | `M` | — | Map: extracted fields from Textract (ID number, name, bank details, etc.) |
| `verification_decision` | `S` | — | `MANUAL_REVIEW`, `PASSED`, `FAILED` or null |
| `verification_reasoning` | `S` | — | Human-readable OCR analysis text |
| `uploaded_by` | `S` | — | Name or ID of the person who uploaded |
| `uploaded_at` | `S` | — | ISO datetime |
| `can_reupload` | `BOOL` | — | `true` if document was rejected and can be re-uploaded |
| `created_at` | `S` | — | ISO datetime |
| `updated_at` | `S` | — | ISO datetime |

**Global Secondary Indexes:**

| GSI | PK | SK | Projection | Purpose |
|-----|----|----|-----------|---------|
| `GSI1-EmployeeDocuments` | `employee_id` | `document_type` | ALL | Get all documents for an employee |

### 6.3 Verification Table

```
Table Name:     naleko-{env}-verifications
Billing:        PAY_PER_REQUEST
Encryption:     AWS-managed KMS (SSE)
```

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `verification_id` | `S` | **PK** | `ver_{timestamp}` (auto-generated) |
| `employee_id` | `S` | **GSI1-PK** | FK to Employee table |
| `document_id` | `S` | — | FK to Document table |
| `document_type` | `S` | — | Document type for filtering |
| `employee_name` | `S` | — | Denormalized for list display |
| `decision` | `S` | **GSI1-SK** | `MANUAL_REVIEW`, `PASSED`, `FAILED` |
| `confidence` | `N` | — | 0–100 OCR confidence score |
| `reasoning` | `S` | — | Full text explanation of OCR analysis |
| `id_number` | `S` | — | Extracted ID number (SA ID format) |
| `name` | `S` | — | Extracted first name |
| `surname` | `S` | — | Extracted surname |
| `date_of_birth` | `S` | — | Extracted DOB |
| `gender` | `S` | — | Extracted gender |
| `citizenship` | `S` | — | Extracted citizenship |
| `bank_name` | `S` | — | Extracted bank name (bank docs) |
| `account_number` | `S` | — | Extracted account number (bank docs) |
| `account_holder` | `S` | — | Extracted account holder (bank docs) |
| `branch_code` | `S` | — | Extracted branch code (bank docs) |
| `document_file_url` | `S` | — | Presigned URL for HR review (generated on read) |
| `verification_source` | `S` | — | `OCR`, `EXTERNAL_VERIFYNOW`, `EXTERNAL_AVS`, `MANUAL` |
| `external_reference` | `S` | — | Reference ID from VerifyNow/AVS |
| `created_at` | `S` | — | ISO datetime |
| `updated_at` | `S` | — | ISO datetime |

**Global Secondary Indexes:**

| GSI | PK | SK | Projection | Purpose |
|-----|----|----|-----------|---------|
| `GSI1-EmployeeVerifications` | `employee_id` | `decision` | ALL | Get/filter verifications for an employee |

### 6.4 Case Table (Contact HR Feature)

```
Table Name:     naleko-{env}-cases
Billing:        PAY_PER_REQUEST
Encryption:     AWS-managed KMS (SSE)
```

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `case_id` | `S` | **PK** | `CASE-{XXXXXXX}` (auto-generated) |
| `employee_id` | `S` | **GSI1-PK** | FK to Employee table — who raised the case |
| `status` | `S` | **GSI1-SK** | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED` |
| `subject` | `S` | — | Free-text subject line |
| `category` | `S` | — | `GENERAL`, `DOCUMENT_ISSUE`, `ONBOARDING`, `OTHER` |
| `description` | `S` | — | Full description text |
| `priority` | `S` | — | `LOW`, `MEDIUM`, `HIGH` |
| `assigned_to` | `S` | **GSI2-PK** | Staff ID of assigned HR person (or `UNASSIGNED`) |
| `department` | `S` | — | Employee's department (for routing) |
| `attachment_s3_key` | `S` | — | Optional attachment S3 key |
| `resolution_notes` | `S` | — | HR staff resolution notes |
| `resolved_at` | `S` | — | ISO datetime |
| `resolved_by` | `S` | — | Staff ID of resolver |
| `created_at` | `S` | **GSI2-SK** | ISO datetime |
| `updated_at` | `S` | — | ISO datetime |

**Global Secondary Indexes:**

| GSI | PK | SK | Projection | Purpose |
|-----|----|----|-----------|---------|
| `GSI1-EmployeeCases` | `employee_id` | `status` | ALL | Employee views their own cases |
| `GSI2-AssignedCases` | `assigned_to` | `created_at` | ALL | HR staff views their assigned cases |

### 6.5 Audit Log Table (POPIA Compliance)

```
Table Name:     naleko-{env}-audit-log
Billing:        PAY_PER_REQUEST
Encryption:     AWS-managed KMS (SSE)
TTL:            expires_at (90 days retention)
```

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `log_id` | `S` | **PK** | UUID |
| `timestamp` | `S` | **SK** | ISO datetime |
| `actor_id` | `S` | **GSI1-PK** | User ID (staff_id or employee_id) |
| `action` | `S` | **GSI1-SK** | `CREATE_EMPLOYEE`, `UPLOAD_DOCUMENT`, `APPROVE_DOCUMENT`, `REJECT_DOCUMENT`, `CREATE_CASE`, `LOGIN`, `CONSENT_GIVEN`, etc. |
| `resource_type` | `S` | — | `employee`, `document`, `verification`, `case` |
| `resource_id` | `S` | — | ID of the affected resource |
| `details` | `M` | — | Action-specific metadata |
| `ip_address` | `S` | — | Client IP |
| `user_agent` | `S` | — | Browser user agent |
| `expires_at` | `N` | — | TTL epoch timestamp (90 days from creation) |

### 6.6 Onboarding Token Table (WhatsApp Magic Link)

```
Table Name:     naleko-{env}-onboarding-tokens
Billing:        PAY_PER_REQUEST
Encryption:     AWS-managed KMS (SSE)
TTL:            expires_at (15 minutes from creation)
```

| Attribute | Type | Key | Description |
|-----------|------|-----|-------------|
| `token` | `S` | **PK** | UUID v4 cryptographic token (embedded in magic link URL) |
| `employee_id` | `S` | **GSI1-PK** | FK to Employee table — who this token was issued for |
| `phone` | `S` | — | Employee phone number (SA format: `+2783...`) |
| `created_by` | `S` | — | Staff ID of the HR user who triggered the invite |
| `whatsapp_message_id` | `S` | — | Meta message ID returned by Cloud API (for status tracking) |
| `message_status` | `S` | — | `SENT`, `DELIVERED`, `READ`, `FAILED` |
| `is_used` | `BOOL` | — | `true` once employee opens the link and validates (single-use enforcement) |
| `used_at` | `S` | — | ISO datetime when token was consumed |
| `used_ip` | `S` | — | IP address of the device that consumed the token |
| `used_user_agent` | `S` | — | Browser user agent of the consuming device |
| `created_at` | `S` | **GSI1-SK** | ISO datetime |
| `expires_at` | `N` | — | TTL epoch timestamp (15 minutes from creation) |

**Global Secondary Indexes:**

| GSI | PK | SK | Projection | Purpose |
|-----|----|----|-----------|--------|
| `GSI1-EmployeeTokens` | `employee_id` | `created_at` | ALL | Look up all tokens issued for an employee (audit trail, rate limiting) |

---

## 7. Lambda Functions

### 7.1 Function Inventory

All Lambda functions use **Node.js 20.x**, arm64 (Graviton2) architecture, and deploy from a shared TypeScript monorepo with per-function handlers.

| Function | Purpose | Timeout | Memory | Triggers |
|----------|---------|---------|--------|----------|
| `naleko-{env}-employees` | Employee CRUD operations | 10s | 256MB | API Gateway |
| `naleko-{env}-documents` | Document CRUD + presigned URL generation | 15s | 512MB | API Gateway |
| `naleko-{env}-ocr-processor` | OCR processing with Textract | 60s | 1024MB | S3 event |
| `naleko-{env}-verifications` | Verification CRUD operations | 10s | 256MB | API Gateway |
| `naleko-{env}-external-verification` | VerifyNow & AVS API integration | 30s | 512MB | API Gateway |
| `naleko-{env}-cases` | Contact HR case management | 10s | 256MB | API Gateway |
| `naleko-{env}-notifications` | Email notifications via SES | 15s | 256MB | DynamoDB Stream / EventBridge |
| `naleko-{env}-auth-triggers` | Cognito triggers (post-confirm, pre-token) | 5s | 128MB | Cognito |
| `naleko-{env}-whatsapp` | WhatsApp Cloud API integration (send invites, validate tokens, webhook) | 15s | 256MB | API Gateway |

### 7.2 Employees Lambda (`naleko-{env}-employees`)

**Routes handled:**

| Method | Path | Action | Authorization |
|--------|------|--------|--------------|
| `POST` | `/employees` | Create new employee | `hr_staff` group |
| `GET` | `/employees` | List employees (filtered by staff_id) | `hr_staff` group |
| `GET` | `/employees/{employeeId}` | Get single employee | `hr_staff` OR matching `employee` |
| `PATCH` | `/employees/{employeeId}` | Update employee (stage, details) | `hr_staff` group |
| `GET` | `/employees/search` | Search by email (query param) | `hr_staff` group |
| `PATCH` | `/employees/{employeeId}/consent` | Record POPIA consent | Matching `employee` only |

**Business Logic:**

- `POST /employees`: 
  - Validate `CreateEmployeeRequest` body
  - Check email uniqueness via GSI2
  - Generate `employee_id` using atomic counter or UUID
  - Set `stage: 'INVITED'`, `created_by` from JWT `custom:staff_id`
  - Create Cognito user account (with temporary password) → trigger invitation email
  - Write to DynamoDB
  - Log to audit table

- `GET /employees`:
  - Query GSI1 with `created_by` = JWT `custom:staff_id`
  - Optional query params: `stage`, `department` (for frontend filters)
  - Return `EmployeeListResponse` format

- `PATCH /employees/{employeeId}/consent`:
  - Verify `employeeId` matches JWT `custom:employee_id`
  - Record `popia_consent_at` (ISO datetime) and `popia_consent_ip` (from request headers)
  - Log to audit table

### 7.3 Documents Lambda (`naleko-{env}-documents`)

**Routes handled:**

| Method | Path | Action | Authorization |
|--------|------|--------|--------------|
| `POST` | `/documents/upload-url` | Generate presigned S3 upload URL | `hr_staff` OR matching `employee` |
| `GET` | `/employees/{employeeId}/documents` | Get all documents for employee | `hr_staff` OR matching `employee` |
| `GET` | `/documents/{documentId}` | Get single document detail | `hr_staff` OR matching `employee` |
| `GET` | `/documents/{documentId}/status` | Poll OCR status | `hr_staff` OR matching `employee` |
| `PATCH` | `/documents/{documentId}/decision` | Approve/reject document | `hr_staff` group |

**Presigned URL Flow:**

```javascript
// POST /documents/upload-url
// Request body:
{
  "employee_id": "EMP-0000011",
  "document_type": "NATIONAL_ID",
  "file_name": "sa_id_front.pdf",
  "content_type": "application/pdf"
}

// Response:
{
  "upload_url": "https://naleko-dev-documents.s3.af-south-1.amazonaws.com/...",
  "document_id": "doc_1711900000000",
  "s3_key": "dev/EMP-0000011/NATIONAL_ID/sa_id_front.pdf",
  "expires_in": 300  // 5 minutes
}
```

**Important:** The frontend uploads directly to S3 using the presigned URL (PUT request). This bypasses Lambda and API Gateway for the actual file transfer, supporting files up to 5GB.

### 7.4 OCR Processor Lambda (`naleko-{env}-ocr-processor`)

**Trigger:** S3 event notification on `PUT` to `naleko-{env}-documents` bucket.

**Processing Pipeline:**

```
S3 PUT event
  → Validate file type (PDF, JPG, PNG)
  → Determine document_type from S3 key path
  → If NATIONAL_ID:
      → Textract AnalyzeID (SA ID card detection)
      → Extract: id_number, full_name, date_of_birth, gender, citizenship
      → Confidence scoring (threshold: 85%)
      → If confidence >= 85%: decision = PASSED
      → If confidence < 85%: decision = MANUAL_REVIEW
  → If BANK_CONFIRMATION:
      → Textract AnalyzeDocument (form extraction)
      → Extract: bank_name, account_number, account_holder, branch_code
      → Confidence scoring (threshold: 80%)
      → Same pass/manual_review logic
  → If MATRIC_CERTIFICATE or TERTIARY_QUALIFICATION:
      → No OCR — mark as MANUAL_REVIEW immediately
      → These documents require human review (no standard form structure)
  → Write OCR result to Document table (update ocr_status, ocr_result, ocr_completed_at)
  → Create Verification record in Verification table
  → If MANUAL_REVIEW: trigger notification to HR staff
  → Log to audit table
```

**Error Handling:**
- Textract timeout → set `ocr_status: 'FAILED'`, mark for manual review
- Unreadable/corrupted file → set `ocr_status: 'FAILED'`, set `can_reupload: true`
- Textract not available in af-south-1 → cross-region invocation (document bytes only, no PII stored)

### 7.5 Verifications Lambda (`naleko-{env}-verifications`)

| Method | Path | Action | Authorization |
|--------|------|--------|--------------|
| `GET` | `/verifications` | List all verifications | `hr_staff` group |
| `GET` | `/verifications/{verificationId}` | Get verification detail | `hr_staff` group |
| `PATCH` | `/verifications/{verificationId}/decision` | Approve/reject manually | `hr_staff` group |

**Business Logic:**
- `PATCH /verifications/{id}/decision`:
  - Request body: `{ "decision": "PASSED" | "FAILED", "notes": "..." }`
  - Update Verification table
  - Update corresponding Document table record (`verification_decision`, `verification_reasoning`)
  - If all documents for employee are PASSED → update Employee `stage` to `VERIFIED`
  - Log to audit table

### 7.6 External Verification Lambda (`naleko-{env}-external-verification`)

| Method | Path | Action | Authorization |
|--------|------|--------|--------------|
| `POST` | `/verifications/external` | Trigger VerifyNow or AVS check | `hr_staff` group |

**Request:**
```json
{
  "document_id": "doc_123",
  "document_type": "NATIONAL_ID",
  "employee_id": "EMP-0000011"
}
```

**VerifyNow Integration (Identity — National ID):**
- Read extracted `id_number` from Document table
- Call VerifyNow API: verify SA ID number against Home Affairs database
- Response: match/no-match + confidence score
- Update Verification table with `verification_source: 'EXTERNAL_VERIFYNOW'`

**AVS Integration (Bank Account):**
- Read extracted `account_number`, `branch_code`, `account_holder` from Document table
- Call AVS API: verify bank account ownership
- Response: match/no-match + account status
- Update Verification table with `verification_source: 'EXTERNAL_AVS'`

**Secrets:** VerifyNow and AVS API keys stored in AWS Secrets Manager: `naleko/{env}/verifynow-api-key`, `naleko/{env}/avs-api-key`

### 7.7 Cases Lambda (`naleko-{env}-cases`)

| Method | Path | Action | Authorization |
|--------|------|--------|--------------|
| `POST` | `/cases` | Create new case | Matching `employee` |
| `GET` | `/cases` | List cases | `hr_staff` (all) or matching `employee` (own) |
| `GET` | `/cases/{caseId}` | Get case detail | `hr_staff` or case owner |
| `PATCH` | `/cases/{caseId}` | Update case (status, assign, resolve) | `hr_staff` group |

**Create Case Flow:**
```
Employee submits Contact HR form
  → POST /cases with { subject, category, description, priority, attachment? }
  → Generate case_id: CASE-{7 digits}
  → Set status: OPEN, assigned_to: UNASSIGNED
  → Auto-assign based on department (optional rule: Engineering → specific HR partner)
  → If attachment provided: generate presigned URL for upload, store s3_key
  → Send SES notification to assigned HR staff (or HR queue email)
  → Return case_id to frontend for confirmation display
  → Log to audit table
```

### 7.8 Auth Triggers Lambda (`naleko-{env}-auth-triggers`)

**Cognito Trigger Events:**

| Trigger | Purpose |
|---------|---------|
| `PostConfirmation` | After employee first login: update Employee table with Cognito `sub`, set stage from INVITED → DOCUMENTS |
| `PreTokenGeneration` | Add custom claims to tokens: `custom:staff_id`, `custom:employee_id`, department |
| `CustomMessage` | Customize invitation/verification email templates with Naleko branding |

### 7.9 Notifications Lambda (`naleko-{env}-notifications`)

**Trigger:** DynamoDB Streams on Employee, Document, and Case tables (filtered by specific event patterns), or EventBridge scheduled events.

**Notification Events:**

| Event | Trigger | Action |
|-------|---------|--------|
| Employee created | Employee table INSERT | Send invitation email to employee (SES) |
| Document uploaded | Document table INSERT | Notify assigned HR staff |
| OCR complete (manual review) | Document table UPDATE (ocr_status → MANUAL_REVIEW) | Notify HR staff with document link |
| Verification approved/rejected | Verification table UPDATE | Notify employee of document status |
| Case created | Case table INSERT | Notify assigned HR staff |
| Case resolved | Case table UPDATE (status → RESOLVED) | Notify employee |
| Stage changed | Employee table UPDATE (stage field) | Notify employee of onboarding progress |

### 7.10 WhatsApp Lambda (`naleko-{env}-whatsapp`)

**Routes handled:**

| Method | Path | Action | Authorization |
|--------|------|--------|--------------|
| `POST` | `/onboarding/invite` | Generate magic link token + send WhatsApp template message | `hr_staff` group |
| `GET` | `/onboarding/validate-token/{token}` | Validate magic link, issue session JWT | None (token-based) |
| `POST` | `/webhooks/whatsapp` | Receive Meta webhook callbacks (delivery status, incoming messages) | None (webhook signature verification) |

**Send Invite Flow (`POST /onboarding/invite`):**

```typescript
// Request body:
{
  "employee_id": "EMP-0000019",
  "phone": "+27831234567"          // SA format, required
}

// Processing:
// 1. Verify employee exists and stage is INVITED or DOCUMENTS
// 2. Rate limit: max 3 active (unexpired, unused) tokens per employee
// 3. Generate UUID v4 token
// 4. Write to Onboarding Token table:
//    { token, employee_id, phone, created_by: JWT staff_id, expires_at: now+15min, is_used: false }
// 5. Build magic link: https://onboard.naleko.co.za?token={token}
// 6. Call Meta Cloud API:
//    POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
//    Headers: { Authorization: "Bearer {WHATSAPP_ACCESS_TOKEN}" }
//    Body: {
//      messaging_product: "whatsapp",
//      to: "+27831234567",
//      type: "template",
//      template: {
//        name: "naleko_onboarding_invite",
//        language: { code: "en" },
//        components: [
//          { type: "body", parameters: [{ type: "text", text: "Thabo" }] },
//          { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: token }] }
//        ]
//      }
//    }
// 7. Store Meta message_id in token record
// 8. Update Employee table: whatsapp_invite_sent_at, whatsapp_invite_status: 'SENT'
// 9. Log to audit table

// Response:
{
  "status": "sent",
  "whatsapp_message_id": "wamid.xxxxxxxxx",
  "token_expires_at": "2026-04-01T10:15:00Z"
}
```

**Validate Token Flow (`GET /onboarding/validate-token/{token}`):**

```typescript
// Processing:
// 1. Look up token in Onboarding Token table
// 2. Validate:
//    - Token exists (not expired by DynamoDB TTL)
//    - is_used === false (single-use)
//    - expires_at > now (belt-and-suspenders, don't rely solely on TTL)
// 3. If invalid → 401 { error: "TOKEN_INVALID", message: "Link expired or already used" }
// 4. If valid:
//    a. Mark token as used: is_used=true, used_at=now, used_ip, used_user_agent
//    b. Look up employee record
//    c. Generate a short-lived session JWT (1 hour):
//       Claims: { employee_id, email, phone, scope: "onboarding_upload" }
//       Signed with a Lambda-managed secret (NOT Cognito — this is a lightweight session)
//    d. If employee stage is INVITED → advance to DOCUMENTS
//    e. Log to audit table
// 5. Return:
{
  "valid": true,
  "session_token": "eyJhbGciOiJIUzI1NiIs...",
  "employee": {
    "employee_id": "EMP-0000019",
    "first_name": "Thabo",
    "last_name": "Mokoena",
    "required_documents": ["NATIONAL_ID", "BANK_CONFIRMATION"]
  }
}
```

**Webhook Handler (`POST /webhooks/whatsapp`):**

```typescript
// Meta sends webhooks for message status updates
// Verification: GET request with hub.verify_token on first subscription
// Status updates: POST with entry[].changes[].value.statuses[]

// Processing:
// 1. Verify webhook signature (X-Hub-Signature-256 header with HMAC-SHA256)
// 2. Parse status updates: sent → delivered → read → failed
// 3. Look up token record by whatsapp_message_id
// 4. Update message_status in Onboarding Token table
// 5. If status === 'failed':
//    a. Update Employee table: whatsapp_invite_status = 'FAILED'
//    b. Notify HR staff (SES or in-app notification)
// 6. Return 200 OK (Meta requires quick response)
```

**Environment Variables (WhatsApp-specific):**

| Variable | Description |
|----------|-------------|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta phone number ID for sending messages |
| `WHATSAPP_ACCESS_TOKEN_SECRET_ARN` | Secrets Manager ARN for permanent access token |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Static token for Meta webhook subscription verification |
| `WHATSAPP_APP_SECRET` | Meta app secret for webhook signature verification |
| `ONBOARDING_TOKEN_TABLE` | DynamoDB table name: `naleko-{env}-onboarding-tokens` |
| `ONBOARDING_PWA_URL` | Base URL: `https://onboard.naleko.co.za` |
| `ONBOARDING_JWT_SECRET_ARN` | Secrets Manager ARN for signing onboarding session JWTs |

---

## 8. API Gateway REST Endpoints

### 8.1 API Configuration

```
API Name:          naleko-{env}-api
Type:              REST API (not HTTP API — need more control)
Endpoint Type:     REGIONAL (af-south-1)
Stage:             dev, staging, prod
Authorization:     Cognito User Pool Authorizer on all routes (except health check, onboarding token validation, and WhatsApp webhook)
CORS:              Allowed origins: frontend domain(s), methods: GET/POST/PUT/PATCH/DELETE, headers: Authorization/Content-Type
Throttling:        Default: 1000 rps steady, 2000 burst
```

### 8.2 Complete Endpoint Map

| Method | Path | Lambda | Auth | Description |
|--------|------|--------|------|-------------|
| `GET` | `/health` | — (mock integration) | None | Health check |
| — | — | **Employees** | — | — |
| `POST` | `/employees` | `employees` | `hr_staff` | Create new employee |
| `GET` | `/employees` | `employees` | `hr_staff` | List employees (query: staffId, stage, department) |
| `GET` | `/employees/{employeeId}` | `employees` | `hr_staff` or `employee` | Get employee profile |
| `PATCH` | `/employees/{employeeId}` | `employees` | `hr_staff` | Update employee |
| `GET` | `/employees/search` | `employees` | `hr_staff` | Search by email (query: email) |
| `PATCH` | `/employees/{employeeId}/consent` | `employees` | `employee` | Record POPIA consent |
| — | — | **Documents** | — | — |
| `POST` | `/documents/upload-url` | `documents` | `hr_staff` or `employee` | Get presigned upload URL |
| `GET` | `/employees/{employeeId}/documents` | `documents` | `hr_staff` or `employee` | List employee documents |
| `GET` | `/documents/{documentId}` | `documents` | `hr_staff` or `employee` | Get document detail |
| `GET` | `/documents/{documentId}/status` | `documents` | `hr_staff` or `employee` | Poll OCR status |
| `PATCH` | `/documents/{documentId}/decision` | `documents` | `hr_staff` | Approve/reject document |
| — | — | **Verifications** | — | — |
| `GET` | `/verifications` | `verifications` | `hr_staff` | List all verifications |
| `GET` | `/verifications/{verificationId}` | `verifications` | `hr_staff` | Get verification detail |
| `PATCH` | `/verifications/{verificationId}/decision` | `verifications` | `hr_staff` | Approve/reject verification |
| `POST` | `/verifications/external` | `external-verification` | `hr_staff` | Trigger external check |
| — | — | **Cases** | — | — |
| `POST` | `/cases` | `cases` | `employee` | Create Contact HR case |
| `GET` | `/cases` | `cases` | `hr_staff` or `employee` | List cases |
| `GET` | `/cases/{caseId}` | `cases` | `hr_staff` or `employee` | Get case detail |
| `PATCH` | `/cases/{caseId}` | `cases` | `hr_staff` | Update case status |
| — | — | **Onboarding (WhatsApp)** | — | — |
| `POST` | `/onboarding/invite` | `whatsapp` | `hr_staff` | Send WhatsApp onboarding invitation with magic link |
| `GET` | `/onboarding/validate-token/{token}` | `whatsapp` | None (token-based) | Validate magic link token, return session JWT + employee context |
| `POST` | `/webhooks/whatsapp` | `whatsapp` | None (signature verified) | Meta Cloud API webhook (delivery status, incoming messages) |

### 8.3 Standard Response Format

All Lambda functions return responses in **Lambda Proxy Integration** format:

**Success:**
```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"items\": [...], \"count\": 8}"
}
```

**Error:**
```json
{
  "statusCode": 400,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"error\": \"VALIDATION_ERROR\", \"message\": \"Email is required\", \"details\": [...]}"
}
```

**Standard Error Codes:**

| Status | Error Code | Meaning |
|--------|-----------|---------|
| 400 | `VALIDATION_ERROR` | Invalid request body/params |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT token |
| 403 | `FORBIDDEN` | User lacks permission for resource |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate (e.g., email already exists) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## 9. S3 Storage

### 9.1 Document Storage Bucket

```
Bucket Name:           naleko-{env}-documents
Region:                af-south-1
Versioning:            Enabled
Encryption:            SSE-S3 (AES-256) or SSE-KMS
Block Public Access:   ALL blocked (public access fully disabled)
Lifecycle:             Move to Glacier after 1 year, delete after 7 years
CORS:                  Allow PUT from frontend domain (for presigned URL uploads)
```

**Object Key Structure:**
```
{env}/{employee_id}/{document_type}/{filename}

Examples:
dev/EMP-0000011/NATIONAL_ID/sa_id_front.pdf
prod/EMP-0000011/BANK_CONFIRMATION/fnb_confirmation.pdf
dev/EMP-0000011/MATRIC_CERTIFICATE/matric_cert.pdf
```

**S3 Event Notifications:**
- `s3:ObjectCreated:*` → trigger `naleko-{env}-ocr-processor` Lambda (filtered by prefix `{env}/`)

**Access:**
- Lambda functions access via IAM role (read/write within function scope)
- Frontend uploads via presigned URLs (expires in 5 minutes, max 10MB)
- HR staff views documents via presigned GET URLs (generated by Lambda, expires in 15 minutes)

### 9.2 Frontend Hosting Bucket

```
Bucket Name:           naleko-{env}-frontend
Region:                af-south-1
Website Hosting:       Enabled (index.html, error 404 → index.html for SPA)
Versioning:            Disabled (build artifacts replaced on deploy)
Block Public Access:   Public read via CloudFront OAI (Origin Access Identity)
```

### 9.3 Case Attachment Bucket (Optional — or Reuse Documents Bucket)

Case attachments can be stored in the same documents bucket under a `cases/` prefix:
```
{env}/cases/{case_id}/{filename}
```

---

## 10. OCR Processing — Amazon Textract

### 10.1 Document Processing Strategy

| Document Type | Textract API | Confidence Threshold | Extracted Fields |
|--------------|-------------|---------------------|-----------------|
| `NATIONAL_ID` | `AnalyzeID` | 85% | id_number, full_name, date_of_birth, gender, citizenship |
| `BANK_CONFIRMATION` | `AnalyzeDocument` (Forms) | 80% | bank_name, account_number, account_holder, branch_code |
| `MATRIC_CERTIFICATE` | **None** — skip OCR | N/A | Manual review only |
| `TERTIARY_QUALIFICATION` | **None** — skip OCR | N/A | Manual review only |

### 10.2 OCR Processing Flow

```
S3 PUT event → OCR Lambda invoked

1. Read S3 event, extract: bucket, key, document_id (from key path)
2. Read Document table record to get document_type
3. If document_type not in [NATIONAL_ID, BANK_CONFIRMATION]:
     → Set ocr_status = MANUAL_REVIEW
     → Create Verification with decision = MANUAL_REVIEW, confidence = 0
     → EXIT
4. Download file bytes from S3

5a. If NATIONAL_ID:
   → Call textract.analyzeId({ DocumentPages: [{ Bytes: fileBytes }] })
   → Parse IdentityDocumentFields for:
      - DOCUMENT_NUMBER → id_number
      - FIRST_NAME, LAST_NAME → full_name
      - DATE_OF_BIRTH → date_of_birth
      - SEX → gender
      - COUNTRY → citizenship
   → Calculate average confidence across fields

5b. If BANK_CONFIRMATION:
   → Call textract.analyzeDocument({ Document: { Bytes: fileBytes }, FeatureTypes: ['FORMS'] })
   → Parse key-value pairs for:
      - "Bank" / "Bank Name" → bank_name
      - "Account Number" / "Account No" → account_number
      - "Account Holder" / "Account Name" → account_holder
      - "Branch Code" / "Branch" → branch_code
   → Calculate average confidence across fields

6. Determine decision:
   → If avgConfidence >= threshold → PASSED
   → If avgConfidence < threshold → MANUAL_REVIEW
   → If any critical field missing → MANUAL_REVIEW

7. Build reasoning string (human-readable explanation of what was found/missing)
8. Update Document table: ocr_status, ocr_result, ocr_completed_at, verification_decision, verification_reasoning
9. Create Verification table record
10. If MANUAL_REVIEW → send notification to HR queue
11. Log to audit table
```

### 10.3 Cross-Region Considerations

If Textract `AnalyzeID` is not available in `af-south-1`:

1. **Document bytes only** are sent to Textract in a supported region (e.g., `eu-west-1`)
2. **No PII is stored** outside af-south-1 — Textract processes bytes synchronously and returns results
3. **All results are stored** in DynamoDB/S3 in af-south-1 only
4. Document the cross-region data flow for POPIA compliance review

### 10.4 SA National ID Validation

After OCR extraction, validate the SA ID number format:
```
Format: YYMMDDSSSSCAZ
  YY    = Year of birth
  MM    = Month of birth
  DD    = Day of birth
  SSSS  = Gender (0000–4999 = Female, 5000–9999 = Male)
  C     = Citizenship (0 = SA citizen, 1 = Permanent resident)
  A     = Usually 8 (historically used)
  Z     = Luhn check digit
```

Implement Luhn checksum validation in the OCR processor Lambda to catch transcription errors.

---

## 11. External Verification Partners

### 11.1 VerifyNow — SA Identity Verification

| Setting | Value |
|---------|-------|
| **Purpose** | Verify SA ID number against Department of Home Affairs database |
| **Trigger** | HR staff clicks "Trigger External Verification" for NATIONAL_ID documents |
| **API** | RESTful HTTPS (details provided by VerifyNow) |
| **Authentication** | API key in request header |
| **Secret** | `naleko/{env}/verifynow-api-key` (Secrets Manager) |
| **Expected Response** | Match/No Match, confidence score, name comparison |
| **Timeout** | 30 seconds (some lookups are slow) |
| **Fallback** | If VerifyNow unavailable → mark as MANUAL_REVIEW, notify HR |

### 11.2 AVS — Account Verification Services

| Setting | Value |
|---------|-------|
| **Purpose** | Verify SA bank account ownership (account number + account holder name match) |
| **Trigger** | HR staff clicks "Trigger External Verification" for BANK_CONFIRMATION documents |
| **API** | RESTful HTTPS (details provided by AVS) |
| **Authentication** | API key + client certificate (TLS mutual auth) |
| **Secret** | `naleko/{env}/avs-api-key` + `naleko/{env}/avs-client-cert` (Secrets Manager) |
| **Expected Response** | Account exists (Y/N), name match (Y/N), account status (Open/Closed) |
| **Timeout** | 15 seconds |
| **Fallback** | If AVS unavailable → mark as MANUAL_REVIEW, notify HR |

### 11.3 External Verification Lambda Pattern

```typescript
// Simplified external verification handler
async function handleExternalVerification(event: APIGatewayProxyEvent) {
  const { document_id, document_type, employee_id } = JSON.parse(event.body);
  
  // 1. Read document from DB
  const document = await getDocument(document_id);
  
  // 2. Get API key from Secrets Manager
  const apiKey = await getSecret(`naleko/${ENV}/verifynow-api-key`);
  
  // 3. Call external API based on document type
  let result;
  if (document_type === 'NATIONAL_ID') {
    result = await callVerifyNow(document.ocr_result.id_number, apiKey);
  } else if (document_type === 'BANK_CONFIRMATION') {
    result = await callAVS(document.ocr_result, apiKey);
  }
  
  // 4. Update verification record
  await updateVerification(document.verification_id, {
    verification_source: document_type === 'NATIONAL_ID' ? 'EXTERNAL_VERIFYNOW' : 'EXTERNAL_AVS',
    decision: result.match ? 'PASSED' : 'FAILED',
    confidence: result.confidence,
    external_reference: result.reference_id,
    reasoning: buildExternalReasoningString(result),
  });
  
  // 5. Update document status
  await updateDocument(document_id, {
    verification_decision: result.match ? 'PASSED' : 'FAILED',
  });
  
  // 6. Check if all docs passed → advance employee stage
  await checkAndAdvanceStage(employee_id);
  
  return { statusCode: 200, body: JSON.stringify(result) };
}
```

---

## 12. Email Service — Amazon SES

> **Note:** With the WhatsApp onboarding channel, SES serves as a **secondary/fallback notification channel**. The primary employee invitation is sent via WhatsApp template message. SES is used for: (1) employees who haven’t opted into WhatsApp, (2) HR staff notifications, (3) status update emails, and (4) fallback if WhatsApp delivery fails.

### 12.1 SES Configuration

```
Region:                  af-south-1 (or eu-west-1 if SES not available in af-south-1)
Sending Domain:          naleko.co.za (verify with DNS)
From Address:            noreply@naleko.co.za
Reply-To:                hr@naleko.co.za
DKIM:                    Enabled (add CNAME records to DNS)
SPF:                     Include amazonses.com in DNS SPF record
Production Access:       Request SES production access (sandbox limits to verified emails only)
```

### 12.2 Email Templates

| Template | Trigger | Recipients | Content |
|----------|---------|-----------|---------|
| **Employee Invitation** | `POST /employees` (new employee created) | New employee's email | Welcome email with temporary password, portal link, required documents list. **Note:** If WhatsApp invite is sent, this becomes a supplementary notification rather than the primary invite |
| **Document Uploaded** | S3 upload event | Assigned HR staff | Employee name, document type, "review required" |
| **OCR Manual Review** | OCR processor → MANUAL_REVIEW | Assigned HR staff | Document details, confidence score, link to verification detail page |
| **Document Approved** | `PATCH /documents/{id}/decision` → PASSED | Employee's email | Document type approved, remaining steps |
| **Document Rejected** | `PATCH /documents/{id}/decision` → FAILED | Employee's email | Document type rejected, reason, instructions to re-upload |
| **Stage Change** | Employee `stage` updated | Employee's email | New stage, what to expect next |
| **Case Created** | `POST /cases` | Assigned HR staff | Case reference, category, priority, employee details |
| **Case Resolved** | `PATCH /cases/{id}` → RESOLVED | Employee's email | Resolution notes, case reference |

### 12.3 Template Variables

```
{{employeeName}}        - Employee full name
{{employeeEmail}}       - Employee email
{{portalUrl}}           - Front-end URL
{{documentType}}        - e.g., "National ID", "Bank Confirmation"
{{caseReference}}       - e.g., "CASE-0000042"
{{stageName}}           - e.g., "Document Upload", "Verification"
{{hrPartnerName}}       - Assigned HR staff name
```

---

## 13. Contact HR — Case Management

### 13.1 Feature Overview

A new system allowing employees to raise support cases (queries, issues, requests) directly to HR from within the portal. Cases flow into an HR queue and are managed to resolution.

### 13.2 Employee Flow (Frontend)

1. Employee clicks **"Contact HR"** button on their dashboard
2. Modal dialog with form:
   - **Subject** — free text
   - **Category** — dropdown: General Inquiry, Document Issue, Onboarding Question, Other
   - **Description** — textarea (min 20 chars)
   - **Priority** — Low / Medium (default) / High
   - **Attachment** — optional file upload (max 10MB, PDF/JPG/PNG)
3. Submit → `POST /cases`
4. Confirmation with case reference number: "Your case CASE-0000042 has been submitted"

### 13.3 HR Staff View (Frontend — New Feature)

This will need to be added to the HR dashboard:

- New sidebar nav item: "Cases" → `/hr/:staffId/cases`
- Case list table: Case ID, Employee Name, Category, Priority (tag: Low=grey, Medium=amber, High=red), Status, Created
- Case detail view: Full case details, employee info, attachment viewer, resolution form
- Status workflow: OPEN → IN_PROGRESS → RESOLVED → CLOSED
- Resolution form: Notes textarea + status change dropdown

### 13.4 Auto-Assignment Rules

When a case is created:
1. Check employee's `department`
2. Look up department → HR partner mapping (stored in a config table or environment variable):
   ```json
   {
     "Engineering": "staff_id_for_engineering_hr",
     "Finance": "staff_id_for_finance_hr",
     "default": "staff_id_for_general_hr"
   }
   ```
3. Set `assigned_to` to the mapped HR staff member
4. If no mapping found → set to `UNASSIGNED` (appears in general queue)

### 13.5 Backend Implementation

- **DynamoDB table:** `naleko-{env}-cases` (see Section 6.4)
- **Lambda:** `naleko-{env}-cases` (see Section 7.7)
- **SES notifications:** Case created → HR staff, Case resolved → Employee
- **Attachment:** Stored in S3 under `{env}/cases/{case_id}/{filename}`

---

## 14. POPIA & GDPR Compliance

### 14.1 Data Residency

| Requirement | Implementation |
|------------|---------------|
| All personal data in South Africa | All resources in `af-south-1` (Cape Town) |
| No cross-border data transfer | Textract cross-region uses bytes-only (no PII stored outside SA) |
| Data encryption at rest | DynamoDB SSE (KMS), S3 SSE-S3 or SSE-KMS |
| Data encryption in transit | TLS 1.2+ on all endpoints, HTTPS only |

### 14.2 Consent Tracking

| Requirement | Implementation |
|------------|---------------|
| Record consent before processing | POPIA consent gate in frontend → `PATCH /employees/{id}/consent` |
| Record timestamp | `popia_consent_at` field in Employee table |
| Record IP address | `popia_consent_ip` field (from `X-Forwarded-For` header) |
| Consent must be explicit | Checkbox + "I Accept" button (already built in frontend) |
| Withdrawal mechanism | Future: endpoint to withdraw consent + data deletion flow |

### 14.3 Data Subject Rights

| Right | Implementation |
|-------|---------------|
| **Access** | Employee can view all their own data via the portal |
| **Correction** | Future: employee self-edit profile (not yet built) |
| **Deletion** | Future: data deletion workflow (all DynamoDB records + S3 files for employee) |
| **Portability** | Future: export all employee data as JSON/CSV |

### 14.4 Audit Trail

- **Audit Log table** (Section 6.5) records all data operations
- Every Lambda writes to audit log: who did what, when, from where
- 90-day retention via DynamoDB TTL
- For POPIA investigations: query by `actor_id` (GSI1) to reconstruct full activity history

### 14.5 Data Retention Policy

| Data Type | Retention | Action After Expiry |
|-----------|----------|-------------------|
| Employee PII | Duration of employment + 5 years | Archive to Glacier, then delete |
| Documents (S3) | 1 year hot, then Glacier | Delete after 7 years (configurable) |
| Verification records | Duration of employment + 5 years | Archive then delete |
| Audit logs | 90 days (DynamoDB TTL) | Auto-deleted |
| Cases | 2 years after resolution | Archive then delete |
| Onboarding tokens | 15 minutes (DynamoDB TTL) | Auto-deleted (tokens are ephemeral) |
| WhatsApp message metadata | Duration of employment + 5 years | Stored in token table and Employee table |

### 14.6 Security Controls for POPIA

- **Minimum necessary data:** Only collect fields required for onboarding
- **Access control:** Cognito groups + Lambda authorization = HR sees managed employees only, Employees see own data only
- **Encryption:** At rest (KMS) + in transit (TLS 1.2+)
- **Logging:** CloudWatch + audit table for all access
- **Breach notification:** CloudWatch alarms on suspicious activity → SNS → security team (24-hour POPIA notification window)

### 14.7 WhatsApp Data Residency Considerations

| Concern | Detail | Mitigation |
|---------|--------|------------|
| **Meta data processing** | WhatsApp Cloud API messages are processed by Meta’s infrastructure. As of 2025, South Africa is **not confirmed** as a local storage region for WhatsApp Cloud API | Minimize PII in template messages. Only include first name + magic link URL. No ID numbers, bank details, or sensitive data in WhatsApp messages |
| **Message content storage** | Meta retains message metadata (timestamps, phone numbers, delivery status) on their servers | Document this in POPIA data flow mapping. Include Meta as a data processor in privacy assessment |
| **Template message content** | Template messages are stored by Meta for approval and sending | Ensure templates contain no sensitive PII beyond first name |
| **Phone number as PII** | Employee phone numbers are shared with Meta for message delivery | Include WhatsApp phone number sharing in employee consent form. Record as specific consent item |
| **Legal review required** | POPIA §72 (transborder information flows) may apply since Meta processes data internationally | Engage legal team to assess: (1) Is Meta a “responsible party” or “operator”? (2) Does Meta’s DPA cover POPIA requirements? (3) Is explicit employee consent sufficient? |

---

## 15. Infrastructure as Code

### 15.1 Tool Selection

**Use Terraform** (recommended) or CloudFormation. **NOT Amplify** — it is not available in af-south-1.

### 15.2 Terraform Project Structure

```
infrastructure/
├── main.tf                    # Provider config, backend config
├── variables.tf               # Input variables (env, region, etc.)
├── outputs.tf                 # Stack outputs (API URL, bucket names, etc.)
├── terraform.tfvars           # Environment-specific values
│
├── modules/
│   ├── cognito/
│   │   ├── main.tf            # User pool, groups, app client, triggers
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── dynamodb/
│   │   ├── main.tf            # All 5 tables + GSIs
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── lambda/
│   │   ├── main.tf            # All 8 Lambda functions + IAM roles
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── api-gateway/
│   │   ├── main.tf            # REST API, resources, methods, authorizer, CORS
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── s3/
│   │   ├── main.tf            # Documents bucket, frontend bucket, lifecycle, CORS
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── cloudfront/
│   │   ├── main.tf            # Distribution, OAI, SSL cert, SPA error pages
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── ses/
│   │   ├── main.tf            # Domain verification, email templates
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   └── monitoring/
│       ├── main.tf            # CloudWatch logs, alarms, dashboards
│       ├── variables.tf
│       └── outputs.tf
│
├── environments/
│   ├── dev.tfvars
│   ├── staging.tfvars
│   └── prod.tfvars
│
└── lambda-src/                # Lambda source code (TypeScript)
    ├── package.json
    ├── tsconfig.json
    ├── shared/                # Shared utilities (DynamoDB client, response builders)
    │   ├── dynamodb.ts
    │   ├── response.ts
    │   ├── auth.ts
    │   └── validation.ts
    ├── employees/
    │   └── handler.ts
    ├── documents/
    │   └── handler.ts
    ├── ocr-processor/
    │   └── handler.ts
    ├── verifications/
    │   └── handler.ts
    ├── external-verification/
    │   └── handler.ts
    ├── cases/
    │   └── handler.ts
    ├── notifications/
    │   └── handler.ts
    └── auth-triggers/
        └── handler.ts
```

### 15.3 Provider Configuration

```hcl
terraform {
  required_version = ">= 1.5"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket         = "naleko-terraform-state"
    key            = "hr-portal/terraform.tfstate"
    region         = "af-south-1"
    dynamodb_table = "naleko-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = "af-south-1"
  
  default_tags {
    tags = {
      Project     = "naleko-hr-portal"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
```

### 15.4 Naming Convention

All resources follow: `naleko-{env}-{resource-name}`

| Resource | Dev | Staging | Prod |
|----------|-----|---------|------|
| DynamoDB | naleko-dev-employees | naleko-staging-employees | naleko-prod-employees |
| Lambda | naleko-dev-employees | naleko-staging-employees | naleko-prod-employees |
| S3 | naleko-dev-documents | naleko-staging-documents | naleko-prod-documents |
| Cognito | naleko-dev-user-pool | naleko-staging-user-pool | naleko-prod-user-pool |

---

## 16. Environment Configuration

### 16.1 Environment Variables (Per Lambda)

| Variable | Description | Example |
|----------|-------------|---------|
| `ENVIRONMENT` | Environment name | `dev`, `staging`, `prod` |
| `REGION` | AWS region | `af-south-1` |
| `EMPLOYEE_TABLE` | DynamoDB Employee table name | `naleko-dev-employees` |
| `DOCUMENT_TABLE` | DynamoDB Document table name | `naleko-dev-documents` |
| `VERIFICATION_TABLE` | DynamoDB Verification table name | `naleko-dev-verifications` |
| `CASE_TABLE` | DynamoDB Case table name | `naleko-dev-cases` |
| `AUDIT_TABLE` | DynamoDB Audit Log table name | `naleko-dev-audit-log` |
| `DOCUMENT_BUCKET` | S3 document bucket name | `naleko-dev-documents` |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID | `af-south-1_XXXXXXXXX` |
| `VERIFYNOW_SECRET_ARN` | Secrets Manager ARN for VerifyNow API key | `arn:aws:secretsmanager:af-south-1:...` |
| `AVS_SECRET_ARN` | Secrets Manager ARN for AVS API key | `arn:aws:secretsmanager:af-south-1:...` |
| `SES_FROM_EMAIL` | SES sender email | `noreply@naleko.co.za` |
| `FRONTEND_URL` | Frontend domain (for emails) | `https://portal.naleko.co.za` |
| `OCR_CONFIDENCE_THRESHOLD_ID` | Textract confidence threshold for National ID | `85` |
| `OCR_CONFIDENCE_THRESHOLD_BANK` | Textract confidence threshold for Bank docs | `80` |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp phone number ID | `123456789012345` |
| `WHATSAPP_ACCESS_TOKEN_SECRET_ARN` | Secrets Manager ARN for WhatsApp permanent access token | `arn:aws:secretsmanager:af-south-1:...` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Static token for Meta webhook subscription | (random string) |
| `WHATSAPP_APP_SECRET` | Meta app secret for webhook HMAC verification | `arn:aws:secretsmanager:af-south-1:...` |
| `ONBOARDING_TOKEN_TABLE` | DynamoDB Onboarding Token table name | `naleko-dev-onboarding-tokens` |
| `ONBOARDING_PWA_URL` | Base URL for onboarding PWA | `https://onboard.naleko.co.za` |
| `ONBOARDING_JWT_SECRET_ARN` | Secrets Manager ARN for onboarding session JWT signing key | `arn:aws:secretsmanager:af-south-1:...` |

### 16.2 Frontend Environment Files

Create `src/environments/environment.ts` (dev):
```typescript
export const environment = {
  production: false,
  apiUrl: 'https://{dev-api-id}.execute-api.af-south-1.amazonaws.com/dev',
  cognito: {
    userPoolId: 'af-south-1_XXXXXXXXX',
    clientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
    region: 'af-south-1',
    domain: 'naleko-dev.auth.af-south-1.amazoncognito.com',
  },
  s3: {
    documentBucket: 'naleko-dev-documents',
    region: 'af-south-1',
  },
};
```

Create `src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.naleko.co.za',  // CloudFront/API Gateway custom domain
  cognito: {
    userPoolId: 'af-south-1_YYYYYYYYY',
    clientId: 'yyyyyyyyyyyyyyyyyyyyyyyyyy',
    region: 'af-south-1',
    domain: 'auth.naleko.co.za',
  },
  s3: {
    documentBucket: 'naleko-prod-documents',
    region: 'af-south-1',
  },
};
```

Add `fileReplacements` in `angular.json` under `production` configuration:
```json
"fileReplacements": [
  {
    "replace": "src/environments/environment.ts",
    "with": "src/environments/environment.prod.ts"
  }
]
```

### 16.3 Secrets (Secrets Manager)

| Secret Name | Content | Rotated |
|------------|---------|---------|
| `naleko/{env}/verifynow-api-key` | VerifyNow API key | Quarterly |
| `naleko/{env}/avs-api-key` | AVS API key | Quarterly |
| `naleko/{env}/avs-client-cert` | AVS TLS client certificate + key | Annually |
| `naleko/{env}/whatsapp-access-token` | Meta WhatsApp Cloud API permanent access token (System User token) | Manually (when regenerated in Meta Business Suite) |
| `naleko/{env}/whatsapp-app-secret` | Meta app secret for webhook signature verification | Manually (when app is recreated) |
| `naleko/{env}/onboarding-jwt-secret` | HMAC secret for signing onboarding session JWTs | Quarterly |

---

## 17. CI/CD Pipeline

### 17.1 Pipeline Architecture

```
GitHub (obsydian-tech/hr-portal)
  │
  ├── develop branch ──→ GitHub Actions ──→ Deploy to DEV
  ├── staging branch ──→ GitHub Actions ──→ Deploy to STAGING
  └── main branch    ──→ GitHub Actions ──→ Deploy to PROD (manual approval)
```

### 17.2 GitHub Actions Workflows

**Frontend Pipeline** (`.github/workflows/frontend.yml`):

```yaml
name: Frontend CI/CD

on:
  push:
    branches: [develop, staging, main]
    paths: ['src/**', 'angular.json', 'package.json']

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      
      - run: npm ci
      - run: npm run build -- --configuration=${{ env.ANGULAR_ENV }}
      # Future: npm run test -- --watch=false --browsers=ChromeHeadless
      # Future: npm run lint
      
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: af-south-1
      
      - run: aws s3 sync dist/hr-portal/browser s3://naleko-${{ env.ENV }}-frontend --delete
      - run: aws cloudfront create-invalidation --distribution-id ${{ env.CF_DIST_ID }} --paths "/*"
    
    env:
      ENV: ${{ github.ref == 'refs/heads/main' && 'prod' || github.ref == 'refs/heads/staging' && 'staging' || 'dev' }}
      ANGULAR_ENV: ${{ github.ref == 'refs/heads/main' && 'production' || 'development' }}
```

**Backend Pipeline** (`.github/workflows/backend.yml`):

```yaml
name: Backend CI/CD

on:
  push:
    branches: [develop, staging, main]
    paths: ['infrastructure/**', 'lambda-src/**']

jobs:
  deploy-infrastructure:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      
      # Build Lambda TypeScript → JavaScript
      - run: cd infrastructure/lambda-src && npm ci && npm run build
      
      # Terraform plan + apply
      - run: |
          cd infrastructure
          terraform init
          terraform plan -var-file=environments/${{ env.ENV }}.tfvars -out=plan.tfplan
          terraform apply plan.tfplan
    
    env:
      ENV: ${{ github.ref == 'refs/heads/main' && 'prod' || github.ref == 'refs/heads/staging' && 'staging' || 'dev' }}
```

### 17.3 Branch Strategy

| Branch | Environment | Auto-Deploy | Notes |
|--------|------------|-------------|-------|
| `develop` | DEV | ✅ Yes | Feature development, rapid iteration |
| `staging` | STAGING | ✅ Yes | QA/UAT testing, mirrors production |
| `main` | PROD | ⚠️ Manual approval | Production release, requires PR approval |

### 17.4 Pre-Deploy Checklist

Before each production deploy:
- [ ] All tests passing (once tests exist)
- [ ] POPIA compliance review for any new data fields
- [ ] API contract matches frontend expectations
- [ ] CloudWatch dashboard reviewed for current errors
- [ ] Terraform plan reviewed for unexpected resource changes
- [ ] Rollback plan documented

---

## 18. Monitoring & Logging

### 18.1 CloudWatch Log Groups

| Log Group | Source | Retention |
|-----------|--------|-----------|
| `/aws/lambda/naleko-{env}-employees` | Employees Lambda | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-documents` | Documents Lambda | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-ocr-processor` | OCR Lambda | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-verifications` | Verifications Lambda | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-external-verification` | External Verification Lambda | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-cases` | Cases Lambda | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-notifications` | Notifications Lambda | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-auth-triggers` | Cognito triggers | 30 days (dev), 90 days (prod) |
| `/aws/lambda/naleko-{env}-whatsapp` | WhatsApp Lambda | 30 days (dev), 90 days (prod) |
| `/aws/apigateway/naleko-{env}-api` | API Gateway access logs | 30 days (dev), 90 days (prod) |

### 18.2 CloudWatch Alarms

| Alarm | Metric | Threshold | Action |
|-------|--------|----------|--------|
| Lambda errors (any function) | Errors count | > 5 in 5 minutes | SNS → team Slack/email |
| Lambda duration (OCR processor) | Duration p99 | > 45s (of 60s timeout) | SNS → team |
| API Gateway 5XX | 5XXError count | > 10 in 5 minutes | SNS → team |
| API Gateway 4XX | 4XXError count | > 100 in 5 minutes | SNS → team (possible attack) |
| DynamoDB throttling | ThrottledRequests | > 0 | SNS → team (increase capacity) |
| S3 bucket size | BucketSizeBytes | > 50GB | SNS → review lifecycle policies |
| Cognito failed logins | FailedSignInAttempts | > 20 in 5 minutes | SNS → security team (possible brute force) |

### 18.3 CloudWatch Dashboard

Create a dashboard `naleko-{env}-hr-portal` with:
- Lambda invocation counts (per function)
- Lambda error rates (per function)
- API Gateway request/response latency (p50, p95, p99)
- DynamoDB consumed read/write capacity
- S3 object count and bucket size
- Active Cognito users (daily/weekly)

### 18.4 Structured Logging Pattern

All Lambda functions should use structured JSON logging:

```typescript
const log = (level: string, message: string, data: Record<string, any>) => {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    environment: process.env.ENVIRONMENT,
    function: process.env.AWS_LAMBDA_FUNCTION_NAME,
    requestId: context.awsRequestId,
    ...data,
  }));
};

// Usage:
log('INFO', 'Employee created', { employee_id: 'EMP-0000019', created_by: 'AS00001' });
log('ERROR', 'Textract failed', { document_id: 'doc_123', error: err.message });
```

---

## 19. Security

### 19.1 IAM — Least Privilege

Each Lambda function gets its own IAM execution role with **minimum required permissions**:

| Lambda | DynamoDB | S3 | Textract | SES | Secrets Manager | Cognito |
|--------|---------|-----|---------|-----|----------------|---------|
| employees | Employee table (RW), Audit (W) | — | — | — | — | AdminCreateUser, AdminAddUserToGroup |
| documents | Document table (RW), Employee table (R), Audit (W) | Documents bucket (RW) | — | — | — | — |
| ocr-processor | Document table (RW), Verification table (W), Audit (W) | Documents bucket (R) | AnalyzeID, AnalyzeDocument | — | — | — |
| verifications | Verification table (RW), Document table (RW), Employee table (RW), Audit (W) | — | — | — | — | — |
| external-verification | Verification table (RW), Document table (RW), Audit (W) | — | — | — | VerifyNow key (R), AVS key (R) | — |
| cases | Case table (RW), Audit (W) | Documents bucket (RW, cases/ prefix only) | — | — | — | — |
| notifications | Employee table (R) | — | — | SendEmail | — | — |
| auth-triggers | Employee table (RW) | — | — | — | — | — |
| whatsapp | Onboarding Token table (RW), Employee table (RW), Audit (W) | — | — | — | WhatsApp token (R), JWT secret (R), App secret (R) | — |

### 19.2 API Security

| Layer | Protection |
|-------|-----------|
| **API Gateway** | Cognito Authorizer on all routes (except `/health`) |
| **WAF** | AWS WAF v2 on API Gateway: rate limiting, SQL injection, XSS patterns, geo-restriction (optional: SA only) |
| **CORS** | Restricted to frontend domain(s) only |
| **Throttling** | Per-client rate limiting via API Gateway usage plans |
| **Input validation** | Lambda-level validation on all request bodies (use `zod` or `joi`) |

### 19.3 Data Protection

| Protection | Implementation |
|-----------|---------------|
| **Encryption at rest** | DynamoDB: SSE with AWS-managed KMS, S3: SSE-S3 or SSE-KMS |
| **Encryption in transit** | TLS 1.2+ enforced on API Gateway, CloudFront, S3 |
| **S3 access** | Block all public access, use presigned URLs (time-limited) |
| **Secrets** | Stored in Secrets Manager, never in environment variables or code |
| **PII masking** | CloudWatch logs must NOT log: ID numbers, bank account numbers, full names in error messages. Use masked format: `****1234` |

### 19.4 Network Security

- **VPC:** Lambda functions do NOT need VPC access (all AWS services accessed via public endpoints with IAM)
- **S3 VPC Endpoint:** Consider adding Gateway VPC Endpoint for S3 if Lambdas are placed in VPC later
- **CloudFront:** HTTPS only, redirect HTTP → HTTPS, TLSv1.2_2021 minimum
- **Custom domain:** Use ACM certificate for `*.naleko.co.za` (must be in us-east-1 for CloudFront)

---

## 20. Frontend Integration Points Reference

Quick reference for the DevOps engineer to understand **exactly what the frontend expects** from the backend.

### 20.1 Frontend Service Files to Update

| File | Change Required |
|------|----------------|
| `src/app/app.config.ts` | Add `provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))` |
| `src/environments/environment.ts` | **Create** — API URL, Cognito config, S3 config |
| `src/environments/environment.prod.ts` | **Create** — production values |
| `src/app/core/services/hr-api.service.ts` | Inject `HttpClient`, replace all mock `of().pipe(delay())` with real HTTP calls |
| `src/app/core/services/document-upload.service.ts` | Replace mock upload with presigned URL flow |
| `src/app/core/services/auth.service.ts` | **Create** — Cognito login/logout/token management |
| `src/app/core/interceptors/auth.interceptor.ts` | **Create** — attach JWT to Authorization header |
| `src/app/core/interceptors/error.interceptor.ts` | **Create** — handle 401/403/500 globally |
| `src/app/core/guards/auth.guard.ts` | **Create** — protect authenticated routes |
| `src/app/core/guards/hr-staff.guard.ts` | **Create** — protect HR routes |
| `src/app/core/guards/employee.guard.ts` | **Create** — protect employee routes + data isolation |

### 20.2 Expected API Response Formats

The frontend TypeScript interfaces (in `src/app/shared/models/employee.model.ts`) define the **exact JSON shape** expected from every API endpoint. The backend must return responses matching these interfaces:

| Interface | Used By | Endpoint |
|-----------|---------|----------|
| `EmployeeListResponse` | HR Dashboard Home | `GET /employees` |
| `Employee` | Employee Detail, New Registration | `GET /employees/{id}`, `POST /employees` |
| `EmployeeDocumentResponse` | Employee Detail, Document Review | `GET /employees/{id}/documents` |
| `EmployeeDocument` | Document Cards | Part of `EmployeeDocumentResponse` |
| `VerificationListResponse` | Verifications List | `GET /verifications` |
| `VerificationDetail` | Verification Detail | `GET /verifications/{id}` |
| `CreateEmployeeRequest` | Registration Wizard | `POST /employees` request body |

### 20.3 Critical Notes for Backend Engineer

1. **Start with authentication** — everything depends on Cognito being set up
2. **Create environment files first** — the frontend cannot call any API without `environment.apiUrl`
3. **Match interface signatures exactly** — use the TypeScript interfaces in `employee.model.ts` as the API contract
4. **`employee_id` format** — `EMP-{7 digits zero-padded}` (e.g., `EMP-0000019`)
5. **`verification_id` format** — `ver_{timestamp}` (milliseconds)
6. **`document_id` format** — `doc_{timestamp}` (milliseconds)
7. **`case_id` format** — `CASE-{7 digits zero-padded}` (e.g., `CASE-0000001`)
8. **Date format** — all dates as ISO 8601 strings (never epoch timestamps in responses)
9. **CORS** — API Gateway must allow `Authorization` and `Content-Type` headers from the frontend domain
10. **Presigned URLs** — document download URLs must be generated per-request (15 min TTL) — never store permanent S3 URLs in DynamoDB
11. **Onboarding PWA CORS** — API Gateway must also allow the onboarding PWA domain (`onboard.naleko.co.za`) in CORS origins
12. **WhatsApp webhook** — `/webhooks/whatsapp` must NOT have Cognito authorizer — Meta sends unsigned GET for verification and HMAC-signed POST for events

---

## 21. WhatsApp Integration — Cloud API

> **Full architecture details:** See the companion document `WHATSAPP-ONBOARDING-ARCHITECTURE.md` for detailed implementation guide, sequence diagrams, template specifications, and POC checklist.

### 21.1 Overview

WhatsApp is used as the **primary mobile onboarding channel** for Naleko. Instead of email-based invitations, HR staff send a WhatsApp message containing a magic link that opens a lightweight PWA where employees upload their onboarding documents directly from their phone's camera.

**Why WhatsApp:**
- 97% smartphone penetration in South Africa uses WhatsApp
- Employees are more likely to respond to WhatsApp than email
- Camera-first document upload is natural on mobile
- Delivery confirmation (sent → delivered → read) gives HR visibility

**API Choice:** Meta WhatsApp **Cloud API** (hosted by Meta) — not AWS End User Messaging Social, not On-Premises API (deprecated October 2025).

### 21.2 Integration Architecture

| Component | Implementation |
|-----------|---------------|
| **Message sending** | Lambda → Meta Graph API `POST /v25.0/{PHONE_NUMBER_ID}/messages` |
| **Authentication** | System User permanent access token stored in Secrets Manager |
| **Message format** | Utility template with named parameters + dynamic URL CTA button |
| **Token system** | DynamoDB table with TTL (15 min), single-use, rate-limited (3 per employee) |
| **Session auth** | Lambda-signed JWT (not Cognito) with `onboarding_upload` scope |
| **Webhook** | API Gateway endpoint receiving Meta delivery status callbacks |
| **PWA** | Separate Angular 19 standalone app, own S3+CloudFront, own domain |

### 21.3 Meta Business Platform Setup

**POC (Test Mode):**
1. Create Meta Developer account → Create Business App → Add WhatsApp product
2. Meta auto-provisions test WABA + test phone number
3. Test with pre-approved `hello_world` template (250 unique recipients/24hr)
4. Time: ~30 minutes to first sent message

**Production:**
1. Complete Meta Business Verification (company docs required)
2. Add payment method (credit card or prepaid)
3. Register a real phone number (dedicated SIM or port existing)
4. Submit custom template `naleko_onboarding_invite` for approval (~24 hours)
5. Request messaging limit increase: 250 → 1K → 10K → 100K (automatic based on quality)

### 21.4 Template Specification

```
Template Name:     naleko_onboarding_invite
Category:          UTILITY (transactional — not marketing)
Language:          en
Header:            None
Body:              "Hi {{1}}, welcome to Naleko Digital Solutions! Please complete your onboarding documents. Tap the button below to get started."
Footer:            None
Button:            CTA → URL → https://onboard.naleko.co.za?token={{1}}
```

**Parameter mapping:**
- Body `{{1}}` = employee first name
- Button URL `{{1}}` = magic link token (appended to base URL)

### 21.5 Cost Estimate (WhatsApp Cloud API)

| Tier | Utility Conversation (ZAR) | Monthly Volume | Monthly Cost |
|------|---------------------------|---------------|--------------|
| POC | Free (1,000 free conversations/month) | < 100 | R 0 |
| Small | ~R 0.35 per conversation | 500 | ~R 175 |
| Medium | ~R 0.35 per conversation | 1,000 | ~R 350 |
| Large | ~R 0.35 per conversation | 5,000 | ~R 1,750 |

> **Note:** Pricing is per 24-hour conversation window, not per message. A utility template opens a conversation window. Meta provides 1,000 free utility conversations per month.

### 21.6 Terraform Resources Required

| Resource | Purpose |
|----------|---------|
| `aws_dynamodb_table.onboarding_tokens` | Token storage with TTL |
| `aws_lambda_function.whatsapp` | Send messages, validate tokens, handle webhooks |
| `aws_iam_role.whatsapp_lambda` | Execution role with DynamoDB + Secrets Manager access |
| `aws_api_gateway_resource.onboarding_*` | API routes for invite, validate, webhook |
| `aws_secretsmanager_secret.whatsapp_*` | WhatsApp access token, app secret, JWT signing key |
| `aws_s3_bucket.onboarding_pwa` | PWA static hosting |
| `aws_cloudfront_distribution.onboarding_pwa` | CDN for PWA (separate from main portal) |
| `aws_route53_record.onboard` | DNS: `onboard.naleko.co.za` → CloudFront |

### 21.7 Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Token brute force | UUID v4 = 2^122 possibilities. Rate limit validation endpoint (10 attempts/minute per IP) |
| Token replay | Single-use enforcement (`is_used` flag) + 15-minute TTL |
| Webhook spoofing | Verify `X-Hub-Signature-256` HMAC header with app secret |
| PII in WhatsApp messages | Only first name in template body. No ID numbers, bank details, or document content |
| Access token exposure | Stored in Secrets Manager, never in environment variables or Lambda code |
| Session JWT scope | Onboarding JWT has limited scope (`onboarding_upload`) — cannot access HR endpoints |

---

*End of AWS Backend Requirements — HR Portal, Naleko Digital Solutions*  
*Document Version 1.1 — 31 March 2026 — Obsydian Technologies*
