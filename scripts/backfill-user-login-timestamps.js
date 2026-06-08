/**
 * Backfill Script: User Login Timestamps
 *
 * Purpose: Add lastLoginAt and lastActionAt fields to existing talent-flow-users records
 * Strategy: Set both fields to createdAt (conservative approach)
 *
 * Ticket: INTEL-001 (User Activity Tracking - Phase 2 Task 2.4)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'af-south-1' });
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'talent-flow-users';

// Statistics
let stats = {
  totalScanned: 0,
  alreadyHasLoginAt: 0,
  alreadyHasActionAt: 0,
  updatedLoginAt: 0,
  updatedActionAt: 0,
  errors: 0,
};

/**
 * Backfill lastLoginAt and lastActionAt for a single user
 */
async function backfillUser(user) {
  const { PK, SK, userId, email, createdAt, lastLoginAt, lastActionAt } = user;

  // Skip if not a PROFILE record
  if (SK !== 'PROFILE') {
    return;
  }

  // Skip if createdAt is missing (can't backfill)
  if (!createdAt) {
    console.warn(`⚠️  User ${userId} (${email}) has no createdAt - skipping`);
    return;
  }

  const updates = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};
  let conditionExpression = [];

  // Check if lastLoginAt needs backfill
  if (!lastLoginAt) {
    updates.push('#lastLoginAt = :createdAt');
    expressionAttributeNames['#lastLoginAt'] = 'lastLoginAt';
    expressionAttributeValues[':createdAt'] = createdAt;
    conditionExpression.push('attribute_not_exists(lastLoginAt)');
  } else {
    stats.alreadyHasLoginAt++;
  }

  // Check if lastActionAt needs backfill
  if (!lastActionAt) {
    updates.push('#lastActionAt = :createdAt');
    expressionAttributeNames['#lastActionAt'] = 'lastActionAt';

    // Reuse :createdAt if already set, otherwise add it
    if (!expressionAttributeValues[':createdAt']) {
      expressionAttributeValues[':createdAt'] = createdAt;
    }

    conditionExpression.push('attribute_not_exists(lastActionAt)');
  } else {
    stats.alreadyHasActionAt++;
  }

  // If nothing to update, skip
  if (updates.length === 0) {
    return;
  }

  // Also update updatedAt timestamp
  updates.push('updatedAt = :now');
  expressionAttributeValues[':now'] = new Date().toISOString();

  try {
    await dynamo.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK, SK },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ConditionExpression: conditionExpression.join(' OR '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }));

    // Track what was updated
    if (!lastLoginAt) stats.updatedLoginAt++;
    if (!lastActionAt) stats.updatedActionAt++;

    console.log(`✅ Updated ${userId} (${email}): ${updates.slice(0, -1).join(', ')}`);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Another process already updated this record (concurrent backfill) - safe to ignore
      console.log(`ℹ️  ${userId} (${email}) already updated by concurrent process`);
    } else {
      stats.errors++;
      console.error(`❌ Failed to update ${userId} (${email}):`, err.message);
    }
  }
}

/**
 * Scan talent-flow-users table and backfill timestamps
 */
async function backfillAllUsers() {
  console.log('🚀 Starting backfill of user login timestamps...\n');
  console.log(`📋 Table: ${TABLE_NAME}`);
  console.log(`📅 Strategy: Set lastLoginAt = lastActionAt = createdAt\n`);

  let lastEvaluatedKey = undefined;
  let pageCount = 0;

  do {
    pageCount++;
    console.log(`📄 Scanning page ${pageCount}...`);

    const scanResult = await dynamo.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'SK = :profile',
      ExpressionAttributeValues: {
        ':profile': 'PROFILE',
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    stats.totalScanned += scanResult.Items.length;

    // Process each user
    for (const user of scanResult.Items) {
      await backfillUser(user);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKFILL COMPLETE - SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total users scanned:              ${stats.totalScanned}`);
  console.log(`Already had lastLoginAt:          ${stats.alreadyHasLoginAt}`);
  console.log(`Already had lastActionAt:         ${stats.alreadyHasActionAt}`);
  console.log(`Updated lastLoginAt:              ${stats.updatedLoginAt}`);
  console.log(`Updated lastActionAt:             ${stats.updatedActionAt}`);
  console.log(`Errors:                           ${stats.errors}`);
  console.log('='.repeat(60));

  if (stats.errors > 0) {
    console.log('\n⚠️  Some errors occurred. Review logs above for details.');
    process.exit(1);
  } else {
    console.log('\n✅ All users backfilled successfully!');
    process.exit(0);
  }
}

// Run backfill
backfillAllUsers().catch(err => {
  console.error('\n❌ FATAL ERROR:', err);
  process.exit(1);
});
