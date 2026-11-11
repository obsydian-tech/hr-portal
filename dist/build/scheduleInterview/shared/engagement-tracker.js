/**
 * Engagement Tracker - EPIC 3 TASK 3.2
 *
 * Utility for updating engagement readings on candidate SAGA records.
 * Maintains lastEngagementReading and previousEngagementReading for trend analysis.
 *
 * Usage:
 *   const { updateEngagementReading } = require('./shared/engagement-tracker');
 *   await updateEngagementReading(candidateId, newScore, tenantId);
 */

const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';

const dynamoDB = new DynamoDBClient({});

/**
 * Updates engagement reading for a candidate
 *
 * Strategy:
 *   1. Read current SAGA record
 *   2. Move lastEngagementReading → previousEngagementReading
 *   3. Set new reading as lastEngagementReading
 *   4. Update SAGA record
 *
 * This enables ENGAGEMENT_TREND calculation (RISING/FLAT/FALLING)
 *
 * @param {string} candidateId - Candidate ID
 * @param {number} newScore - New engagement score (0-100)
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<{success: boolean, trend: string}>}
 */
async function updateEngagementReading(candidateId, newScore, tenantId) {
  if (!candidateId) {
    throw new Error('candidateId is required');
  }
  if (newScore === undefined || newScore === null) {
    throw new Error('newScore is required');
  }
  if (newScore < 0 || newScore > 100) {
    throw new Error('newScore must be between 0 and 100');
  }

  const now = new Date().toISOString();

  try {
    // Step 1: Read current SAGA record
    const getResult = await dynamoDB.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({
        PK: `CANDIDATE#${candidateId}`,
        SK: 'SAGA'
      })
    }));

    if (!getResult.Item) {
      throw new Error(`Candidate ${candidateId} not found`);
    }

    const candidate = unmarshall(getResult.Item);
    const lastReading = candidate.lastEngagementReading;

    // Step 2: Prepare new readings
    const newReading = {
      score: newScore,
      timestamp: now
    };

    // Move last → previous (if exists)
    const previousReading = lastReading || null;

    // Step 3: Calculate trend (for return value)
    let trend = 'FLAT';
    if (previousReading && previousReading.score !== undefined) {
      const diff = newScore - previousReading.score;
      if (diff > 10) trend = 'RISING';
      else if (diff < -10) trend = 'FALLING';
    }

    // Step 4: Update SAGA record
    const updateExpr = previousReading
      ? 'SET lastEngagementReading = :last, previousEngagementReading = :prev, engagementScore = :score, updatedAt = :now'
      : 'SET lastEngagementReading = :last, engagementScore = :score, updatedAt = :now';

    const attrValues = previousReading
      ? { ':last': newReading, ':prev': previousReading, ':score': newScore, ':now': now }
      : { ':last': newReading, ':score': newScore, ':now': now };

    await dynamoDB.send(new UpdateItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({
        PK: `CANDIDATE#${candidateId}`,
        SK: 'SAGA'
      }),
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: marshall(attrValues)
    }));

    console.log('[engagement-tracker] Updated engagement reading', {
      candidateId,
      newScore,
      previousScore: previousReading?.score,
      trend,
      timestamp: now
    });

    return {
      success: true,
      trend,
      previousScore: previousReading?.score,
      newScore,
      timestamp: now
    };

  } catch (err) {
    console.error('[engagement-tracker] Failed to update engagement reading', {
      candidateId,
      newScore,
      error: err.message
    });
    throw err;
  }
}

/**
 * Gets current engagement trend for a candidate
 * (Read-only version for queries)
 *
 * @param {string} candidateId - Candidate ID
 * @returns {Promise<{trend: string, daysSinceResponse: number, lastScore: number}>}
 */
async function getEngagementTrend(candidateId) {
  try {
    const getResult = await dynamoDB.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({
        PK: `CANDIDATE#${candidateId}`,
        SK: 'SAGA'
      }),
      ProjectionExpression: 'lastEngagementReading, previousEngagementReading'
    }));

    if (!getResult.Item) {
      return { trend: 'FLAT', daysSinceResponse: null, lastScore: null };
    }

    const candidate = unmarshall(getResult.Item);
    const last = candidate.lastEngagementReading;
    const previous = candidate.previousEngagementReading;

    let trend = 'FLAT';
    if (last && previous && last.score !== undefined && previous.score !== undefined) {
      const diff = last.score - previous.score;
      if (diff > 10) trend = 'RISING';
      else if (diff < -10) trend = 'FALLING';
    }

    let daysSinceResponse = null;
    if (last && last.timestamp) {
      const lastTime = new Date(last.timestamp);
      const now = new Date();
      daysSinceResponse = Math.floor((now - lastTime) / (1000 * 60 * 60 * 24));
    }

    return {
      trend,
      daysSinceResponse,
      lastScore: last?.score || null,
      previousScore: previous?.score || null
    };

  } catch (err) {
    console.error('[engagement-tracker] Failed to get engagement trend', {
      candidateId,
      error: err.message
    });
    throw err;
  }
}

module.exports = {
  updateEngagementReading,
  getEngagementTrend
};
