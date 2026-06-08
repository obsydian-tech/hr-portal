/**
 * trackUserActions — DynamoDB Stream Processor
 *
 * INTEL-001 Phase 3: Tracks user actions by processing DynamoDB stream events
 * from talent-flow-state table.
 *
 * Trigger: DynamoDB Stream on talent-flow-state
 * Purpose: Update talent-flow-users.lastActionAt when users perform actions
 *
 * Stream Filter: Only processes records where:
 * - SK starts with "SAGA"
 * - updatedBy field exists (added by mutation Lambdas)
 *
 * Architecture:
 * - Event-driven (real-time action tracking)
 * - Idempotent (safe to replay events)
 * - Error handling (bisect on function error)
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });

const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME ?? 'talent-flow-users';

/**
 * Process a single DynamoDB stream record
 */
async function processRecord(record) {
  // Only process INSERT and MODIFY events
  if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
    console.log('Skipping event type:', record.eventName);
    return { processed: false, reason: 'not_insert_or_modify' };
  }

  // Get the new image (after modification)
  const newImage = record.dynamodb?.NewImage;
  if (!newImage) {
    console.log('No NewImage in record - skipping');
    return { processed: false, reason: 'no_new_image' };
  }

  // Unmarshall DynamoDB record to regular JS object
  const item = unmarshall(newImage);

  // Verify this is a SAGA record
  if (!item.SK || !item.SK.startsWith('SAGA')) {
    console.log('Not a SAGA record - skipping:', item.SK);
    return { processed: false, reason: 'not_saga' };
  }

  // Extract updatedBy field (added by mutation Lambdas)
  const userId = item.updatedBy;
  if (!userId) {
    console.log('No updatedBy field - skipping (action not tracked)');
    return { processed: false, reason: 'no_updated_by' };
  }

  // Extract metadata for logging
  const candidateId = item.candidateId || item.PK?.replace('CANDIDATE#', '');
  const action = record.eventName; // INSERT or MODIFY

  console.log('Processing action:', {
    action,
    userId,
    candidateId,
    eventID: record.eventID,
  });

  // Update lastActionAt for the user
  try {
    const now = new Date().toISOString();

    await dynamo.send(new UpdateItemCommand({
      TableName: USERS_TABLE_NAME,
      Key: {
        PK: { S: `USER#${userId}` },
        SK: { S: 'PROFILE' }
      },
      UpdateExpression: 'SET lastActionAt = :now, updatedAt = :now',
      ExpressionAttributeValues: {
        ':now': { S: now }
      },
    }));

    console.log('✅ Updated lastActionAt for user:', userId);

    return {
      processed: true,
      userId,
      candidateId,
      timestamp: now,
    };
  } catch (err) {
    console.error('❌ Failed to update lastActionAt:', {
      userId,
      candidateId,
      error: err.message,
      errorName: err.name,
    });

    // Re-throw to trigger Lambda retry with bisect
    throw err;
  }
}

/**
 * Lambda handler - processes batch of DynamoDB stream records
 */
export const handler = async (event) => {
  console.log('Received DynamoDB Stream event:', {
    recordCount: event.Records.length,
  });

  const results = {
    processed: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Process each record
  for (const record of event.Records) {
    try {
      const result = await processRecord(record);

      if (result.processed) {
        results.processed++;
      } else {
        results.skipped++;
        console.log('Skipped record:', result.reason);
      }
    } catch (err) {
      results.failed++;
      results.errors.push({
        eventID: record.eventID,
        error: err.message,
      });

      console.error('Failed to process record:', {
        eventID: record.eventID,
        error: err.message,
      });
    }
  }

  console.log('Batch processing complete:', results);

  // If any records failed, report batch item failures
  // DynamoDB Streams will retry only the failed records
  if (results.failed > 0) {
    return {
      batchItemFailures: results.errors.map(e => ({
        itemIdentifier: e.eventID,
      })),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(results),
  };
};
