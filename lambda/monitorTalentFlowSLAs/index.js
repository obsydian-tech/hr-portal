'use strict';

/**
 * AI-001 (NH-127) — monitorTalentFlowSLAs
 *
 * Triggered hourly by EventBridge cron (talent-flow-sla-monitor-hourly).
 * Reads ACTIVE SLA thresholds (never versioned — policy applies to all open candidates).
 * Scans talent-flow-state for open SAGA records, publishes SLABreached when threshold exceeded.
 *
 * CRITICAL: Always use getConfig(tenantId, configType) — never pass a version arg.
 * SLA thresholds are current-policy reads, not locked to candidate creation time.
 *
 * IAM: dynamodb:Query+Scan+UpdateItem on talent-flow-state
 *      dynamodb:GetItem on talent-flow-config
 *      events:PutEvents on talent-flow-bus
 *      kms:Decrypt+GenerateDataKey on alias/talent-flow/state
 *
 * Note: Direct SQS send omitted — EventBridge Rule 6 (sla_breached) routes
 *       SLABreached → sendTalentFlowNotification automatically (no duplicate send).
 */

const { DynamoDBClient, ScanCommand, UpdateItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { QueryCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { getConfig } = require('../shared/config-reader');
const { tenantHelper, scopeWrite, eventTenant } = require('../shared/tf-tenant.js');

const dynamo = new DynamoDBClient({});
const eventbridge = new EventBridgeClient({});
const sqs = new SQSClient({});

exports.handler = async () => {
  const STATE_TABLE = process.env.STATE_TABLE_NAME;
  const BUS_NAME    = process.env.EVENTBRIDGE_BUS_NAME;

  // Step 1: ACTIVE SLA thresholds are read per company, no version arg (Epic 2 Invariant #3).
  // TEN-03: each saga is judged with its own company's thresholds. A row without a company is left alone.
  const thresholdsOf = new Map();
  async function thresholdsFor(tenantId) {
    if (!thresholdsOf.has(tenantId)) {
      const slaConfig = await getConfig(tenantId, 'SLA_THRESHOLDS');
      // config-reader returns the DynamoDB item's `data` field as the payload
      // REC-03: a company's stored limits may still be keyed by the old stage names. Each key is read through the one stage list;
      // where several old stages became one, the longest limit counts. Keys that are not stages (stageLimitHours ...) stay as they are.
      const { normaliseStage } = await import('../shared/recruitment-stages.mjs');
      const stored = slaConfig.data ?? slaConfig ?? {};
      const byStage = { ...stored };
      for (const [key, hours] of Object.entries(stored)) {
        const code = normaliseStage(key);
        if (code && typeof hours === 'number') byStage[code] = Math.max(byStage[code] ?? 0, hours);
      }
      thresholdsOf.set(tenantId, byStage);
    }
    return thresholdsOf.get(tenantId);
  }

  // Step 2: Paginated scan for open SAGA records
  const openSagas = await scanOpenSagas(dynamo, STATE_TABLE);

  // A failing threshold read for any company is fatal (the cron retries), as it always was.
  for (const tid of new Set(await Promise.all(openSagas.map((sg) => eventTenant({ tenant_id: sg.tenant_id }))))) {
    if (tid) await thresholdsFor(tid);
  }

  let breached = 0;

  // Step 3: Per-candidate SLA evaluation
  for (const saga of openSagas) {
    try {
      const tenantId = await eventTenant({ tenant_id: saga.tenant_id });
      if (!tenantId) {
        console.warn(JSON.stringify({ event: 'sla_no_company', pk: saga.PK }));
        continue;
      }
      // REC-09 rule 10: a company with Recruitment off is skipped.
      if (!(await (await import('../shared/modules.mjs')).modulesOf(tenantId)).includes('recruitment')) {
        console.warn('Module off, skipped', { tenantId });
        continue;
      }
      const slaThresholds = await thresholdsFor(tenantId);
      const { normaliseStage } = await import('../shared/recruitment-stages.mjs');
      const stage = normaliseStage(saga) ?? saga.currentStage;

      // Skip if no threshold configured for this stage
      if (slaThresholds[stage] === undefined || slaThresholds[stage] === null) {
        console.warn(JSON.stringify({ event: 'sla_no_threshold', pk: saga.PK, stage }));
        continue;
      }

      const thresholdHours = slaThresholds[stage];

      // Skip if already breached — avoids re-publishing on every subsequent cron run
      if (saga.slaBreachedAt) {
        continue;
      }

      if (!saga.stageEnteredAt) {
        console.warn(JSON.stringify({ event: 'sla_missing_stageEnteredAt', pk: saga.PK, stage }));
        continue;
      }

      const hoursElapsed    = (Date.now() - new Date(saga.stageEnteredAt).getTime()) / 3600000;
      const percentElapsed  = (hoursElapsed / thresholdHours) * 100;

      const now         = new Date().toISOString();
      const candidateId = saga.candidateId ?? saga.PK?.replace('CANDIDATE#', '') ?? saga.PK;

      if (percentElapsed >= 100) {
        // BREACHED — write once with conditional to guard against concurrent runs
        try {
          await dynamo.send(new UpdateItemCommand(scopeWrite({
            TableName:                 STATE_TABLE,
            Key:                       marshall({ PK: saga.PK, SK: 'SAGA' }),
            UpdateExpression:          'SET slaBreachedAt = :now, slaBreachedStage = :stage, slaStatus = :status',
            ConditionExpression:       'attribute_not_exists(slaBreachedAt)',
            ExpressionAttributeValues: marshall({ ':now': now, ':stage': stage, ':status': 'BREACHED' }),
          }, tenantId)));
        } catch (err) {
          if (err.name === 'ConditionalCheckFailedException') {
            console.log(JSON.stringify({ event: 'sla_breach_already_recorded', pk: saga.PK, stage }));
            continue;
          }
          throw err;
        }

        // Publish SLABreached event — EventBridge Rule 6 routes this to notification Lambda
        await eventbridge.send(new PutEventsCommand({
          Entries: [{
            EventBusName: BUS_NAME,
            Source:       'talent-flow.sla',
            DetailType:   'SLABreached',
            Detail:       JSON.stringify({
              candidateId,
              tenant_id: tenantId,
              stage,
              hoursElapsed: Math.round(hoursElapsed * 10) / 10,
              thresholdHours,
            }),
          }],
        }));

        breached++;
        console.log(JSON.stringify({ event: 'sla_breached', pk: saga.PK, candidateId, stage, hoursElapsed: Math.round(hoursElapsed * 10) / 10 }));

      } else if (percentElapsed >= 75 && saga.slaStatus !== 'AT_RISK') {
        // AT_RISK — update slaStatus only if not already marked
        await dynamo.send(new UpdateItemCommand(scopeWrite({
          TableName:                 STATE_TABLE,
          Key:                       marshall({ PK: saga.PK, SK: 'SAGA' }),
          UpdateExpression:          'SET slaStatus = :status',
          ExpressionAttributeValues: marshall({ ':status': 'AT_RISK' }),
        }, tenantId)));
        console.log(JSON.stringify({ event: 'sla_at_risk', pk: saga.PK, candidateId, stage, percentElapsed: Math.round(percentElapsed) }));
      }
      // else: ON_TRACK — slaStatus already set at creation / stage advance
    } catch (err) {
      // Per-candidate failure must never crash the whole scan
      console.error(JSON.stringify({ event: 'sla_check_error', pk: saga.PK, error: err.message }));
    }
  }

  // REC-09: the time-based work of rules 2, 6 and 7. A failure here is logged by error name only and never hides the work above.
  try {
    await recruitmentJobs(thresholdsFor);
  } catch (err) {
    console.error(JSON.stringify({ event: 'RECRUITMENT_JOBS_FAILED', error: err?.name ?? 'Error' }));
  }

  // REC-05 rule 8: SENT offers past their expiry date become EXPIRED (companies with Recruitment off are skipped).
  // A failure here must not hide the SLA work above, so it is logged by error name only and the next hourly run tries again.
  let expired = 0;
  try {
    const { expireOffers } = await import('../shared/recruitment-actions/offers.mjs');
    expired = await expireOffers(await scanSentOffers(dynamo, STATE_TABLE));
  } catch (err) {
    console.error(JSON.stringify({ event: 'OFFER_EXPIRY_FAILED', error: err?.name ?? 'Error' }));
  }

  console.log(JSON.stringify({ event: 'SLA_MONITOR_COMPLETE', scanned: openSagas.length, breached, expired }));
};

/**
 * Paginated scan of talent-flow-state for open SAGA records.
 * FilterExpression: SK = SAGA AND status = ACTIVE
 */
async function scanOpenSagas(dynamo, tableName) {
  const items   = [];
  let lastKey;

  do {
    const params = {
      TableName:                 tableName,
      FilterExpression:          'SK = :saga AND #s = :active',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: marshall({ ':saga': 'SAGA', ':active': 'ACTIVE' }),
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const resp = await dynamo.send(new ScanCommand(params));

    for (const item of (resp.Items ?? [])) {
      items.push(unmarshall(item));
    }

    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/** REC-05: every SENT offer row (PK OFFER#<id>, SK OFFER), every page. */
async function scanSentOffers(dynamo, tableName) {
  const items = [];
  let lastKey;
  do {
    const resp = await dynamo.send(new ScanCommand({
      TableName:                 tableName,
      FilterExpression:          'SK = :offer AND begins_with(PK, :p) AND #s = :sent',
      ExpressionAttributeNames:  { '#s': 'state' },
      ExpressionAttributeValues: marshall({ ':offer': 'OFFER', ':p': 'OFFER#', ':sent': 'SENT' }),
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    for (const item of (resp.Items ?? [])) items.push(unmarshall(item));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return items;
}


// ---------------------------------------------------------------- REC-09

const dayOf = (iso) => new Date(iso).toISOString().slice(0, 10);

async function scanAll(params) {
  const items = [];
  let lastKey;
  do {
    const resp = await dynamo.send(new ScanCommand({ ...params, ...(lastKey ? { ExclusiveStartKey: lastKey } : {}) }));
    for (const i of resp.Items ?? []) items.push(unmarshall(i));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function recruitmentJobs(thresholdsFor) {
  const STATE_TABLE = process.env.STATE_TABLE_NAME;
  const { modulesOf } = await import('../shared/modules.mjs');
  const S = await import('../shared/recruitment-settings.mjs');
  const { feedbackDueAt } = await import('../shared/feedback-due.mjs');
  const sagas = new Map();
  const sagaOf = async (id) => {
    if (!sagas.has(id)) {
      // A Query on the one key, not GetItem: this role is granted Query on the state table, not GetItem.
      const r = await dynamo.send(new QueryCommand({
        TableName: STATE_TABLE, KeyConditionExpression: 'PK = :pk AND SK = :sk', ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${id}`, ':sk': 'SAGA' }), Limit: 1,
      }));
      sagas.set(id, r.Items?.[0] ? unmarshall(r.Items[0]) : null);
    }
    return sagas.get(id);
  };
  const on = new Map();
  const moduleOn = async (tid) => {
    if (!on.has(tid)) on.set(tid, (await modulesOf(tid)).includes('recruitment'));
    if (!on.get(tid)) console.warn('Module off, skipped', { tenantId: tid });
    return on.get(tid);
  };
  const now = Date.now();

  const interviews = await scanAll({
    TableName: STATE_TABLE, FilterExpression: 'begins_with(SK, :p)', ExpressionAttributeValues: marshall({ ':p': 'INTERVIEW#' }),
  });
  for (const iv of interviews) {
    try {
      const tenantId = await eventTenant({ tenant_id: iv.tenant_id });
      if (!tenantId || !(await moduleOn(tenantId))) continue;
      const saga = await sagaOf(iv.candidateId);
      if (!saga || saga.tenant_id !== tenantId) continue;
      const stage = (await import('../shared/recruitment-stages.mjs')).normaliseStage(saga);
      if (stage === 'HIRED' || stage === 'NOT_HIRED') continue;
      const sla = await thresholdsFor(tenantId);
      const votes = (await dynamo.send(new QueryCommand({
        TableName: STATE_TABLE, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)', ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${iv.candidateId}`, ':p': 'VOTE#' }),
      }))).Items.map((i) => unmarshall(i)).filter((v) => v.interviewId === iv.interviewId);

      // Rule 2: a missed interview.
      const missedHours = typeof sla.interviewMissedAfterHours === 'number' ? sla.interviewMissedAfterHours : 24;
      if (iv.status === 'SCHEDULED' && votes.length === 0 && now >= Date.parse(iv.scheduledAt) + missedHours * 3_600_000 && !saga.interviewMissedAt) {
        const at = new Date().toISOString();
        try {
          await dynamo.send(new UpdateItemCommand(scopeWrite({
            TableName: STATE_TABLE, Key: marshall({ PK: saga.PK, SK: 'SAGA' }), UpdateExpression: 'SET interviewMissedAt = :at, interviewMissedId = :iv',
            ConditionExpression: 'attribute_not_exists(interviewMissedAt)', ExpressionAttributeValues: marshall({ ':at': at, ':iv': iv.interviewId }),
          }, tenantId)));
          saga.interviewMissedAt = at;
        } catch (err) {
          if (err.name !== 'ConditionalCheckFailedException') throw err;
        }
      }

      // Rule 6: reminders to panel members who have not voted, once a day.
      if (!['SCHEDULED', 'COMPLETED'].includes(iv.status)) continue;
      const due = feedbackDueAt(iv.scheduledAt, sla);
      if (!due || now < Date.parse(due)) continue;
      const settings = (await S.settingsForRead(tenantId, saga)).settings;
      const template = settings.EMAIL_TEMPLATES?.interviewer_reminder;
      if (!template) continue;
      const { renderTemplate } = S;
      const { saDate } = await import('../shared/invite-email.mjs');
      const { contactOf } = await import('../shared/people-contacts.mjs');
      let role = saga.positionTitle ?? '';
      if (saga.role_id && process.env.ROLES_TABLE_NAME) {
        const r = await dynamo.send(new GetItemCommand({ TableName: process.env.ROLES_TABLE_NAME, Key: marshall({ pk: `TENANT#${tenantId}`, sk: `ROLE#${saga.role_id}` }) }));
        if (r.Item) role = unmarshall(r.Item).job_title ?? role;
      }
      const voted = new Set(votes.map((v) => v.voterId));
      for (const member of iv.panelMemberIds ?? []) {
        if (voted.has(member)) continue;
        const contact = await contactOf(tenantId, member);
        if (!contact) continue;
        const guardKey = marshall({ PK: `INTERVIEWER_REMINDER#${iv.interviewId}#${member}#${dayOf(new Date(now).toISOString())}`, SK: 'REMINDER' });
        try {
          await dynamo.send(new PutItemCommand({
            TableName: process.env.NOTIFICATIONS_TABLE_NAME,
            Item: { ...guardKey, tenant_id: { S: tenantId }, sent_at: { S: new Date(now).toISOString() }, expiresAt: { N: String(Math.floor(now / 1000) + 3 * 86400) } },
            ConditionExpression: 'attribute_not_exists(PK)',
          }));
        } catch (err) {
          if (err.name === 'ConditionalCheckFailedException') continue;
          throw err;
        }
        const mail = renderTemplate(template, {
          candidate: [saga.firstName, saga.lastName].filter(Boolean).join(' '), role, date: saDate(iv.scheduledAt), due: saDate(due),
          link: `${process.env.FRONTEND_URL}/hire/feedback/${iv.interviewId}`,
        });
        await sqs.send(new SendMessageCommand({
          QueueUrl: process.env.NOTIFICATION_QUEUE_URL,
          MessageBody: JSON.stringify({ type: 'INTERVIEWER_REMINDER', tenant_id: tenantId, recipientId: member, recipientEmail: contact.email, candidateId: iv.candidateId, interviewId: iv.interviewId, subject: mail.subject, body: mail.body }),
          MessageGroupId: tenantId, MessageDeduplicationId: `reminder#${iv.interviewId}#${member}#${dayOf(new Date(now).toISOString())}`,
        }));
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'recruitment_job_error', pk: iv.PK, error: err?.name ?? 'Error' }));
    }
  }

  // Rule 7: an offer waiting for approval, or close to expiry, is copied onto its candidate so the stream job judges it.
  const offers = await scanAll({
    TableName: STATE_TABLE, FilterExpression: 'SK = :o AND begins_with(PK, :p) AND (#s = :sent OR #s = :wait)', ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: marshall({ ':o': 'OFFER', ':p': 'OFFER#', ':sent': 'SENT', ':wait': 'WAITING_APPROVAL' }),
  });
  for (const o of offers) {
    try {
      const tenantId = await eventTenant({ tenant_id: o.tenant_id });
      if (!tenantId || !(await moduleOn(tenantId))) continue;
      const sla = await thresholdsFor(tenantId);
      const set = o.state === 'SENT'
        ? (o.expiry_date && Date.parse(`${o.expiry_date}T12:00:00Z`) - now <= (typeof sla.offerExpiryWarningDays === 'number' ? sla.offerExpiryWarningDays : 3) * 86_400_000
          ? { expiryDate: o.expiry_date, offerStatus: 'SENT' } : null)
        : { offerStatus: 'WAITING_APPROVAL', currentApprovalStep: 'APPROVER', approvalStartedAt: o.submitted_at };
      if (!set) continue;
      const names = Object.keys(set);
      await dynamo.send(new UpdateItemCommand(scopeWrite({
        TableName: STATE_TABLE, Key: marshall({ PK: `CANDIDATE#${o.candidate_id}`, SK: 'SAGA' }),
        UpdateExpression: `SET ${names.map((k, n) => `#k${n} = :v${n}`).join(', ')}`,
        ConditionExpression: names.map((k, n) => `(attribute_not_exists(#k${n}) OR #k${n} <> :v${n})`).join(' OR '),
        ExpressionAttributeNames: Object.fromEntries(names.map((k, n) => [`#k${n}`, k])),
        ExpressionAttributeValues: marshall(Object.fromEntries(names.map((k, n) => [`:v${n}`, set[k]]))),
      }, tenantId)));
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') console.error(JSON.stringify({ event: 'recruitment_offer_mirror_error', error: err?.name ?? 'Error' }));
    }
  }
}
