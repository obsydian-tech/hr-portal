# WhatsApp Onboarding Architecture — Naleko Digital Solutions

**Version:** 1.0 | **Last Updated:** 31 March 2026 | **Platform:** Naleko HR Portal — Mobile Onboarding Channel  
**Target Audience:** Full-Stack / Backend Engineer implementing WhatsApp integration  
**Companion Document:** `HR-PORTAL-AWS-BACKEND.md` (Sections 6.6, 7.10, 8.2, 21)  
**Company:** Naleko Digital Solutions — *"Verifying people, building trust."*

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Sequence Diagram — End-to-End Flow](#3-sequence-diagram--end-to-end-flow)
4. [WhatsApp Cloud API Setup](#4-whatsapp-cloud-api-setup)
5. [Message Templates](#5-message-templates)
6. [Magic Link Token System](#6-magic-link-token-system)
7. [WhatsApp Lambda Function](#7-whatsapp-lambda-function)
8. [API Endpoints (WhatsApp-Specific)](#8-api-endpoints-whatsapp-specific)
9. [Separate PWA Application](#9-separate-pwa-application)
10. [PWA ↔ Backend Integration](#10-pwa--backend-integration)
11. [POC vs Production Path](#11-poc-vs-production-path)
12. [POPIA Considerations for WhatsApp](#12-popia-considerations-for-whatsapp)
13. [Cost Estimate](#13-cost-estimate)
14. [POC Implementation Checklist](#14-poc-implementation-checklist)

---

## 1. Overview

### What This Document Covers

This document details the **WhatsApp-based mobile onboarding channel** for Naleko's HR Portal. It covers everything needed to implement the flow where:

1. **HR staff** triggers a WhatsApp invitation from the HR Portal
2. **Employee** receives a WhatsApp message with a magic link on their phone
3. **Employee** taps the link → opens a lightweight PWA in their mobile browser
4. **Employee** uploads identity and banking documents using their phone camera
5. **Backend** processes documents through the same OCR + verification pipeline
6. **HR staff** reviews and approves documents in the existing HR Portal

### What This Document Does NOT Cover

- The main HR Portal Angular 19 application (see `HR-PORTAL-FRONTEND-GUIDE.md`)
- AWS backend infrastructure outside of WhatsApp-specific components (see `HR-PORTAL-AWS-BACKEND.md`)
- Cognito authentication (the WhatsApp flow uses magic link tokens, not Cognito)

### Design Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| WhatsApp API | **Meta Cloud API** (direct) | Simpler, cheaper, fewer moving parts than AWS End User Messaging Social. No infrastructure to manage. |
| PWA deployment | **Separate standalone project** | Smaller bundle for 3G/LTE mobile. Decoupled from main portal release cycle. |
| Employee auth | **Magic link → session JWT** (no password) | Employees never create a password for mobile uploads. Token validates identity. |
| POC scope | **Document upload + OCR only** | Core value proposition first. Onboarding videos and full journey deferred. |
| Video hosting | **Placeholder** (deferred) | Will decide on Loom/Vimeo/S3 after POC validation. |
| On-Premises API | **NOT USED** | Meta deprecated the On-Premises API in October 2025. It is no longer available. |

### Relationship to Main Backend

The WhatsApp channel is an **additional entry point** to the same backend. It uses:

- ✅ Same API Gateway (additional routes)
- ✅ Same DynamoDB tables (Employee, Document, Verification)
- ✅ Same S3 document bucket (same presigned URL flow)
- ✅ Same Textract OCR pipeline (triggered by S3 events)
- ✅ Same verification workflow (HR reviews in same portal)
- ➕ New DynamoDB table: `naleko-{env}-onboarding-tokens`
- ➕ New Lambda function: `naleko-{env}-whatsapp`
- ➕ New S3 bucket + CloudFront: PWA hosting
- ➕ New external dependency: Meta WhatsApp Cloud API

---

## 2. Architecture Diagram

### Full System View (WhatsApp Channel Highlighted)

```
                                    ┌──────────────────────┐
                                    │     HR PORTAL        │
                                    │   (Angular 19 SPA)   │
                                    │   Desktop Browser    │
                                    └──────────┬───────────┘
                                               │
                                    HR clicks "Send WhatsApp Invite"
                                               │
                                               ▼
┌──────────────────┐          ┌────────────────────────────────┐
│   Meta WhatsApp  │◄─────────│       API GATEWAY              │
│   Cloud API      │  HTTP    │   naleko-{env}-api             │
│  graph.facebook  │          │                                │
│  .com/v25.0/...  │          │  POST /onboarding/invite       │
│                  │─────┐    │  GET  /onboarding/validate/... │
└──────────────────┘     │    │  POST /webhooks/whatsapp       │
         │               │    │  POST /documents/upload-url    │
         │ Template msg  │    └────────────┬───────────────────┘
         │ with CTA      │                 │
         ▼               │                 ▼
┌──────────────────┐     │    ┌────────────────────────────────┐
│  Employee's      │     │    │       LAMBDA FUNCTIONS         │
│  WhatsApp        │     │    │                                │
│  (Mobile Phone)  │     │    │  naleko-{env}-whatsapp         │
│                  │     │    │  naleko-{env}-documents         │
└────────┬─────────┘     │    │  naleko-{env}-ocr-processor    │
         │               │    └────────────┬───────────────────┘
    Taps CTA button      │                 │
         │               │    ┌────────────┼──────────────────┐
         ▼               │    │            │                  │
┌──────────────────┐     │    ▼            ▼                  ▼
│  ONBOARDING PWA  │     │ ┌────────┐  ┌────────┐    ┌──────────┐
│  (Angular 19)    │     │ │DynamoDB│  │DynamoDB│    │ S3 Docs  │
│  Separate App    │     │ │Tokens  │  │Employees│   │ Bucket   │
│  Mobile Browser  │     │ └────────┘  │Documents│   └────┬─────┘
│  onboard.naleko  │     │             │Verific. │        │
│  .co.za          │     │             └────────┘   ┌────┴─────┐
└──────────────────┘     │                          │ Textract │
                         │  Webhook                 │ (OCR)    │
                         │  (delivery status)       └──────────┘
                         │
                         └──── POST /webhooks/whatsapp
```

---

## 3. Sequence Diagram — End-to-End Flow

### Phase 1: HR Triggers Invitation

```
Step  Actor              Action
────  ─────              ──────
1.    HR Staff           Opens Employee detail in HR Portal, clicks "Send WhatsApp Invite"
2.    HR Portal          POST /onboarding/invite { employee_id: "EMP-0000019", phone: "+27831234567" }
3.    WhatsApp Lambda    Validates employee exists, stage is INVITED or DOCUMENTS
4.    WhatsApp Lambda    Checks rate limit: max 3 active (unused, unexpired) tokens per employee
5.    WhatsApp Lambda    Generates UUID v4 token
6.    WhatsApp Lambda    Writes to Onboarding Token table:
                           PK: token
                           employee_id: "EMP-0000019"
                           phone: "+27831234567"
                           created_by: "AS00001" (from JWT)
                           is_used: false
                           expires_at: now + 15 minutes (epoch)
7.    WhatsApp Lambda    Builds magic link: https://onboard.naleko.co.za?token={token}
8.    WhatsApp Lambda    POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
                           Authorization: Bearer {SYSTEM_USER_TOKEN}
                           Body: template message with CTA button
9.    Meta Cloud API     Returns { messages: [{ id: "wamid.xxx" }] }
10.   WhatsApp Lambda    Stores whatsapp_message_id in token record
11.   WhatsApp Lambda    Updates Employee table: whatsapp_invite_sent_at, whatsapp_invite_status: "SENT"
12.   WhatsApp Lambda    Writes audit log: WHATSAPP_INVITE_SENT
13.   WhatsApp Lambda    Returns to HR Portal: { status: "sent", whatsapp_message_id, token_expires_at }
14.   HR Portal          Shows success toast: "WhatsApp invitation sent to +27 83 *** **67"
```

### Phase 2: Employee Opens Magic Link

```
Step  Actor              Action
────  ─────              ──────
15.   Meta               Delivers WhatsApp message to employee's phone
16.   Meta               Sends webhook: POST /webhooks/whatsapp (status: "delivered")
17.   WhatsApp Lambda    Updates token record: message_status = "DELIVERED"
18.   Employee           Reads WhatsApp message, taps "Complete Onboarding" CTA button
19.   Meta               Sends webhook: POST /webhooks/whatsapp (status: "read")
20.   Mobile Browser     Opens https://onboard.naleko.co.za?token={token}
21.   Onboarding PWA     Extracts token from URL query parameter
22.   Onboarding PWA     GET /onboarding/validate-token/{token}
23.   WhatsApp Lambda    Looks up token in DynamoDB
24.   WhatsApp Lambda    Validates: exists? not expired? is_used === false?
25.   WhatsApp Lambda    Marks token as used: is_used=true, used_at, used_ip, used_user_agent
26.   WhatsApp Lambda    Generates session JWT (1 hour, scope: "onboarding_upload"):
                           { employee_id, email, phone, scope, exp }
27.   WhatsApp Lambda    Advances employee stage: INVITED → DOCUMENTS (if applicable)
28.   WhatsApp Lambda    Returns: { valid: true, session_token, employee: { id, name, required_documents } }
29.   Onboarding PWA     Stores session JWT in memory, shows document upload screen
```

### Phase 3: Document Upload

```
Step  Actor              Action
────  ─────              ──────
30.   Employee           Taps "Capture National ID" → phone camera opens
31.   Onboarding PWA     Uses <input type="file" accept="image/*" capture="environment">
32.   Employee           Takes photo of SA ID document
33.   Onboarding PWA     POST /documents/upload-url (with session JWT in Authorization header)
                           { employee_id, document_type: "NATIONAL_ID", file_name, content_type }
34.   Documents Lambda   Validates session JWT (scope: "onboarding_upload", employee_id matches)
35.   Documents Lambda   Returns presigned S3 upload URL (5 min expiry)
36.   Onboarding PWA     PUT {presignedUrl} — uploads image directly to S3
37.   S3                 Object created event → triggers OCR Lambda
38.   OCR Lambda         Textract AnalyzeID → extracts fields → writes results
39.   Onboarding PWA     Shows progress indicator, polls GET /documents/{docId}/status
40.   OCR Lambda         Updates Document table: ocr_status, ocr_result, verification_decision
41.   Onboarding PWA     Receives status update, shows result (✓ or "Under Review")
42.   Employee           Repeats steps 30-41 for BANK_CONFIRMATION document
43.   Onboarding PWA     All required documents uploaded → shows "Thank you" confirmation
```

### Phase 4: HR Review (Same as Desktop Flow)

```
Step  Actor              Action
────  ─────              ──────
44.   HR Staff           Sees new documents in Verification queue (existing HR Portal)
45.   HR Staff           Reviews OCR results + original document side-by-side
46.   HR Staff           Approves or rejects each document
47.   Backend            If all documents PASSED → updates employee stage to VERIFIED
48.   Notifications      Sends status update (SES email or future WhatsApp notification)
```

---

## 4. WhatsApp Cloud API Setup

### 4.1 Prerequisites

| Requirement | Detail |
|------------|--------|
| Meta Developer Account | Register at [developers.facebook.com](https://developers.facebook.com) |
| Meta Business Account | Associated with Naleko Digital Solutions |
| Business App | Create app with "Business" type, add WhatsApp product |
| System User | Create in Meta Business Suite → Settings → Users → System Users |

### 4.2 POC Setup (Under 30 Minutes)

```
1. Go to developers.facebook.com → Create App → Business → WhatsApp
2. Meta auto-provisions:
   - Test WABA (WhatsApp Business Account)
   - Test phone number (Meta-owned, cannot receive messages)
   - Temporary access token (24 hours)
   - Pre-approved "hello_world" template
3. Add up to 5 test recipient phone numbers (must verify via OTP code)
4. Send first test message using API Explorer or cURL

Test limitations:
  - 250 unique recipients in 24-hour rolling window
  - Cannot receive inbound messages on test number
  - Temporary token expires in 24 hours (use System User token for permanence)
  - Only pre-approved templates available until custom templates submitted
```

### 4.3 System User Token (Permanent)

```
Meta Business Suite → Settings → Users → System Users
  → Create System User (Admin role)
  → Add Assets: WhatsApp Business Account → Full Control
  → Generate Token:
     - App: Naleko HR Portal
     - Token expiration: Never
     - Permissions: whatsapp_business_messaging, whatsapp_business_management
  → Copy and store in AWS Secrets Manager: naleko/{env}/whatsapp-access-token
```

> **⚠️ Critical:** System User tokens do not expire but MUST be stored in Secrets Manager, never in environment variables, Lambda code, or git. Rotate by generating a new token and updating the secret.

### 4.4 Webhook Setup

```
Meta Developer Dashboard → WhatsApp → Configuration → Webhook
  1. Callback URL: https://api.naleko.co.za/webhooks/whatsapp
  2. Verify Token: (random string, same as WHATSAPP_WEBHOOK_VERIFY_TOKEN env var)
  3. Subscribe to fields: "messages" (includes statuses)
  
Meta sends GET request with:
  - hub.mode = "subscribe"
  - hub.verify_token = (your verify token)
  - hub.challenge = (random string)

Your Lambda must respond with hub.challenge value (200 OK, body = challenge string)
```

### 4.5 API Reference

**Base URL:** `https://graph.facebook.com/v25.0`

**Send Template Message:**
```
POST /{PHONE_NUMBER_ID}/messages
Authorization: Bearer {SYSTEM_USER_TOKEN}
Content-Type: application/json
```

**Check Phone Number Status:**
```
GET /{PHONE_NUMBER_ID}
Authorization: Bearer {SYSTEM_USER_TOKEN}
```

**Get Message Templates:**
```
GET /{WABA_ID}/message_templates
Authorization: Bearer {SYSTEM_USER_TOKEN}
```

**Rate Limits:**
- 80 messages per second (default)
- 250 unique recipients per 24 hours (test tier)
- Production: auto-scales 250 → 1K → 10K → 100K based on quality rating

---

## 5. Message Templates

### 5.1 Template: `naleko_onboarding_invite`

**Category:** UTILITY (transactional — not marketing, no opt-in required beyond initial consent)

**Template Content:**
```
Header:    (none)
Body:      Hi {{1}}, welcome to Naleko Digital Solutions! 
           Please complete your onboarding documents.
           Tap the button below to get started.
Footer:    (none)
Buttons:   [CTA] "Complete Onboarding" → URL: https://onboard.naleko.co.za?token={{1}}
```

**Parameter Mapping:**

| Component | Parameter | Source | Example Value |
|-----------|-----------|--------|---------------|
| Body | `{{1}}` | `employee.first_name` | `Thabo` |
| Button URL | `{{1}}` | Generated token (UUID v4) | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |

### 5.2 Send Message API Call

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+27831234567",
  "type": "template",
  "template": {
    "name": "naleko_onboarding_invite",
    "language": {
      "code": "en"
    },
    "components": [
      {
        "type": "body",
        "parameters": [
          {
            "type": "text",
            "text": "Thabo"
          }
        ]
      },
      {
        "type": "button",
        "sub_type": "url",
        "index": 0,
        "parameters": [
          {
            "type": "text",
            "text": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
          }
        ]
      }
    ]
  }
}
```

### 5.3 Template Approval Process

1. Submit template via Meta Business Suite → WhatsApp → Message Templates → Create
2. Meta reviews within ~24 hours (typically faster)
3. Approval criteria:
   - No prohibited content (gambling, adult, weapons, etc.)
   - Utility category: must be transactional (onboarding invitation qualifies)
   - Dynamic URL button: base URL must match app domain
   - No misleading content
4. If rejected: Meta provides reason, modify and resubmit
5. Once approved: template is available across all associated phone numbers

### 5.4 POC Template (Before Custom Approval)

During POC, use the pre-approved `hello_world` template to test the end-to-end flow:

```json
{
  "messaging_product": "whatsapp",
  "to": "+27831234567",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": { "code": "en_US" }
  }
}
```

The `hello_world` template does NOT contain a CTA button, so during POC testing:
- Send the `hello_world` template to verify WhatsApp delivery works
- Test the magic link flow separately by navigating directly to the PWA URL with a token

---

## 6. Magic Link Token System

### 6.1 Token Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  CREATE   │────▶│  ACTIVE  │────▶│   USED   │     │ EXPIRED  │
│           │     │          │     │          │     │          │
│ HR sends  │     │ Waiting  │     │ Employee │     │ TTL hit  │
│ invite    │     │ for tap  │     │ tapped   │     │ (15 min) │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                       │                                  ▲
                       └──────── if not tapped ───────────┘
                                   (DynamoDB TTL deletes record)
```

### 6.2 DynamoDB Table Design

> Full schema in `HR-PORTAL-AWS-BACKEND.md` Section 6.6

```
Table:      naleko-{env}-onboarding-tokens
PK:         token (UUID v4)
TTL:        expires_at (epoch seconds, 15 minutes from creation)
GSI1:       employee_id + created_at (for audit + rate limiting)
```

**Key attributes:**
- `token` — UUID v4, cryptographically random (Python: `uuid.uuid4()`, Node: `crypto.randomUUID()`)
- `is_used` — boolean, starts `false`, set to `true` on first validation
- `expires_at` — epoch seconds, 15 minutes from creation
- `whatsapp_message_id` — Meta's message ID, used to correlate webhook status updates

### 6.3 Security Properties

| Property | Implementation |
|----------|---------------|
| **Unguessable** | UUID v4 = 122 bits of randomness (2^122 ≈ 5.3 × 10^36 possible values) |
| **Single-use** | `is_used` flag checked atomically using DynamoDB conditional write |
| **Time-limited** | 15-minute TTL — DynamoDB automatically deletes expired tokens |
| **Rate-limited** | Max 3 active tokens per employee (query GSI1, count where is_used=false AND expires_at > now) |
| **Audited** | All token operations logged to audit table |
| **No PII in URL** | Token is opaque UUID — no employee data encoded in the URL |

### 6.4 Token Validation (Atomic Single-Use)

```typescript
// DynamoDB conditional update to atomically mark token as used
const result = await dynamodb.update({
  TableName: ONBOARDING_TOKEN_TABLE,
  Key: { token: { S: tokenValue } },
  UpdateExpression: 'SET is_used = :true, used_at = :now, used_ip = :ip, used_user_agent = :ua',
  ConditionExpression: 'attribute_exists(token) AND is_used = :false AND expires_at > :now',
  ExpressionAttributeValues: {
    ':true': { BOOL: true },
    ':false': { BOOL: false },
    ':now': { S: new Date().toISOString() },  // used_at
    ':nowEpoch': { N: String(Math.floor(Date.now() / 1000)) },  // for expires_at comparison
    ':ip': { S: clientIp },
    ':ua': { S: userAgent },
  },
  ReturnValues: 'ALL_NEW',
}).promise();

// If ConditionExpression fails → token is invalid/expired/already used
// ConditionalCheckFailedException → return 401
```

### 6.5 Session JWT (Post-Validation)

After successful token validation, the Lambda signs a short-lived JWT:

```typescript
// JWT payload
{
  "sub": "EMP-0000019",
  "email": "thabo.mokoena@gmail.com",
  "phone": "+27831234567",
  "scope": "onboarding_upload",
  "iat": 1711900000,
  "exp": 1711903600  // 1 hour
}

// Signed with HMAC-SHA256 using secret from Secrets Manager
// NOT a Cognito token — this is a lightweight, Lambda-managed session
```

**Scope restrictions (`onboarding_upload`):**
- ✅ `POST /documents/upload-url` (own employee_id only)
- ✅ `GET /employees/{employeeId}/documents` (own employee_id only)
- ✅ `GET /documents/{documentId}/status` (own documents only)
- ❌ Cannot access any HR endpoints
- ❌ Cannot access other employees' data
- ❌ Cannot update employee profile
- ❌ Cannot create cases

---

## 7. WhatsApp Lambda Function

### 7.1 Function Specification

```
Function Name:     naleko-{env}-whatsapp
Runtime:           Node.js 20.x (arm64 / Graviton2)
Timeout:           15 seconds
Memory:            256 MB
Triggers:          API Gateway
```

### 7.2 Handler Routes

```typescript
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { httpMethod, resource } = event;
  
  switch (`${httpMethod} ${resource}`) {
    case 'POST /onboarding/invite':
      return handleSendInvite(event);       // Requires hr_staff JWT
    case 'GET /onboarding/validate-token/{token}':
      return handleValidateToken(event);     // No JWT required (token IS the auth)
    case 'GET /webhooks/whatsapp':
      return handleWebhookVerify(event);     // Meta subscription verification
    case 'POST /webhooks/whatsapp':
      return handleWebhookEvent(event);      // Meta delivery status callbacks
    default:
      return { statusCode: 404, body: JSON.stringify({ error: 'NOT_FOUND' }) };
  }
}
```

### 7.3 Send Invite Implementation

```typescript
async function handleSendInvite(event: APIGatewayProxyEvent) {
  // 1. Extract HR staff identity from Cognito JWT
  const staffId = event.requestContext.authorizer?.claims?.['custom:staff_id'];
  
  // 2. Parse and validate request body
  const { employee_id, phone } = JSON.parse(event.body!);
  // Validate: employee_id format, phone format (+27XXXXXXXXX)
  
  // 3. Verify employee exists and is in correct stage
  const employee = await getEmployee(employee_id);
  if (!employee) return error(404, 'EMPLOYEE_NOT_FOUND');
  if (!['INVITED', 'DOCUMENTS'].includes(employee.stage)) {
    return error(400, 'INVALID_STAGE', 'Employee must be in INVITED or DOCUMENTS stage');
  }
  
  // 4. Rate limit: max 3 active tokens
  const activeTokens = await countActiveTokens(employee_id);
  if (activeTokens >= 3) {
    return error(429, 'RATE_LIMITED', 'Maximum 3 active invitations. Wait for previous to expire.');
  }
  
  // 5. Generate token
  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + (15 * 60); // 15 minutes
  
  // 6. Store in DynamoDB
  await putToken({
    token,
    employee_id,
    phone,
    created_by: staffId,
    is_used: false,
    message_status: 'PENDING',
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  });
  
  // 7. Build magic link
  const magicLink = `${ONBOARDING_PWA_URL}?token=${token}`;
  
  // 8. Get WhatsApp access token from Secrets Manager
  const accessToken = await getSecret(WHATSAPP_ACCESS_TOKEN_SECRET_ARN);
  
  // 9. Send WhatsApp template message
  const response = await fetch(
    `https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: 'naleko_onboarding_invite',
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: employee.first_name }],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: 0,
              parameters: [{ type: 'text', text: token }],
            },
          ],
        },
      }),
    }
  );
  
  const result = await response.json();
  
  if (!response.ok) {
    // Log error, update token status
    await updateToken(token, { message_status: 'FAILED' });
    return error(502, 'WHATSAPP_SEND_FAILED', result.error?.message || 'Unknown error');
  }
  
  // 10. Store Meta message ID
  const messageId = result.messages[0].id;
  await updateToken(token, { whatsapp_message_id: messageId, message_status: 'SENT' });
  
  // 11. Update employee record
  await updateEmployee(employee_id, {
    whatsapp_invite_sent_at: new Date().toISOString(),
    whatsapp_invite_status: 'SENT',
  });
  
  // 12. Audit log
  await writeAuditLog({
    action: 'WHATSAPP_INVITE_SENT',
    actor_id: staffId,
    resource_type: 'employee',
    resource_id: employee_id,
    details: { phone: maskPhone(phone), whatsapp_message_id: messageId },
  });
  
  return success(200, {
    status: 'sent',
    whatsapp_message_id: messageId,
    token_expires_at: new Date(expiresAt * 1000).toISOString(),
  });
}
```

### 7.4 Webhook Handler Implementation

```typescript
// GET /webhooks/whatsapp — Meta subscription verification
async function handleWebhookVerify(event: APIGatewayProxyEvent) {
  const mode = event.queryStringParameters?.['hub.mode'];
  const token = event.queryStringParameters?.['hub.verify_token'];
  const challenge = event.queryStringParameters?.['hub.challenge'];
  
  if (mode === 'subscribe' && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    // Return JUST the challenge string (not JSON)
    return { statusCode: 200, body: challenge };
  }
  return { statusCode: 403, body: 'Verification failed' };
}

// POST /webhooks/whatsapp — Status updates + incoming messages
async function handleWebhookEvent(event: APIGatewayProxyEvent) {
  // 1. Verify signature
  const signature = event.headers['X-Hub-Signature-256'] || event.headers['x-hub-signature-256'];
  const appSecret = await getSecret(WHATSAPP_APP_SECRET_ARN);
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(event.body!)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    return { statusCode: 401, body: 'Invalid signature' };
  }
  
  // 2. Parse webhook payload
  const body = JSON.parse(event.body!);
  
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      
      // Process status updates
      for (const status of change.value.statuses || []) {
        // status.id = message ID, status.status = "sent"|"delivered"|"read"|"failed"
        await processStatusUpdate(status);
      }
      
      // Process incoming messages (employee replies) — log but don't respond for now
      for (const message of change.value.messages || []) {
        await logIncomingMessage(message);
      }
    }
  }
  
  // 3. Always return 200 quickly (Meta retries on non-2xx)
  return { statusCode: 200, body: 'OK' };
}

