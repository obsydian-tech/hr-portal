import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { withIdempotency } from './shared/idempotency.mjs';
import { hrOnly, listHrMembers, toPartner } from '../shared/hr-group.mjs';
import { validateEmployee } from '../shared/employee-input.mjs';
import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { KMSClient, EncryptCommand } from "@aws-sdk/client-kms";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { randomUUID } from "crypto";
import { issueInvite } from '../shared/invite.mjs';
import { isRobotEmail, isRobotCaller } from '../shared/ai-guard.mjs';
import postmark from "postmark";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient();
const cognito = new CognitoIdentityProviderClient({ region: "af-south-1" });
const kms = new KMSClient();
const eb = new EventBridgeClient();
const sfn = new SFNClient({ region: 'af-south-1' });

async function publishEvent(detailType, detail) {
  if (!process.env.EVENT_BUS_NAME) return;
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: 'naleko.onboarding',
        DetailType: detailType,
        Detail: JSON.stringify(detail),
      }],
    }));
  } catch (err) {
    logger.warn('EventBridge publish failed', { detailType, error: err.message });
  }
}

const logger = new Logger({ serviceName: 'createEmployee' });
const tracer = new Tracer({ serviceName: 'createEmployee' });

// BE-15: a setting that names one environment has no fallback value. A missing
// one stops the Lambda when it starts, with one clear line in the log.
function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing setting ${name}`);
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

const USER_POOL_ID = requireSetting("COGNITO_POOL_ID");
// NH: LOGIN_URL is injected via env var so Vercel→CloudFront migration (NH-38) requires
// only a Terraform env var change — no Lambda code redeploy needed.
const LOGIN_URL = requireSetting("LOGIN_URL");
const SENDER_EMAIL = requireSetting("POSTMARK_SENDER_EMAIL");
const COMPANY_NAME = requireSetting("COMPANY_NAME");
requireSetting("APP_URL");

/**
 * KMS envelope encryption — stores ciphertext as base64 string.
 * Returns null if KMS_KEY_ARN is not set (dev/test fallback).
 */
async function kmsEncrypt(plaintext) {
  if (!process.env.KMS_KEY_ARN || !plaintext) return null;
  const result = await kms.send(new EncryptCommand({
    KeyId: process.env.KMS_KEY_ARN,
    Plaintext: Buffer.from(plaintext, 'utf8'),
  }));
  return Buffer.from(result.CiphertextBlob).toString('base64');
}

// Postmark client — initialised lazily so Lambda doesn't crash if env var is missing
let mailClient = null;
function getMailClient() {
  if (!mailClient && process.env.POSTMARK_API_TOKEN) {
    mailClient = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
  }
  return mailClient;
}

function badRequest(message) {
  return {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: message }),
  };
}

const handlerFn = async (event) => {
  logger.info('Handler invoked', { path: event.path, httpMethod: event.httpMethod });
  tracer.putAnnotation('operation', 'createEmployee');

  try {
    // 1. Get staff member ID — agent bypass or JWT claims
    const actor = event.requestContext?.authorizer?.lambda?.actor ?? 'HUMAN';
    const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
    const staffMemberId = actor === 'AGENT'
      ? 'agent'
      : (claims['custom:staff_id'] || claims['sub'] || 'unknown');

    logger.info('Auth resolved', { staffMemberId, actor });

    // 2. Parse and check the request body (ONB-03: a bad request is a 400, never a 500)
    let body;
    try { body = event.body ? JSON.parse(event.body) : undefined; } catch { body = undefined; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return badRequest('The request body is missing or not valid');
    }
    const checked = validateEmployee(body);
    if (checked.problems) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Check the highlighted fields',
          ...(checked.missing.length ? { missing: checked.missing } : {}),
          fields: checked.problems,
        }),
      };
    }
    body = { ...body, ...checked.clean };

    // 2b. The HR partner comes from the pool, never from the browser
    let partner = null;
    if (body.hr_staff_id) {
      const members = (await listHrMembers(cognito, ListUsersInGroupCommand, USER_POOL_ID)).map((u) => toPartner(u));
      partner = members.find((m) => m.id === String(body.hr_staff_id)) ?? null;
      if (!partner) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Choose an HR partner from the list', fields: { hr_staff_id: 'Choose an HR partner from the list' } }),
        };
      }
    }

    // 3. Check for duplicate email using email-index GSI (prevents duplicate employee records).
    // The address is one person whatever the capitals; rows stored before this card may hold capitals.
    const typedForms = [...new Set([body.email, checked.typedEmail])];
    for (const candidate of typedForms) {
      const emailCheck = await dynamodb.send(new QueryCommand({
        TableName: 'employees',
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': { S: candidate } },
        Limit: 1,
        ProjectionExpression: 'employee_id',
      }));
      if (emailCheck.Count > 0) {
        logger.warn('Duplicate email rejected', { existingId: emailCheck.Items[0]?.employee_id?.S });
        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            error: 'An employee with this email address already exists.',
            code: 'DUPLICATE_EMAIL',
            existingEmployeeId: emailCheck.Items[0]?.employee_id?.S,
          }),
        };
      }
    }

    // 4. Generate UUID v4 employee ID (NH-28: replaces sequential EMP-NNNNNNN scan anti-pattern)
    const employeeId = randomUUID();

    // 4a. Envelope-encrypt SA ID number (NH-11)
    // id_number is optional at employee creation — may be submitted later via document upload.
    // When present, we encrypt with the PII CMK and store only the ciphertext + last 4 digits.
    let idNumberEncrypted = null;
    let idNumberLast4 = null;
    if (body.id_number) {
      idNumberEncrypted = await kmsEncrypt(body.id_number);
      idNumberLast4 = String(body.id_number).slice(-4);
    }

    // 4. Prepare employee record
    const timestamp = new Date().toISOString();
    const employee = {
      employee_id: { S: employeeId },
      first_name: { S: body.first_name },
      middle_name: { S: body.middle_name || '' },
      last_name: { S: body.last_name },
      email: { S: body.email },
      phone: { S: body.phone },
      department: { S: body.department },
      job_title: { S: body.job_title || '' },
      stage: { S: 'INVITED' }, // Always start at INVITED
      offer_accept_date: { S: body.offer_accept_date || '' },
      planned_start_date: { S: body.planned_start_date || '' },
      created_at: { S: timestamp },
      created_by: { S: staffMemberId }, // Track who created this employee
      hr_staff_id: { S: partner ? partner.staffId : (body.hr_staff_id || staffMemberId) },
      hr_staff_name: { S: partner ? partner.name : (body.hr_staff_name || '') },
      hr_staff_email: { S: partner ? partner.email : (body.hr_staff_email || '') },
      // PII fields — SA ID stored encrypted; only last 4 digits stored in clear
      ...(idNumberEncrypted ? { id_number_encrypted: { S: idNumberEncrypted } } : {}),
      ...(idNumberLast4     ? { id_number_last4:     { S: idNumberLast4 }     } : {}),
    };

    // 5. Save to DynamoDB
    await dynamodb.send(
      new PutItemCommand({
        TableName: 'employees',
        Item: employee
      })
    );

    logger.info('Employee created', { employeeId, staffMemberId });
    tracer.putAnnotation('employeeId', employeeId);

    // 5b. Publish employee.invited event (NH-14)
    await publishEvent('employee.invited', {
      employee_id: employeeId,
      email: body.email,
      department: body.department,
      stage: 'INVITED',
      created_by: staffMemberId,
    });

    // 5c. NH-42: Start Step Functions onboarding execution (best-effort).
    // The state machine writes a task token to the employee record and waits
    // for processDocumentOCR to call SendTaskSuccess before running risk assessment.
    // Non-fatal: SFN failure does not block employee creation.
    let executionArn = null;
    if (process.env.SFN_STATE_MACHINE_ARN) {
      try {
        const sfnResult = await sfn.send(new StartExecutionCommand({
          stateMachineArn: process.env.SFN_STATE_MACHINE_ARN,
          // Name must be unique within 90 days — one execution per employee.
          name: `onboarding-${employeeId}`,
          input: JSON.stringify({ employeeId, email: body.email, stage: 'INVITED' }),
        }));
        executionArn = sfnResult.executionArn;
        logger.info('SFN execution started', { executionArn, employeeId });
        tracer.putAnnotation('executionArn', executionArn);
      } catch (sfnError) {
        // Employee is already persisted in DynamoDB. Missing execution means
        // no orchestrated risk assessment, but the invitation flow continues.
        logger.warn('Failed to start SFN execution', { error: sfnError.message, employeeId });
      }
    }

    // 6. ONB-04: an invite link, never a password
    const hrName = partner ? partner.name : ([claims.given_name, claims.family_name].filter(Boolean).join(' ') || claims.email || '');
    let cognitoUserCreated = false;
    let invite = null;
    try {
      invite = await issueInvite({
        employee: { employee_id: employeeId, email: body.email, first_name: body.first_name, last_name: body.last_name },
        hrPartner: partner, sentBy: staffMemberId,
      });
      cognitoUserCreated = true;
    } catch (inviteError) {
      logger.error('Invite failed', { employeeId, error: inviteError?.name ?? 'Error' });
    }

    // 7. The invite email (test logins and test addresses never get one)
    let emailSent = false;
    let skipped;
    const robot = isRobotEmail(body.email) || isRobotCaller(claims);
    if (invite && robot) skipped = 'test';
    else if (invite) {
      try {
        const client = getMailClient();
        if (client) {
          const words = { first: body.first_name, hr: hrName, hrFirst: hrName.split(' ')[0], link: invite.link, sent: saDate(new Date()), expires: saDate(new Date(invite.expiresAt)) };
          await client.sendEmail({
            From: SENDER_EMAIL,
            To: body.email,
            Subject: `${COMPANY_NAME}: set your password for Naleko People`,
            HtmlBody: buildInviteEmail(words),
            TextBody: buildInviteText(words),
            MessageStream: "outbound",
          });
          emailSent = true;
        }
      } catch (emailError) {
        // Same line the InviteFailed alarm watches, so a failed send is noticed too
        logger.error('Invite failed', { employeeId, step: 'email', error: emailError?.name ?? 'Error' });
      }
    }
    const showLink = invite && process.env.INVITE_TEST_LINK === 'true' && isRobotEmail(body.email) && isRobotCaller(claims);

    // 8. Return created employee (unmarshall for clean JSON)
    // id_number_encrypted is PII ciphertext — never returned to callers.
    const createdEmployee = Object.keys(employee).reduce((acc, key) => {
      if (key === 'id_number_encrypted') return acc; // redact ciphertext
      const value = employee[key];
      acc[key] = value.S || value.N || value.BOOL || null;
      return acc;
    }, {});

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // NH-42: execution ARN forwarded for polling; omitted when SFN not configured
        ...(executionArn ? { 'X-Execution-Arn': executionArn } : {}),
      },
      body: JSON.stringify({
        message: 'Employee created successfully',
        employee: createdEmployee,
        cognito: {
          // tempPassword intentionally omitted — delivered to employee via email only (NH-9)
          userCreated: cognitoUserCreated,
        },
        email: {
          sent: emailSent,
          ...(skipped ? { skipped } : {}),
        },
        ...(showLink ? { invite: { link: invite.link } } : {}),
      })
    };

  } catch (error) {
    logger.error('Handler error', { error });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: error.message,
        details: 'Failed to create employee'
      })
    };
  }
};

// NH-44: Wrap handler with idempotency protection.
// Clients send `Idempotency-Key: <uuid-v4>` header on POST /v1/employees.
// A repeated call with the same key within 24h returns the cached 201 response
// without creating a duplicate employee record in DynamoDB.
export const handler = async (event) => {
  // ONB-03: only HR may add an employee. The agent is refused too (decided 15 Nov). This runs before the
  // body is read and before an Idempotency-Key can hand back an earlier answer.
  const refused = hrOnly(event, 'Only HR can add an employee');
  if (refused) return refused;
  const key = event.headers?.['idempotency-key'];
  return withIdempotency(key, () => handlerFn(event));
};

const SA_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' });
function saDate(d) { return SA_DATE.format(d).replace('Sept', 'Sep'); }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function footerText(w) {
  return `Sent by ${w.hr}, HR at ${COMPANY_NAME}, on ${w.sent}. The link works once and expires on ${w.expires}. If it has expired, ask ${w.hrFirst} for a new one.`;
}
function leadText(w) {
  return `Hi ${w.first}. ${COMPANY_NAME} uses Naleko People for new employees. Set your password, then upload your ID and bank letter.`;
}

function buildInviteEmail(w) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(COMPANY_NAME)}</title></head>
<body style="margin:0;padding:0;background:#f7f3ec;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;"><tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;"><tr><td style="padding:24px;">
<h1 style="margin:0 0 12px;font-size:24px;color:#1a1a2e;">Get ready for your first day</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#333;">${esc(leadText(w))}</p>
<p style="margin:0 0 24px;"><a href="${esc(w.link)}" style="display:inline-block;background:#6d4aff;color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;line-height:20px;border-radius:8px;">Set your password</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#666;">${esc(footerText(w))}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function buildInviteText(w) {
  return `Get ready for your first day

${leadText(w)}

Set your password:
${w.link}

${footerText(w)}
`;
}

// NH-28: generateEmployeeId() removed — replaced with randomUUID() inline.
// UUID v4 eliminates the O(n) full-table Scan that was needed to derive the
// next sequential EMP-NNNNNNN integer.
