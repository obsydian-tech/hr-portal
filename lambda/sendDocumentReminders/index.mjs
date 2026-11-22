/**
 * sendDocumentReminders (ONB-21): every morning, one email to each new employee who is at step DOCUMENTS, is 2 days or
 * less from the documents due date, and still owes a required document with no file. A claim row (company, person,
 * type, due date) is written before the email, so the same document on the same due date is never reminded twice.
 * EventBridge is the only caller and the event is never read: the company of every claim and email is the company row
 * being read.
 */
import { DynamoDBClient, DeleteItemCommand, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import postmark from 'postmark';
import { Logger } from '@aws-lambda-powertools/logger';
import { TENANT_ID_PATTERN, ownsItem, tenantKey } from '../shared/tenant.mjs';
import { companyRows } from '../shared/company-rows.mjs';
import { modulesOf } from '../shared/modules.mjs';
import { stepOf } from '../shared/onboarding-step.mjs';
import { requiredFor, typesToGive } from '../shared/required-documents.mjs';
import { documentsDueDate, reminderDue, todayInJohannesburg } from '../shared/due-date.mjs';
import { reminderEmail } from '../shared/reminder-email.mjs';
import { isRobotEmail } from '../shared/ai-guard.mjs';

const logger = new Logger({ serviceName: 'sendDocumentReminders' });
const db = new DynamoDBClient({ region: 'af-south-1' });

// BE-15: a setting that names one environment has no fallback value. A missing or empty one (the Postmark token
// included) stops the run at the start with one line, and nothing is sent.
function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing setting ${name}`);
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

// The names the person sees for each type, as the rows on their checklist say them.
const KIT_NAMES = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank account confirmation letter',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualifications',
};
// Time kept back to release a claim and throw (C-2).
const SAFE_MARGIN_MS = 30_000;
const CLAIM_TTL_DAYS = 30;

/** Every company id: one Scan of the tenants table, five attributes only, every page. Member and pending-move rows are filtered out. */
async function companyIds(tenantsTable) {
  const ids = [];
  let start;
  do {
    const page = await db.send(new ScanCommand({
      TableName: tenantsTable,
      ProjectionExpression: '#pk, #sk, #status, #modules, #founding',
      FilterExpression: 'begins_with(#pk, :prefix) AND #sk = :profile',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#status': 'status', '#modules': 'modules', '#founding': 'founding' },
      ExpressionAttributeValues: { ':prefix': { S: 'TENANT#' }, ':profile': { S: 'PROFILE' } },
      ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    for (const item of page.Items ?? []) {
      const id = String(item.pk?.S ?? '').slice('TENANT#'.length);
      if (TENANT_ID_PATTERN.test(id)) ids.push(id);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return ids;
}

/** The person's documents rows, each checked against the company. */
async function documentsOf(documentsTable, employeeId, tenantId) {
  const rows = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: documentsTable,
      KeyConditionExpression: 'employee_id = :e',
      ExpressionAttributeValues: { ':e': { S: employeeId } },
      ProjectionExpression: 'document_id, document_type, ocr_status, ocr_started_at, ocr_completed_at, tenant_id',
      ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    for (const item of page.Items ?? []) {
      if (!ownsItem(item, tenantId)) continue;
      rows.push({
        document_type: item.document_type?.S,
        ocr_status: item.ocr_status?.S,
        ocr_started_at: item.ocr_started_at?.S,
        ocr_completed_at: item.ocr_completed_at?.S,
      });
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return rows;
}

/** Writes the claim. False when it already exists (this document was reminded for this due date). */
async function claim(table, tenantId, employeeId, type, due) {
  try {
    await db.send(new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: tenantKey(tenantId, 'REMINDER', employeeId, type, due) },
        tenant_id: { S: tenantId },
        employee_id: { S: employeeId },
        document_type: { S: type },
        due_date: { S: due },
        sent_at: { S: new Date().toISOString() },
        expires_at: { N: String(Math.floor(Date.parse(`${due}T00:00:00Z`) / 1000) + CLAIM_TTL_DAYS * 86_400) },
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return true;
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function release(table, tenantId, employeeId, types, due) {
  for (const type of types) {
    try {
      await db.send(new DeleteItemCommand({ TableName: table, Key: { pk: { S: tenantKey(tenantId, 'REMINDER', employeeId, type, due) } } }));
    } catch (err) {
      logger.error('Claim not released', { tenantId, errorName: err?.name ?? 'Error' });
    }
  }
}

export const handler = async (_event, context) => {
  const token = requireSetting('POSTMARK_API_TOKEN');
  const sender = requireSetting('POSTMARK_SENDER_EMAIL');
  const loginUrl = requireSetting('LOGIN_URL');
  const employeesTable = requireSetting('EMPLOYEES_TABLE');
  const documentsTable = requireSetting('DOCUMENTS_TABLE');
  const tenantsTable = requireSetting('TENANTS_TABLE');
  const remindersTable = requireSetting('REMINDERS_TABLE');
  const cap = Number(requireSetting('MAX_REMINDERS_PER_RUN'));
  const mail = new postmark.ServerClient(token);
  const today = todayInJohannesburg();
  const n = { companies: 0, looked: 0, sent: 0, skippedTest: 0, alreadyReminded: 0, refused: 0, failed: 0 };
  let stop = null;

  for (const tenantId of await companyIds(tenantsTable)) {
    if (stop) break;
    if (!(await modulesOf(tenantId)).includes('onboarding')) continue;
    n.companies += 1;
    let people;
    try {
      people = await companyRows(employeesTable, tenantId, {
        FilterExpression: 'planned_start_date >= :today',
        ExpressionAttributeValues: { ':today': { S: today } },
        project: ['employee_id', 'email', 'first_name', 'planned_start_date', 'stage', 'step'],
      });
    } catch (err) {
      logger.error('Company skipped', { tenantId, errorName: err?.name ?? 'Error' });
      n.failed += 1;
      continue;
    }

    for (const item of people) {
      const employeeId = item.employee_id?.S;
      if (!employeeId || stepOf({ stage: item.stage?.S, step: item.step?.S }) !== 'DOCUMENTS') continue;
      n.looked += 1;
      const due = documentsDueDate(item.planned_start_date?.S, tenantId);
      if (!due || !reminderDue(due, today)) continue;
      const email = (item.email?.S ?? '').trim();
      const firstName = (item.first_name?.S ?? '').trim();
      if (isRobotEmail(email)) {
        n.skippedTest += 1;
        logger.info('Reminder skipped: test employee');
        continue;
      }
      if (!email || !firstName) continue; // W-4: no first name, nothing is sent

      let claimed = [];
      let keep = false;
      try {
        const owed = typesToGive(await documentsOf(documentsTable, employeeId, tenantId), requiredFor(tenantId));
        if (owed.length === 0) continue;
        if (n.sent + n.refused >= cap) { stop = 'cap'; break; }
        if (typeof context?.getRemainingTimeInMillis === 'function' && context.getRemainingTimeInMillis() < SAFE_MARGIN_MS) { stop = 'time'; break; }
        for (const type of owed) {
          if (await claim(remindersTable, tenantId, employeeId, type, due)) claimed.push(type);
          else n.alreadyReminded += 1;
        }
        if (claimed.length === 0) continue;
        const message = reminderEmail({ firstName, typeNames: claimed.map((t) => KIT_NAMES[t]), dueIso: due, loginUrl });
        await mail.sendEmail({
          From: sender,
          To: email,
          Subject: message.subject,
          HtmlBody: message.html,
          TextBody: message.text,
          TrackOpens: false,
          TrackLinks: 'None',
          MessageStream: 'outbound',
        });
        keep = true;
        n.sent += 1;
      } catch (err) {
        if (err?.code === 406 || err?.code === 300) {
          // A definite refusal for this address: the claim stays, so it is not tried again (C-3). Code only in the log.
          keep = true;
          n.refused += 1;
          logger.warn('Reminder refused by Postmark', { tenantId, code: err.code });
        } else if (err?.statusCode === 401 || err?.code === 10) {
          n.failed += 1;
          stop = 'token';
          logger.error('Postmark refused the token', { code: err.code, status: err.statusCode });
        } else {
          n.failed += 1;
          logger.error('Reminder not sent', { tenantId, errorName: err?.name ?? 'Error' });
        }
      } finally {
        if (!keep && claimed.length > 0) await release(remindersTable, tenantId, employeeId, claimed, due);
      }
      if (stop) break;
    }
  }

  logger.info('Reminder run finished', n);
  if (stop || n.failed > 0) throw new Error(`Reminder run incomplete (${stop ?? 'failed sends'}): sent ${n.sent}, failed ${n.failed}`);
  return n;
};