async function processStatusUpdate(status: { id: string; status: string; timestamp: string }) {
  // Find token by whatsapp_message_id
  // Note: Need to scan or maintain a GSI on whatsapp_message_id
  // For POC: scan is acceptable. For production: add GSI or use a lookup table.
  
  const statusMap: Record<string, string> = {
    'sent': 'SENT',
    'delivered': 'DELIVERED',
    'read': 'READ',
    'failed': 'FAILED',
  };
  
  const normalizedStatus = statusMap[status.status] || status.status.toUpperCase();
  
  // Update token record
  await updateTokenByMessageId(status.id, { message_status: normalizedStatus });
  
  // If failed, update employee record and optionally notify HR
  if (status.status === 'failed') {
    const token = await getTokenByMessageId(status.id);
    if (token) {
      await updateEmployee(token.employee_id, { whatsapp_invite_status: 'FAILED' });
      // TODO: Send SES notification to HR staff about failed WhatsApp delivery
    }
  }
}
```

### 7.5 IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:af-south-1:*:table/naleko-{env}-onboarding-tokens",
        "arn:aws:dynamodb:af-south-1:*:table/naleko-{env}-onboarding-tokens/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:af-south-1:*:table/naleko-{env}-employees"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:af-south-1:*:table/naleko-{env}-audit-log"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": [
        "arn:aws:secretsmanager:af-south-1:*:secret:naleko/{env}/whatsapp-*",
        "arn:aws:secretsmanager:af-south-1:*:secret:naleko/{env}/onboarding-jwt-secret-*"
      ]
    }
  ]
}
```

