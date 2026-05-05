/**
 * sendNotificationEmail Lambda
 * NH ticket: NH-notification-emails
 *
 * Triggered by EventBridge events on the naleko-onboarding bus:
 *   - document.reviewed  (decision: PASSED | FAILED | MANUAL_REVIEW)
 *   - onboarding.completed
 *
 * Email routing:
 *   PASSED         → employee: "Your [doc type] has been approved ✓"
 *   FAILED         → employee: "Your [doc type] needs attention — please re-upload"
 *   MANUAL_REVIEW  → HR: "Manual review required for [employee name] — [doc type]"
 *   completed      → employee: "🎉 Onboarding complete — you're all set!"
 */

import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import postmark from 'postmark';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamo = new DynamoDBClient({ region: 'af-south-1' });
const logger = new Logger({ serviceName: 'sendNotificationEmail' });
const tracer = new Tracer({ serviceName: 'sendNotificationEmail' });

const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE || 'employees';
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'documents';
const HR_EMAIL = process.env.HR_EMAIL || 'ignecious@obsydiantechnologies.com';
const SENDER_EMAIL = process.env.POSTMARK_SENDER_EMAIL || 'ignecious@obsydiantechnologies.com';
const LOGIN_URL = process.env.LOGIN_URL || 'https://hr-portal-beryl-three.vercel.app/login';

// Lazy-initialised Postmark client
let mailClient = null;
function getMailClient() {
  if (!mailClient && process.env.POSTMARK_API_TOKEN) {
    mailClient = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
  }
  return mailClient;
}

// ─── DynamoDB helpers ────────────────────────────────────────────────────────

async function getEmployee(employeeId) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: EMPLOYEES_TABLE,
    Key: { employee_id: { S: employeeId } },
    ProjectionExpression: 'employee_id, email, first_name, last_name',
  }));
  if (!result.Item) return null;
  return {
    employee_id: result.Item.employee_id?.S,
    email:       result.Item.email?.S,
    first_name:  result.Item.first_name?.S || '',
    last_name:   result.Item.last_name?.S  || '',
  };
}

async function getDocument(employeeId, documentId) {
  const result = await dynamo.send(new QueryCommand({
    TableName: DOCUMENTS_TABLE,
    KeyConditionExpression: 'employee_id = :eid AND document_id = :did',
    ExpressionAttributeValues: {
      ':eid': { S: employeeId },
      ':did': { S: documentId },
    },
    ProjectionExpression: 'document_id, document_type',
  }));
  if (!result.Items || result.Items.length === 0) return null;
  return {
    document_id:   result.Items[0].document_id?.S,
    document_type: result.Items[0].document_type?.S || 'document',
  };
}

// ─── Email helpers ───────────────────────────────────────────────────────────

