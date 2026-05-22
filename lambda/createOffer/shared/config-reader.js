'use strict';

/**
 * lambda/shared/config-reader.js
 *
 * Shared config utility — ALL TalentFlow workflow Lambdas import this.
 *
 * Two read modes:
 *   getConfig(tenantId, configType, version)  → versioned read  (submitVote, completeEvaluation)
 *   getConfig(tenantId, configType)           → active read     (scheduleInterview, orchestrate, monitorSLAs)
 *
 * 5-minute in-memory cache per Lambda container.
 * Falls back to safe defaults when DynamoDB returns no item (with console.warn).
 * Never caches errors — only successful reads.
 *
 * DO NOT scan. DO NOT hardcode table name. DO NOT expose DynamoDB errors to callers.
 */

const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({});
const TABLE = process.env.CONFIG_TABLE_NAME; // 'talent-flow-config'
const cache = new Map(); // container-level 5-min cache
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Read a config item from talent-flow-config.
 *
 * @param {string} tenantId    - Tenant identifier (e.g. 'DEFAULT')
 * @param {string} configType  - Config type key (e.g. 'SCORING_WEIGHTS', 'SLA_THRESHOLDS')
 * @param {string|null} version - Version string (e.g. 'v3') for versioned reads; omit for active
 * @returns {Promise<object>} Parsed config data object, or safe defaults if not found
 */
async function getConfig(tenantId, configType, version = null) {
  const cacheKey = `${tenantId}#${configType}#${version || 'ACTIVE'}`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.data;
  }

  let data;
  try {
    if (version) {
      // Versioned read — locked to the candidate's configVersion snapshot
      // PK = TENANT#{tenantId}, SK = CONFIG#{configType}#v{version}
      const result = await client.send(new GetItemCommand({
        TableName: TABLE,
        Key: marshall({
          PK: `TENANT#${tenantId}`,
          SK: `CONFIG#${configType}#v${version}`
        })
      }));
      data = result.Item ? unmarshall(result.Item).data : null;
    } else {
      // Active read — current policy via GSI1
      // GSI1PK = TENANT#{tenantId}#ACTIVE, GSI1SK = CONFIG#{configType}
      const result = await client.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1-active-configs',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
        ExpressionAttributeValues: marshall({
          ':pk': `TENANT#${tenantId}#ACTIVE`,
          ':sk': `CONFIG#${configType}`
        }),
        Limit: 1
      }));
      data = result.Items?.length ? unmarshall(result.Items[0]).data : null;
    }
  } catch (err) {
    // DO NOT cache errors — fall through to defaults
    console.error(`config-reader: DynamoDB error for ${tenantId}/${configType}/${version || 'ACTIVE'}:`, err.message);
    const defaults = getDefaults(configType);
    return defaults;
  }

  if (data == null) {
    data = getDefaults(configType);
  } else {
    // Only cache successful reads
    cache.set(cacheKey, { data, ts: Date.now() });
  }

  return data;
}

/**
 * Safe defaults — used when config item is not found in DynamoDB.
 * Always logs a warning so production issues are visible in CloudWatch.
 *
 * @param {string} configType
 * @returns {object}
 */
function getDefaults(configType) {
  console.warn(`config-reader: no item found for configType=${configType} — returning defaults`);
  const defaults = {
    SCORING_WEIGHTS: {
      technical: 30,
      communication: 25,
      culturalFit: 25,
      problemSolving: 20
    },
    SLA_THRESHOLDS: {
      APPLICATION_REVIEW: 24,
      PHONE_SCREENING: 48,
      TECHNICAL_INTERVIEW: 72,
      PANEL_INTERVIEW: 96,
      EVALUATION: 48,
      OFFER_PREPARATION: 24,
      OFFER_APPROVAL: 72,
      OFFER_DELIVERY: 24
    },
    APPROVAL_RULES: {
      minimumPassScore: 6.0,
      requireFinanceApprovalAbove: 600000,
      escalationThresholdDays: 3
    },
    PANEL_CONFIG: {
      rules: {
        strongNoVeto: true,
        votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 4, DIRECTOR: 5 }
      }
    },
    EMAIL_TEMPLATES: {},
    STAGE_CONFIG: {
      enabled: [
        'APPLICATION_REVIEW',
        'PHONE_SCREENING',
        'TECHNICAL_INTERVIEW',
        'PANEL_INTERVIEW',
        'EVALUATION',
        'BACKGROUND_CHECK',
        'OFFER_PREPARATION',
        'OFFER_APPROVAL',
        'OFFER_DELIVERY',
        'CONTRACT_SIGNING',
        'PRE_BOARDING',
        'ONBOARDING'
      ]
    }
  };
  return defaults[configType] ?? {};
}

/**
 * Read the full active config item, including its version number.
 * Used exclusively by orchestrateTalentFlowWorkflow to snapshot configVersion onto SAGA records.
 *
 * Unlike getConfig, this returns the raw DynamoDB item shape: { version, data, ... }
 * so the caller can read item.version to form the configVersion string (e.g. 'v3').
 *
 * Falls back to { version: 0, data: defaults } if no active item found.
 *
 * @param {string} tenantId   - Tenant identifier (e.g. 'DEFAULT')
 * @param {string} configType - Config type key (e.g. 'SCORING_WEIGHTS')
 * @returns {Promise<{version: number|string, data: object}>}
 */
async function getConfigItem(tenantId, configType) {
  const cacheKey = `${tenantId}#${configType}#ACTIVE_ITEM`;
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const result = await client.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1-active-configs',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `TENANT#${tenantId}#ACTIVE`,
        ':sk': `CONFIG#${configType}`
      }),
      Limit: 1
    }));

    if (result.Items?.length) {
      const item = unmarshall(result.Items[0]);
      cache.set(cacheKey, { data: item, ts: Date.now() });
      return item;
    }
  } catch (err) {
    console.error(`config-reader: getConfigItem DynamoDB error for ${tenantId}/${configType}:`, err.message);
  }

  // Fallback — version=0 so orchestrator still produces a valid configVersion string
  console.warn(`config-reader: no active item found for configType=${configType} in getConfigItem — returning version=0`);
  return { version: 0, data: getDefaults(configType) };
}

module.exports = { getConfig, getConfigItem };