---

## 8. API Endpoints (WhatsApp-Specific)

### 8.1 POST /onboarding/invite

**Purpose:** HR staff sends WhatsApp onboarding invitation to employee

| Property | Value |
|----------|-------|
| **Auth** | Cognito JWT (`hr_staff` group required) |
| **Lambda** | `naleko-{env}-whatsapp` |
| **Rate Limit** | 10 requests/minute per staff member |

**Request:**
```json
{
  "employee_id": "EMP-0000019",
  "phone": "+27831234567"
}
```

**Success Response (200):**
```json
{
  "status": "sent",
  "whatsapp_message_id": "wamid.HBgNMjc4MzEyMzQ1Njc4FQIAERgSQjI5...",
  "token_expires_at": "2026-04-01T10:15:00.000Z"
}
```

**Error Responses:**

| Status | Error Code | When |
|--------|-----------|------|
| 400 | `VALIDATION_ERROR` | Missing/invalid employee_id or phone |
| 400 | `INVALID_STAGE` | Employee not in INVITED or DOCUMENTS stage |
| 404 | `EMPLOYEE_NOT_FOUND` | Employee ID doesn't exist |
| 429 | `RATE_LIMITED` | 3 active tokens already exist for this employee |
| 502 | `WHATSAPP_SEND_FAILED` | Meta API returned error |

