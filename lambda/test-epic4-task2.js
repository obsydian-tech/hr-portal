/**
 * EPIC 4 TASK 4.2 - Offer/Approval Signals Test
 *
 * This script tests:
 * 1. OFFER_STATE - Returns current offer status
 * 2. DAYS_SINCE_OFFER_SENT - Calculates days since offer sent
 * 3. APPROVAL_STEP_AGE - Calculates days in current approval step
 *
 * Usage: AWS_REGION=af-south-1 node test-epic4-task2.js
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'af-south-1' }));
const STATE_TABLE = 'talent-flow-state';
const candidateIdBase = `CAND-EPIC4-T2-${Date.now()}`;

console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('🚀 EPIC 4 TASK 4.2 - Offer/Approval Signals Test');
console.log('════════════════════════════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════════

async function setupTestCandidates() {
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const testCases = [
    {
      id: `${candidateIdBase}-1`,
      name: 'Offer Sent - Pending Response',
      data: {
        PK: `CANDIDATE#${candidateIdBase}-1`,
        SK: 'SAGA',
        candidateId: `${candidateIdBase}-1`,
        tenantId: 'NALEKO',
        candidateName: 'Alice Offer',
        candidateStage: 'OFFER',
        offerStatus: 'SENT',
        offerSentAt: fiveDaysAgo.toISOString(), // 5 days ago
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      expected: {
        OFFER_STATE: 'SENT',
        DAYS_SINCE_OFFER_SENT: 5
      }
    },
    {
      id: `${candidateIdBase}-2`,
      name: 'Offer in Approval - HM Review',
      data: {
        PK: `CANDIDATE#${candidateIdBase}-2`,
        SK: 'SAGA',
        candidateId: `${candidateIdBase}-2`,
        tenantId: 'NALEKO',
        candidateName: 'Bob Approval',
        candidateStage: 'OFFER',
        offerStatus: 'PENDING_APPROVAL',
        currentApprovalStep: 'HM_REVIEW',
        approvalStartedAt: tenDaysAgo.toISOString(), // Started 10 days ago
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      expected: {
        OFFER_STATE: 'PENDING_APPROVAL',
        DAYS_SINCE_OFFER_SENT: null, // Not sent yet
        APPROVAL_STEP_AGE: 10 // Will test with history too
      }
    },
    {
      id: `${candidateIdBase}-3`,
      name: 'Offer Accepted',
      data: {
        PK: `CANDIDATE#${candidateIdBase}-3`,
        SK: 'SAGA',
        candidateId: `${candidateIdBase}-3`,
        tenantId: 'NALEKO',
        candidateName: 'Charlie Accepted',
        candidateStage: 'OFFER',
        offerStatus: 'ACCEPTED',
        offerSentAt: tenDaysAgo.toISOString(),
        offerAcceptedAt: threeDaysAgo.toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      expected: {
        OFFER_STATE: 'ACCEPTED',
        DAYS_SINCE_OFFER_SENT: 10
      }
    },
    {
      id: `${candidateIdBase}-4`,
      name: 'No Offer Yet',
      data: {
        PK: `CANDIDATE#${candidateIdBase}-4`,
        SK: 'SAGA',
        candidateId: `${candidateIdBase}-4`,
        tenantId: 'NALEKO',
        candidateName: 'Diana NoOffer',
        candidateStage: 'EVALUATION',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      expected: {
        OFFER_STATE: null,
        DAYS_SINCE_OFFER_SENT: null,
        APPROVAL_STEP_AGE: null
      }
    }
  ];

  console.log('📝 Creating test candidates...\n');

  for (const testCase of testCases) {
    await dynamoDB.send(new PutCommand({
      TableName: STATE_TABLE,
      Item: testCase.data
    }));
    console.log(`✅ Created: ${testCase.name} (${testCase.id})`);
  }

  // Create APPROVAL# history for candidate 2
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  await dynamoDB.send(new PutCommand({
    TableName: STATE_TABLE,
    Item: {
      PK: `CANDIDATE#${candidateIdBase}-2`,
      SK: `APPROVAL#${sevenDaysAgo.toISOString()}`,
      candidateId: `${candidateIdBase}-2`,
      fromStep: null,
      toStep: 'HM_REVIEW', // Entered HM_REVIEW 7 days ago
      actor: 'system',
      timestamp: sevenDaysAgo.toISOString(),
      recordType: 'APPROVAL_HISTORY',
      createdAt: sevenDaysAgo.toISOString()
    }
  }));
  console.log(`✅ Created APPROVAL# history for ${candidateIdBase}-2 (HM_REVIEW entry 7 days ago)`);

  // Add another earlier step for candidate 2
  await dynamoDB.send(new PutCommand({
    TableName: STATE_TABLE,
    Item: {
      PK: `CANDIDATE#${candidateIdBase}-2`,
      SK: `APPROVAL#${tenDaysAgo.toISOString()}`,
      candidateId: `${candidateIdBase}-2`,
      fromStep: null,
      toStep: 'TA_REVIEW', // Started at TA_REVIEW 10 days ago
      actor: 'system',
      timestamp: tenDaysAgo.toISOString(),
      recordType: 'APPROVAL_HISTORY',
      createdAt: tenDaysAgo.toISOString()
    }
  }));
  console.log(`✅ Created APPROVAL# history for ${candidateIdBase}-2 (TA_REVIEW entry 10 days ago)`);

  console.log('\n════════════════════════════════════════════════════════════════════════════════\n');

  return testCases;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Execution
// ═══════════════════════════════════════════════════════════════════════════════

async function waitForSignalsToCompute(candidateId) {
  // Wait for signals to be computed by stream processor
  console.log(`⏳ Waiting for signals to compute for ${candidateId}...`);
  await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds
}

async function verifySignals(testCase) {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log(`   Candidate ID: ${testCase.id}`);

  await waitForSignalsToCompute(testCase.id);

  // Query the SNAPSHOT record (stored in TENANT#NALEKO#SNAP partition)
  const result = await dynamoDB.send(new QueryCommand({
    TableName: STATE_TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: {
      ':pk': 'TENANT#NALEKO#SNAP',
      ':sk': `CAND#${testCase.id}`
    }
  }));

  if (!result.Items || result.Items.length === 0) {
    console.log('   ❌ SNAPSHOT not found - signals not computed yet');
    return false;
  }

  const snapshot = result.Items[0];
  const signals = snapshot.signals || {};

  // Verify each expected signal
  let allPass = true;

  console.log('   Signals:');
  console.log(`     OFFER_STATE: ${JSON.stringify(signals.OFFER_STATE)}`);
  console.log(`     DAYS_SINCE_OFFER_SENT: ${JSON.stringify(signals.DAYS_SINCE_OFFER_SENT)}`);
  console.log(`     APPROVAL_STEP_AGE: ${JSON.stringify(signals.APPROVAL_STEP_AGE)}`);

  // Check OFFER_STATE
  if (testCase.expected.OFFER_STATE !== undefined) {
    const match = signals.OFFER_STATE === testCase.expected.OFFER_STATE;
    const icon = match ? '✅' : '❌';
    console.log(`   ${icon} OFFER_STATE: expected ${testCase.expected.OFFER_STATE}, got ${signals.OFFER_STATE}`);
    if (!match) allPass = false;
  }

  // Check DAYS_SINCE_OFFER_SENT
  if (testCase.expected.DAYS_SINCE_OFFER_SENT !== undefined) {
    const match = signals.DAYS_SINCE_OFFER_SENT === testCase.expected.DAYS_SINCE_OFFER_SENT;
    const icon = match ? '✅' : '❌';
    console.log(`   ${icon} DAYS_SINCE_OFFER_SENT: expected ${testCase.expected.DAYS_SINCE_OFFER_SENT}, got ${signals.DAYS_SINCE_OFFER_SENT}`);
    if (!match) allPass = false;
  }

  // Check APPROVAL_STEP_AGE (special case for candidate 2 - should use history)
  if (testCase.id === `${candidateIdBase}-2`) {
    // Should be 7 days (from APPROVAL# history, not 10 from approvalStartedAt)
    const expected = 7;
    const match = signals.APPROVAL_STEP_AGE === expected;
    const icon = match ? '✅' : '❌';
    console.log(`   ${icon} APPROVAL_STEP_AGE: expected ${expected} (from history), got ${signals.APPROVAL_STEP_AGE}`);
    if (!match) allPass = false;
  } else if (testCase.expected.APPROVAL_STEP_AGE !== undefined) {
    const match = signals.APPROVAL_STEP_AGE === testCase.expected.APPROVAL_STEP_AGE;
    const icon = match ? '✅' : '❌';
    console.log(`   ${icon} APPROVAL_STEP_AGE: expected ${testCase.expected.APPROVAL_STEP_AGE}, got ${signals.APPROVAL_STEP_AGE}`);
    if (!match) allPass = false;
  }

  return allPass;
}

async function runTests() {
  try {
    // Setup
    const testCases = await setupTestCandidates();

    // Wait for stream processing
    console.log('⏳ Waiting for DynamoDB streams to process records...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds

    // Test each candidate
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('🧪 Verifying Signals');
    console.log('════════════════════════════════════════════════════════════════════════════════');

    let allPassed = true;
    for (const testCase of testCases) {
      const passed = await verifySignals(testCase);
      if (!passed) allPassed = false;
    }

    console.log('\n════════════════════════════════════════════════════════════════════════════════');
    if (allPassed) {
      console.log('✅ ALL TESTS PASSED!');
    } else {
      console.log('❌ SOME TESTS FAILED');
    }
    console.log('════════════════════════════════════════════════════════════════════════════════\n');

    console.log('💡 Check CloudWatch logs for signal calculation details:');
    console.log('   aws logs tail /aws/lambda/evaluateIntelligenceRules --region af-south-1 --since 5m --follow\n');

    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Execute
// ═══════════════════════════════════════════════════════════════════════════════

runTests();
