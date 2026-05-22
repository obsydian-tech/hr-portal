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

const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { getConfig } = require('../shared/config-reader');

const dynamo = new DynamoDBClient({});
const eventbridge = new EventBridgeClient({});

exports.handler = async () => {
  const STATE_TABLE = process.env.STATE_TABLE_NAME;
  const BUS_NAME    = process.env.EVENTBRIDGE_BUS_NAME;

  // Step 1: Read ACTIVE SLA thresholds — no version arg (Epic 2 Invariant #3)
  const slaConfig    = await getConfig(process.env.TENANT_ID || 'NALEKO', 'SLA_THRESHOLDS');
  // config-reader returns the DynamoDB item's `data` field as the payload
  const slaThresholds = slaConfig.data ?? slaConfig ?? {};

  // Step 2: Paginated scan for open SAGA records
  const openSagas = await scanOpenSagas(dynamo, STATE_TABLE);

  let breached = 0;

  // Step 3: Per-candidate SLA evaluation
  for (const saga of openSagas) {
    try {
      const stage = saga.currentStage;

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
      const tenantId    = saga.tenantId ?? 'DEFAULT';

      if (percentElapsed >= 100) {
        // BREACHED — write once with conditional to guard against concurrent runs
        try {
          await dynamo.send(new UpdateItemCommand({
            TableName:                 STATE_TABLE,
            Key:                       marshall({ PK: saga.PK, SK: 'SAGA' }),
            UpdateExpression:          'SET slaBreachedAt = :now, slaBreachedStage = :stage, slaStatus = :status',
            ConditionExpression:       'attribute_not_exists(slaBreachedAt)',
            ExpressionAttributeValues: marshall({ ':now': now, ':stage': stage, ':status': 'BREACHED' }),
          }));
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
              tenantId,
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
        await dynamo.send(new UpdateItemCommand({
          TableName:                 STATE_TABLE,
          Key:                       marshall({ PK: saga.PK, SK: 'SAGA' }),
          UpdateExpression:          'SET slaStatus = :status',
          ExpressionAttributeValues: marshall({ ':status': 'AT_RISK' }),
        }));
        console.log(JSON.stringify({ event: 'sla_at_risk', pk: saga.PK, candidateId, stage, percentElapsed: Math.round(percentElapsed) }));
      }
      // else: ON_TRACK — slaStatus already set at creation / stage advance
    } catch (err) {
      // Per-candidate failure must never crash the whole scan
      console.error(JSON.stringify({ event: 'sla_check_error', pk: saga.PK, error: err.message }));
    }
  }

  console.log(JSON.stringify({ event: 'SLA_MONITOR_COMPLETE', scanned: openSagas.length, breached }));
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