### 8.2 GET /onboarding/validate-token/{token}

**Purpose:** Validate magic link token and issue session JWT

| Property | Value |
|----------|-------|
| **Auth** | None (the token IS the authentication) |
| **Lambda** | `naleko-{env}-whatsapp` |
| **Rate Limit** | 10 requests/minute per IP (prevent brute force) |

**Success Response (200):**
```json
{
  "valid": true,
  "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "employee": {
    "employee_id": "EMP-0000019",
    "first_name": "Thabo",
    "last_name": "Mokoena",
    "required_documents": ["NATIONAL_ID", "BANK_CONFIRMATION"]
  }
}
```

**Error Responses:**

| Status | Error Code | When |
|--------|-----------|------|
| 401 | `TOKEN_INVALID` | Token doesn't exist, already used, or expired |
| 429 | `RATE_LIMITED` | Too many validation attempts from this IP |

### 8.3 POST /webhooks/whatsapp

**Purpose:** Receive Meta Cloud API webhook callbacks

| Property | Value |
|----------|-------|
| **Auth** | None (Meta signature verification via `X-Hub-Signature-256`) |
| **Lambda** | `naleko-{env}-whatsapp` |
| **Note** | Must NOT have Cognito authorizer |

**GET variant (subscription verification):**
```
GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token={token}&hub.challenge={challenge}
→ Response: 200, body = challenge string (plain text, not JSON)
```

