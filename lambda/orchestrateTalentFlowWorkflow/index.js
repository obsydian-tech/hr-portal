'use strict';

/**
 * lambda/orchestrateTalentFlowWorkflow/index.js
 *
 * Triggered by EventBridge: source=talent-flow.candidates, detail-type=CandidateCreated
 *
 * Responsibilities:
 *   1. Read active SCORING_WEIGHTS config item via getConfigItem → extract version number
 *   2. Read enabled stages from active STAGE_CONFIG via getConfig
 *   3. Conditional UpdateItem on SAGA record (PK=CANDIDATE#{id}, SK=SAGA):
 *      - Sets configVersion = 'v{n}' (immutable lock — never overwritten after this)
 *      - Sets stages = enabled stages array
 *      - Sets workflowStartedAt = ISO timestamp
 *      - ConditionExpression: attribute_not_exists(configVersion) → idempotent for EB retries
 *   4. Log CONFIG_VERSION_LOCKED at INFO
 *   5. Publish WorkflowStarted to talent-flow-bus (source=talent-flow.workflow)
 *      — non-fatal if EventBridge fails (SAGA already locked)
 *
 * Env vars required:
 *   STATE_TABLE_NAME        — talent-flow-state
 *   CONFIG_TABLE_NAME       — talent-flow-config  (read by config-reader)
 *   EVENTBRIDGE_BUS_NAME    — talent-flow-bus
 *
 * DO NOT hardcode table names or bus name.
 * DO NOT create a new SAGA record — createCandidate already wrote it with configVersion omitted.
 */

const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { getConfig, getConfigItem } = require('../shared/config-reader');

const dynamoClient = new DynamoDBClient({});
const ebClient = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;
const EB_BUS = process.env.EVENTBRIDGE_BUS_NAME;

exports.handler = async (event) => {
  const { candidateId, tenantId, positionLevel } = event.detail || {};

  if (!candidateId || !tenantId) {
    const msg = `orchestrate: missing required fields in event.detail — candidateId=${candidateId} tenantId=${tenantId}`;
    console.error(msg, JSON.stringify(event.detail));
    throw new Error('Missing required fields: candidateId, tenantId');
  }

  // ── Step 1: Read active SCORING_WEIGHTS item to get current config version ──
  const scoringItem = await getConfigItem(tenantId, 'SCORING_WEIGHTS');
  const configVersion = `v${scoringItem.version}`;

  // ── Step 2: Read enabled stages from active STAGE_CONFIG ───────────────────
  const stageConfig = await getConfig(tenantId, 'STAGE_CONFIG');
  const enabledStages = stageConfig.enabled || [];

  // ── Step 3: Conditional UpdateItem — idempotent, only runs once per candidate
  const now = new Date().toISOString();
  try {
    await dynamoClient.send(new UpdateItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({
        PK: `CANDIDATE#${candidateId}`,
        SK: 'SAGA'
      }),
      UpdateExpression: 'SET configVersion = :cv, stages = :stages, workflowStartedAt = :ts',
      ConditionExpression: 'attribute_not_exists(configVersion)',
      ExpressionAttributeValues: marshall({
        ':cv': configVersion,
        ':stages': enabledStages,
        ':ts': now
      })
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // configVersion already set — EventBridge retry, safe to skip
      console.info(`orchestrate: configVersion already locked for candidateId=${candidateId} — skipping (idempotent)`);
      return;
    }
    // Real DynamoDB failure — re-throw so EventBridge retries
    throw err;
  }

  // ── Step 4: Log the lock ────────────────────────────────────────────────────
  console.info(`CONFIG_VERSION_LOCKED candidateId=${candidateId} version=${configVersion}`);

  // ── Step 5: Publish WorkflowStarted (non-fatal if EB fails) ────────────────
  try {
    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS,
        Source: 'talent-flow.workflow',
        DetailType: 'WorkflowStarted',
        Detail: JSON.stringify({
          candidateId,
          tenantId,
          positionLevel,
          configVersion,
          stages: enabledStages
        })
      }]
    }));
  } catch (err) {
    // SAGA is locked — downstream will still work. Log and continue.
    console.error(`orchestrate: EventBridge PutEvents failed for candidateId=${candidateId}:`, err.message);
  }
};