/** Format document_type for display: "SA_ID" → "SA ID", "PAYSLIP" → "Payslip" */
function formatDocType(raw) {
  if (!raw) return 'document';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function sendEmail({ to, subject, textBody, htmlBody }) {
  const client = getMailClient();
  if (!client) {
    logger.warn('Postmark client not initialised — POSTMARK_API_TOKEN missing', { to, subject });
    return;
  }
  try {
    await client.sendEmail({
      From:     SENDER_EMAIL,
      To:       to,
      Subject:  subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
    });
    logger.info('Email sent', { to, subject });
  } catch (err) {
    logger.error('Postmark sendEmail failed', { to, subject, error: err.message });
    throw err;
  }
}

// ─── Event handlers ──────────────────────────────────────────────────────────

async function handleDocumentReviewed(detail) {
  const { employee_id, document_id, decision } = detail;

  if (!employee_id || !decision) {
    logger.warn('document.reviewed missing required fields', { detail });
    return;
  }

  const employee = await getEmployee(employee_id);
  if (!employee) {
    logger.warn('Employee not found', { employee_id });
    return;
  }

  // Fetch document for the human-readable doc type label
  let docTypeLabel = 'document';
  if (document_id) {
    const doc = await getDocument(employee_id, document_id);
    if (doc) docTypeLabel = formatDocType(doc.document_type);
  }

  const fullName = `${employee.first_name} ${employee.last_name}`.trim() || 'Employee';

  switch (decision) {
    case 'PASSED': {
      await sendEmail({
        to:      employee.email,
        subject: `✓ Your ${docTypeLabel} has been approved`,
        textBody: [
          `Hi ${employee.first_name || fullName},`,
          '',
          `Great news — your ${docTypeLabel} has been reviewed and approved.`,
          '',
          'If you have any remaining documents to upload, please log in to continue your onboarding.',
          '',
          `Login: ${LOGIN_URL}`,
          '',
          'The Naleko HR Team',
        ].join('\n'),
        htmlBody: `
          <p>Hi ${employee.first_name || fullName},</p>
          <p>Great news — your <strong>${docTypeLabel}</strong> has been reviewed and <strong style="color:#16a34a">approved ✓</strong>.</p>
          <p>If you have any remaining documents to upload, please log in to continue your onboarding.</p>
          <p><a href="${LOGIN_URL}">Log in to HR Portal</a></p>
          <p>The Naleko HR Team</p>
        `,
      });
      break;
    }

    case 'FAILED': {
      await sendEmail({
        to:      employee.email,
        subject: `Action required: please re-upload your ${docTypeLabel}`,
        textBody: [
          `Hi ${employee.first_name || fullName},`,
          '',
          `Your ${docTypeLabel} could not be accepted. Please log in and re-upload a clear, valid copy of the document to continue your onboarding.`,
          '',
          `Login: ${LOGIN_URL}`,
          '',
          'If you believe this is an error, please contact your HR representative.',
          '',
          'The Naleko HR Team',
        ].join('\n'),
        htmlBody: `
          <p>Hi ${employee.first_name || fullName},</p>
          <p>Your <strong>${docTypeLabel}</strong> could not be accepted. Please log in and re-upload a clear, valid copy of the document to continue your onboarding.</p>
          <p><a href="${LOGIN_URL}">Log in to re-upload</a></p>
          <p>If you believe this is an error, please contact your HR representative.</p>
          <p>The Naleko HR Team</p>
        `,
      });
      break;
    }

    case 'MANUAL_REVIEW': {
      await sendEmail({
        to:      HR_EMAIL,
        subject: `Manual review required — ${fullName}: ${docTypeLabel}`,
        textBody: [
          `Hi,`,
          '',
          `A document has been flagged for manual review:`,
          '',
          `  Employee: ${fullName} (${employee_id})`,
          `  Document: ${docTypeLabel}`,
          `  Document ID: ${document_id || 'N/A'}`,
          '',
          `Please log in to the HR portal to review this document.`,
          '',
          `Login: ${LOGIN_URL}`,
          '',
          'Naleko HR Portal',
        ].join('\n'),
        htmlBody: `
          <p>Hi,</p>
          <p>A document has been flagged for <strong>manual review</strong>:</p>
          <ul>
            <li><strong>Employee:</strong> ${fullName} (${employee_id})</li>
            <li><strong>Document:</strong> ${docTypeLabel}</li>
            <li><strong>Document ID:</strong> ${document_id || 'N/A'}</li>
          </ul>
          <p>Please log in to the HR portal to review this document.</p>
          <p><a href="${LOGIN_URL}">Log in to HR Portal</a></p>
          <p>Naleko HR Portal</p>
        `,
      });
      break;
    }

    default:
      logger.warn('Unknown decision — no email sent', { decision, employee_id, document_id });
  }
}

async function handleOnboardingCompleted(detail) {
  const { employee_id } = detail;
  if (!employee_id) {
    logger.warn('onboarding.completed missing employee_id', { detail });
    return;
  }

  const employee = await getEmployee(employee_id);
  if (!employee) {
    logger.warn('Employee not found for onboarding.completed', { employee_id });
    return;
  }

  const firstName = employee.first_name || 'there';

  await sendEmail({
    to:      employee.email,
    subject: '🎉 Onboarding complete — welcome to the team!',
    textBody: [
      `Hi ${firstName},`,
      '',
      'Congratulations — your onboarding is complete! All your documents have been verified and you are good to go.',
      '',
      `You can log in to the HR portal at any time here: ${LOGIN_URL}`,
      '',
      'Welcome aboard,',
      'The Naleko HR Team',
    ].join('\n'),
    htmlBody: `
      <p>Hi ${firstName},</p>
      <p>🎉 <strong>Congratulations — your onboarding is complete!</strong></p>
      <p>All your documents have been verified and you are good to go.</p>
      <p><a href="${LOGIN_URL}">Log in to HR Portal</a></p>
      <p>Welcome aboard,<br>The Naleko HR Team</p>
    `,
  });
}

// ─── Main handler ────────────────────────────────────────────────────────────

export const handler = async (event) => {
  tracer.putAnnotation('operation', 'sendNotificationEmail');
  logger.info('Event received', { detailType: event['detail-type'], source: event.source });

  const detailType = event['detail-type'];
  const detail = event.detail || {};

  try {
    switch (detailType) {
      case 'document.reviewed':
        await handleDocumentReviewed(detail);
        break;
      case 'onboarding.completed':
        await handleOnboardingCompleted(detail);
        break;
      default:
        logger.warn('Unhandled detail-type', { detailType });
    }
  } catch (err) {
    logger.error('Handler error', { detailType, error: err.message, stack: err.stack });
    // Re-throw so EventBridge retries (if DLQ is configured)
    throw err;
  }
};