**POST variant (event notification):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "PHONE_NUMBER_ID" },
        "statuses": [{
          "id": "wamid.xxx",
          "status": "delivered",
          "timestamp": "1711900100",
          "recipient_id": "27831234567"
        }]
      },
      "field": "messages"
    }]
  }]
}
```

**Response:** Always `200 OK` (Meta retries on non-2xx responses)

---

## 9. Separate PWA Application

### 9.1 Why Separate

| Reason | Detail |
|--------|--------|
| **Bundle size** | Main HR Portal is ~2MB+ with PrimeNG, complex forms, dashboards. Employee only needs camera + upload → target < 200KB initial load |
| **Mobile-first** | PWA is designed exclusively for mobile browsers (3G/LTE), not desktop |
| **Release independence** | Can update PWA without touching main portal. Different deploy cadence |
| **Security isolation** | PWA uses onboarding JWTs, not Cognito tokens. Separate domain = separate cookie/storage scope |
| **PWA features** | Service worker for offline queuing, web manifest for "Add to Home Screen", camera access |

### 9.2 Project Structure

```
naleko-onboarding-pwa/
├── package.json                    # Standalone Angular 19 project
├── angular.json
├── tsconfig.json
├── ngsw-config.json                # Angular service worker config
│
├── src/
│   ├── index.html                  # Minimal shell, viewport meta for mobile
│   ├── manifest.webmanifest        # PWA manifest (Naleko branding)
│   ├── styles.scss                 # Minimal styles (no PrimeNG — too heavy)
│   │
│   ├── app/
│   │   ├── app.component.ts        # Root component with router-outlet
│   │   ├── app.config.ts           # Standalone config: provideHttpClient, provideRouter
│   │   ├── app.routes.ts           # Minimal routes (see below)
│   │   │
│   │   ├── pages/
│   │   │   ├── validate/           # Token validation + loading screen
│   │   │   │   └── validate.component.ts
│   │   │   ├── upload/             # Document capture + upload
│   │   │   │   └── upload.component.ts
│   │   │   ├── success/            # "Thank you" confirmation
│   │   │   │   └── success.component.ts
│   │   │   ├── expired/            # "Link expired" error
│   │   │   │   └── expired.component.ts
│   │   │   └── error/              # Generic error page
│   │   │       └── error.component.ts
│   │   │
│   │   ├── services/
│   │   │   ├── onboarding-api.service.ts    # HTTP calls to backend
│   │   │   └── session.service.ts           # JWT storage (in-memory)
│   │   │
│   │   └── interceptors/
│   │       └── auth.interceptor.ts          # Attach session JWT to requests
│   │
│   └── environments/
│       ├── environment.ts           # Dev API URL
│       └── environment.prod.ts      # Prod API URL
│
└── Dockerfile                      # (optional) for CI/CD build
```

### 9.3 Routes

```typescript
export const routes: Routes = [
  {
    path: '',
    component: ValidateComponent,  // Entry point: reads ?token= from URL, validates
  },
  {
    path: 'upload',
    component: UploadComponent,    // Document camera capture + upload
    canActivate: [sessionGuard],   // Requires valid session JWT
  },
  {
    path: 'success',
    component: SuccessComponent,   // "All documents uploaded" confirmation
  },
  {
    path: 'expired',
    component: ExpiredComponent,   // "Link expired or already used"
  },
  {
    path: 'error',
    component: ErrorComponent,     // Generic error with retry option
  },
  {
    path: '**',
    redirectTo: 'expired',
  },
];
```

### 9.4 Camera-First Document Capture

```html
<!-- upload.component.html -->
<div class="document-capture">
  <h2>Capture your {{ documentType }}</h2>
  <p>Position the document within the frame and tap capture</p>
  
  <!-- Mobile camera input -->
  <input 
    type="file" 
    accept="image/*" 
    capture="environment"
    (change)="onFileSelected($event)"
    #fileInput
    [hidden]="true"
  />
  
  <!-- Big, thumb-friendly capture button -->
  <button class="capture-btn" (click)="fileInput.click()">
    📷 Capture {{ documentType }}
  </button>
  
  <!-- Preview + retake -->
  @if (capturedImage) {
    <div class="preview">
      <img [src]="capturedImage" alt="Document preview" />
      <div class="actions">
        <button class="retake-btn" (click)="retake()">Retake</button>
        <button class="upload-btn" (click)="upload()">Upload</button>
      </div>
    </div>
  }
  
  <!-- Upload progress -->
  @if (uploading) {
    <div class="progress">
      <div class="progress-bar" [style.width.%]="uploadProgress"></div>
      <span>Uploading... {{ uploadProgress }}%</span>
    </div>
  }
