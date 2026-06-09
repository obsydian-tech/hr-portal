/**
 * Cleanup Old Test Candidates
 * Removes duplicate EPIC4 test candidates, keeping only the most recent set
 */

const { DynamoDBClient, QueryCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: process.env.AWS_REGION || 'af-south-1' });

// Keep only candidates created after this timestamp
const KEEP_AFTER = '2026-06-09T15:45:00.000Z'; // Keep only most recent test run

async function getAllTestCandidates() {
  const result = await dynamoDB.send(new QueryCommand({
    TableName: 'talent-flow-state',
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': { S: 'TENANT#NALEKO#SNAP' },
      ':sk': { S: 'CAND#CAND-EPIC4' },
    },
  }));

  return (result.Items || []).map(item => unmarshall(item));
}

async function deleteCandidate(candidateId) {
  console.log(`  Deleting ${candidateId}...`);

  // Delete snapshot
  await dynamoDB.send(new DeleteItemCommand({
    TableName: 'talent-flow-state',
    Key: {
      PK: { S: 'TENANT#NALEKO#SNAP' },
      SK: { S: candidateId },
    },
  }));

  // Extract actual candidate ID (remove CAND# prefix)
  const actualId = candidateId.replace('CAND#', '');

  // Delete candidate record
  try {
    await dynamoDB.send(new DeleteItemCommand({
      TableName: 'talent-flow-state',
      Key: {
        PK: { S: `CANDIDATE#${actualId}` },
        SK: { S: 'SAGA' },
      },
    }));
  } catch (e) {
    // Ignore if candidate record doesn't exist
  }

  // Delete any votes
  try {
    const votesResult = await dynamoDB.send(new QueryCommand({
      TableName: 'talent-flow-state',
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `CANDIDATE#${actualId}` },
        ':sk': { S: 'VOTE#' },
      },
    }));

    for (const voteItem of votesResult.Items || []) {
      await dynamoDB.send(new DeleteItemCommand({
        TableName: 'talent-flow-state',
        Key: {
          PK: voteItem.PK,
          SK: voteItem.SK,
        },
      }));
    }
  } catch (e) {
    // Ignore
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('🧹 CLEANUP OLD TEST CANDIDATES');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log(`Keeping candidates created after: ${KEEP_AFTER}`);
  console.log();

  const allCandidates = await getAllTestCandidates();
  console.log(`Found ${allCandidates.length} EPIC4 test candidates`);

  const toKeep = allCandidates.filter(c => c.computedAt >= KEEP_AFTER);
  const toDelete = allCandidates.filter(c => c.computedAt < KEEP_AFTER);

  console.log(`  Keep: ${toKeep.length} candidates`);
  console.log(`  Delete: ${toDelete.length} candidates`);

  if (toDelete.length === 0) {
    console.log('\n✅ No old candidates to delete');
    return;
  }

  console.log('\n🗑️  Deleting old candidates:');
  for (const candidate of toDelete) {
    console.log(`  - ${candidate.entityName} (${candidate.SK}) - ${candidate.computedAt}`);
    await deleteCandidate(candidate.SK);
  }

  console.log('\n✅ Cleanup complete!');
  console.log(`Deleted ${toDelete.length} old test candidates`);
  console.log(`Kept ${toKeep.length} recent test candidates`);

  console.log('\n📊 Remaining test candidates:');
  for (const candidate of toKeep) {
    console.log(`  ✅ ${candidate.entityName} (${candidate.SK}) - ${candidate.computedAt}`);
  }
}

main().catch(console.error);