</div>
```

**Key mobile considerations:**
- `capture="environment"` uses rear camera (for document photos)
- `accept="image/*"` accepts JPEG/PNG from camera
- Large touch targets (minimum 48x48px, recommended 64x64px)
- Progress indicator for slow 3G connections
- Offline queue: if upload fails, store locally and retry when connected

### 9.5 PWA Manifest

```json
{
  "name": "Naleko Onboarding",
  "short_name": "Naleko",
  "theme_color": "#1e3a5f",
  "background_color": "#ffffff",
  "display": "standalone",
  "scope": "/",
  "start_url": "/",
  "icons": [
    { "src": "assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 9.6 Deployment

```
S3 Bucket:         naleko-{env}-onboarding-pwa
CloudFront:        Separate distribution from main portal
Domain:            onboard.naleko.co.za (prod), onboard-dev.naleko.co.za (dev)
SSL:               ACM certificate for *.naleko.co.za (same wildcard)
SPA Routing:       404 → index.html (CloudFront custom error page)
Cache:             index.html: no-cache, assets: 1 year with hash-based filenames
```

**CI/CD:** Separate GitHub Actions workflow (or same repo, different path trigger):
```yaml
on:
  push:
    branches: [develop, main]
    paths: ['onboarding-pwa/**']

steps:
  - run: cd onboarding-pwa && npm ci && npm run build -- --configuration=${{ env.CONFIG }}
  - run: aws s3 sync dist/onboarding-pwa/browser s3://naleko-${{ env.ENV }}-onboarding-pwa --delete
  - run: aws cloudfront create-invalidation --distribution-id ${{ env.PWA_CF_DIST_ID }} --paths "/*"
```

---

## 10. PWA ↔ Backend Integration

### 10.1 Shared API Contract

The onboarding PWA uses the **same backend API Gateway** as the main HR Portal. The difference is authentication:

| Endpoint | Main Portal Auth | PWA Auth |
|----------|-----------------|----------|
| `POST /documents/upload-url` | Cognito JWT | Onboarding session JWT |
| `GET /employees/{id}/documents` | Cognito JWT | Onboarding session JWT |
| `GET /documents/{id}/status` | Cognito JWT | Onboarding session JWT |
| `GET /onboarding/validate-token/{token}` | N/A (not used) | None (token is auth) |

### 10.2 Dual Authentication in Documents Lambda

The Documents Lambda needs to accept BOTH Cognito tokens (from main portal) and onboarding session JWTs (from PWA):

```typescript
// In Documents Lambda authorization logic:
function extractAuth(event: APIGatewayProxyEvent) {
  const authHeader = event.headers.Authorization || event.headers.authorization;
  
  // Check if it's a Cognito token (validated by API Gateway authorizer)
  if (event.requestContext.authorizer?.claims) {
    return {
      type: 'cognito',
      employee_id: event.requestContext.authorizer.claims['custom:employee_id'],
      staff_id: event.requestContext.authorizer.claims['custom:staff_id'],
      groups: event.requestContext.authorizer.claims['cognito:groups'],
    };
  }
  
  // Check if it's an onboarding session JWT
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, ONBOARDING_JWT_SECRET);
      if (decoded.scope === 'onboarding_upload') {
        return {
          type: 'onboarding',
          employee_id: decoded.sub,
          scope: 'onboarding_upload',
        };
      }
    } catch (err) {
      // Invalid JWT — fall through to 401
    }
  }
  
  throw new UnauthorizedError();
}
```

**Important:** The API Gateway Cognito authorizer must be configured to **allow** the onboarding endpoints through without Cognito validation. Two approaches:

1. **Recommended:** Create specific API Gateway routes for PWA endpoints with NO authorizer, handle JWT validation in Lambda code
2. **Alternative:** Use a Lambda authorizer (custom) that accepts both Cognito tokens and onboarding JWTs

### 10.3 Upload Flow from PWA

```typescript
// onboarding-api.service.ts
@Injectable({ providedIn: 'root' })
export class OnboardingApiService {
  private http = inject(HttpClient);
  private session = inject(SessionService);
  
  async uploadDocument(file: File, documentType: string): Promise<void> {
    const employee = this.session.getEmployee();
    
    // 1. Get presigned URL
    const { upload_url, document_id } = await firstValueFrom(
      this.http.post<PresignedUrlResponse>(`${environment.apiUrl}/documents/upload-url`, {
        employee_id: employee.employee_id,
        document_type: documentType,
        file_name: file.name,
        content_type: file.type,
      })
    );
    
    // 2. Upload directly to S3
    await firstValueFrom(
      this.http.put(upload_url, file, {
        headers: { 'Content-Type': file.type },
        reportProgress: true,
        observe: 'events',
      }).pipe(
        tap(event => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
          }
        })
      )
    );
    
    // 3. Poll for OCR status
    await this.pollDocumentStatus(document_id);
  }
}
```

---

## 11. POC vs Production Path

### 11.1 POC Scope (Target: 2 Weeks)

**Goal:** Demonstrate end-to-end flow from WhatsApp message → document upload → OCR result

| Component | POC Implementation | Production Upgrade |
|-----------|-------------------|-------------------|
| **WhatsApp account** | Test WABA + test phone number | Business-verified WABA + dedicated phone number |
| **Template** | `hello_world` (no CTA button) + manual link testing | Custom `naleko_onboarding_invite` (approved) |
| **Recipients** | 5 verified test numbers | Any WhatsApp user |
| **Token table** | Same design (no changes needed) | Same design |
| **PWA** | Basic HTML/CSS, no service worker | Full Angular 19 PWA with offline support |
| **Domain** | `onboard-dev.naleko.co.za` | `onboard.naleko.co.za` |
| **Webhook** | Log to CloudWatch only | Full status tracking + HR notifications |
| **Access token** | Temporary (24hr) from API Explorer | System User permanent token |

### 11.2 POC Checklist

- [ ] Create Meta Developer account + Business App
- [ ] Note test phone number ID and temporary access token
- [ ] Create DynamoDB `naleko-dev-onboarding-tokens` table
- [ ] Deploy `naleko-dev-whatsapp` Lambda
- [ ] Create API Gateway routes: `/onboarding/invite`, `/onboarding/validate-token/{token}`
- [ ] Test send: `POST /onboarding/invite` → verify WhatsApp received on test phone
- [ ] Test validate: `GET /onboarding/validate-token/{token}` → verify JWT returned
- [ ] Build minimal PWA: validate page + upload page
- [ ] Deploy PWA to S3 + CloudFront (`onboard-dev.naleko.co.za`)
- [ ] End-to-end test: send invite → tap link → upload document → verify OCR processes
- [ ] Demo to stakeholders

### 11.3 Production Checklist

- [ ] Complete Meta Business Verification (company documents)
- [ ] Add payment method to Meta Business Account
- [ ] Register dedicated phone number for WhatsApp Business
- [ ] Submit custom template `naleko_onboarding_invite` for approval
- [ ] Generate System User permanent access token
- [ ] Store access token in Secrets Manager
- [ ] Set up webhook endpoint with signature verification
- [ ] Configure API Gateway WAF rules for webhook endpoint
- [ ] Build full PWA with service worker, offline support, camera optimizations
- [ ] Deploy PWA to production CloudFront distribution
- [ ] Set up DNS: `onboard.naleko.co.za` → CloudFront
- [ ] Load test: simulate 50 concurrent invitations
- [ ] POPIA legal review of WhatsApp data flow (see Section 12)
- [ ] Add WhatsApp consent checkbox to employee registration form
- [ ] Monitor Meta quality rating dashboard
- [ ] Document standard operating procedure for HR staff

### 11.4 Production Messaging Limits

Meta auto-scales messaging limits based on quality:

| Tier | Unique Recipients / 24hr | How to Reach |
|------|-------------------------|-------------|
| Tier 0 (Test) | 250 | Default for test phone |
| Tier 1 | 1,000 | After business verification |
| Tier 2 | 10,000 | After sustained quality (7+ days, quality: Green) |
| Tier 3 | 100,000 | After sustained quality (7+ days at Tier 2) |
| Unlimited | Unlimited | After sustained quality (7+ days at Tier 3) |

**Quality Rating** is based on:
- Template message read rates
- Block/report rates
- How quickly recipients respond or engage

> **For Naleko:** Even Tier 1 (1,000/day) is more than enough for an HR onboarding platform. Expect 10-50 new employees per month at normal growth.

---

## 12. POPIA Considerations for WhatsApp

### 12.1 Data Flow Mapping

```
Data Point              Stored Where                         POPIA Concern
───────────             ────────────                         ─────────────
Employee phone number   DynamoDB (Employee table, af-south-1) ✅ SA-resident
                        + Meta WhatsApp servers              ⚠️ International
Employee first name     WhatsApp template message content    ⚠️ International
Magic link token        WhatsApp message (URL)               ✅ Opaque, no PII
Message metadata        Meta servers (timestamps, status)     ⚠️ International
Document images         S3 af-south-1 (via PWA upload)       ✅ SA-resident
OCR results             DynamoDB af-south-1                  ✅ SA-resident
```

### 12.2 Key POPIA Concerns

| Concern | Risk Level | Mitigation |
|---------|-----------|-----------|
| **Phone number shared with Meta** | Medium | Required for WhatsApp delivery. Include in employee consent: "Your phone number will be shared with Meta (WhatsApp) for communication purposes." |
| **First name in message** | Low | Minimal PII. Only first name, no surname, ID number, or sensitive data. |
| **Meta data processing location** | Medium | Meta processes data internationally. South Africa is NOT confirmed as a local storage region for WhatsApp Cloud API as of 2025. |
| **POPIA §72 transborder transfer** | Medium | Legal review needed. Meta's Data Processing Agreement may satisfy POPIA requirements, but this needs confirmation. |
| **Employee consent** | Low | Add explicit WhatsApp consent during HR registration: checkbox + explanation of what data is shared. |

### 12.3 Required Consent Changes

Add to employee registration form (HR Portal):

```
☐ I consent to receive onboarding communications via WhatsApp.
  I understand that my phone number and first name will be shared 
  with Meta Platforms (WhatsApp) for message delivery. Messages 
  may be processed outside of South Africa.
```

**Backend changes:**
- Add `whatsapp_consent_at` (ISO datetime) to Employee table
- Add `whatsapp_consent_ip` (string) to Employee table  
- WhatsApp Lambda must verify `whatsapp_consent_at` is not null before sending

### 12.4 Recommendations for Legal Team

1. **Review Meta's Data Processing Agreement (DPA)** — Does it meet POPIA operator requirements?
2. **Assess POPIA §72 applicability** — Is the transborder transfer of phone number + first name permissible under:
   - §72(1)(a): consent of the data subject? (employee consents)
   - §72(1)(b): necessary for performance of a contract? (employment onboarding)
3. **Confirm Meta data retention** — How long does Meta retain message metadata? Can it be deleted?
4. **Document the data flow** — Include WhatsApp channel in the company's POPIA data flow register
5. **Update privacy policy** — Include WhatsApp as a communication channel in Naleko's privacy policy

---

## 13. Cost Estimate

### 13.1 WhatsApp Cloud API Pricing

Meta charges per **24-hour conversation window**, not per individual message. A utility template message opens a conversation window.

| Component | Price (ZAR, approximate) | Notes |
|-----------|-------------------------|-------|
| Utility conversation (ZA) | ~R 0.35 per conversation | Opens when template is sent |
| Free tier | 1,000 free utility conversations/month | Resets monthly |
| Meta platform fee | R 0 | No monthly subscription |
| Additional messages within window | R 0 | After opening, unlimited messages for 24hr |

### 13.2 Monthly Cost Projections

| Scenario | New Employees/Month | Invites/Employee (avg) | Total Conversations | Free Tier | Billable | Monthly Cost |
|----------|-------------------|----------------------|--------------------|-----------|---------|-----------:|
| **Startup** | 10 | 1.5 | 15 | -15 | 0 | **R 0** |
| **Small** | 50 | 1.5 | 75 | -75 | 0 | **R 0** |
| **Medium** | 200 | 1.5 | 300 | -300 | 0 | **R 0** |
| **Growth** | 500 | 1.5 | 750 | -750 | 0 | **R 0** |
| **Large** | 800 | 1.5 | 1,200 | -1,000 | 200 | **~R 70** |
| **Enterprise** | 2,000 | 1.5 | 3,000 | -1,000 | 2,000 | **~R 700** |

> **Key insight:** With 1,000 free conversations/month, Naleko likely pays R 0 for WhatsApp messaging unless onboarding more than ~660 employees per month (at 1.5 invites average).

### 13.3 AWS Infrastructure Costs (WhatsApp-Specific)

| Resource | Estimated Monthly Cost |
|----------|----------------------:|
| DynamoDB (Onboarding Tokens) — on-demand | ~R 5 (minimal reads/writes, TTL deletes) |
| Lambda (WhatsApp function) — 256MB | ~R 0 (within free tier for low volume) |
| S3 (PWA hosting) — static files | ~R 2 |
| CloudFront (PWA distribution) | ~R 15 (1GB transfer/month estimate) |
| Secrets Manager (3 secrets) | ~R 15 (R 5/secret/month) |
| **Total AWS (WhatsApp-specific)** | **~R 37/month** |

### 13.4 Total Monthly Cost

| Volume | WhatsApp API | AWS Infrastructure | **Total** |
|--------|-------------|-------------------|--------:|
| < 660 employees/month | R 0 | ~R 37 | **~R 37** |
| 1,000 employees/month | ~R 0 | ~R 37 | **~R 37** |
| 2,000 employees/month | ~R 700 | ~R 50 | **~R 750** |

---

## 14. POC Implementation Checklist

### Ordered Implementation Tasks (~2 Weeks)

**Week 1: Backend + WhatsApp**

| Day | Task | Deliverable |
|-----|------|------------|
| 1 | Create Meta Developer account, Business App, add WhatsApp product | Test WABA + phone number ID |
| 1 | Send `hello_world` template via cURL to verify setup | WhatsApp message received on test phone |
| 2 | Create DynamoDB `naleko-dev-onboarding-tokens` table with TTL | Table ready |
| 2 | Implement WhatsApp Lambda: `handleSendInvite` | Can generate token + call Meta API |
| 3 | Implement WhatsApp Lambda: `handleValidateToken` | Can validate token + return session JWT |
| 3 | Create API Gateway routes (no Cognito authorizer on validate + webhook) | Routes deployed |
| 4 | End-to-end test: send invite → receive WhatsApp → validate token | Token lifecycle working |
| 4 | Implement webhook handler (log-only for POC) | Meta status updates logged |
| 5 | Update Documents Lambda to accept onboarding session JWTs | Dual auth working |

**Week 2: PWA + Integration**

| Day | Task | Deliverable |
|-----|------|------------|
| 6 | Scaffold Angular 19 PWA project (`naleko-onboarding-pwa`) | Project structure ready |
| 6 | Build ValidateComponent: read token from URL, call validate API | Token validation UI working |
| 7 | Build UploadComponent: camera capture, presigned URL upload | Can capture + upload photo |
| 7 | Build SuccessComponent + ExpiredComponent | User-facing status pages |
| 8 | Deploy PWA to S3 + CloudFront (`onboard-dev.naleko.co.za`) | PWA accessible via URL |
| 8 | Full end-to-end test with real phone | Complete flow verified |
| 9 | Fix bugs, add error handling, improve mobile UX | Polish |
| 10 | Demo to stakeholders, document findings | POC complete |

### Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| WhatsApp delivery | Message delivered to at least 4/5 test phones within 30 seconds |
| Magic link validation | Token validated and session JWT returned in < 2 seconds |
| Document upload | Photo captured and uploaded to S3 in < 10 seconds on 4G |
| OCR processing | Textract returns results within 30 seconds of upload |
| End-to-end time | From WhatsApp tap to "all documents uploaded" in < 5 minutes |
| Mobile experience | PWA loads in < 3 seconds on 4G, usable on 360px wide screens |

---

*End of WhatsApp Onboarding Architecture — Naleko Digital Solutions*  
*Document Version 1.0 — 31 March 2026 — Obsydian Technologies*
