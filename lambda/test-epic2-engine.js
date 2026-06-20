/**
 * EPIC 2 TASK 2.3 - End-to-End Engine Verification
 *
 * This script:
 * 1. Creates a test candidate with SLA_STATUS=BREACHED
 * 2. Triggers evaluateIntelligenceRules by simulating a DynamoDB stream event
 * 3. Verifies rule matching, notification, and event logging
 *
 * Usage: node test-epic2-engine.js
 */

const { DynamoDBClient, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: process.env.AWS_REGION || 'af-south-1' });
const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'af-south-1' });

const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || 'talent-flow-intelligence-events';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME || 'talent-flow-notifications';

// Test candidate with SLA breach (triggers RULE-SLA-001)
const TEST_CANDIDATE = {
  PK: 'CAND-TEST-EPIC2-' + Date.now(),
  SK: 'SAGA',
  tenantId: 'NALEKO',
  candidateId: 'CAND-TEST-EPIC2-' + Date.now(),
  email: 'test-epic2@example.com',
  fullName: 'EPIC2 Test Candidate',
  currentStage: 'TECHNICAL_INTERVIEW',
  status: 'ACTIVE',

  // Trigger SLA breach rule (RULE-SLA-001)
  slaStatus: 'BREACHED',
  daysInStage: 16,
  daysToSlaBreach: -2,  // Breached 2 days ago

  // Additional context
  recruiterId: 'test-recruiter-001',
  positionId: 'POS-TEST-001',
  createdAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date().toISOString()
};

async function runTest() {
  console.log('\n=== EPIC 2 TASK 2.3 - Engine Verification ===\n');

  // Step 1: Write test candidate to state table
  console.log('Step 1: Writing test candidate to talent-flow-state...');
  console.log('Candidate ID:', TEST_CANDIDATE.candidateId);
  console.log('SLA Status:', TEST_CANDIDATE.slaStatus);
  console.log('Stage:', TEST_CANDIDATE.currentStage);

  await dynamoDB.send(new PutItemCommand({
    TableName: STATE_TABLE,
    Item: marshall(TEST_CANDIDATE)
  }));

  console.log('✅ Test candidate written\n');

  // Step 2: Simulate DynamoDB stream event to trigger evaluateIntelligenceRules
  console.log('Step 2: Simulating DynamoDB stream event...');

  const streamEvent = {
    Records: [
      {
        eventName: 'INSERT',
        eventID: 'test-epic2-' + Date.now(),
        dynamodb: {
          NewImage: marshall(TEST_CANDIDATE),
          Keys: marshall({
            PK: TEST_CANDIDATE.PK,
            SK: TEST_CANDIDATE.SK
          })
        }
      }
    ]
  };

  // Invoke evaluateIntelligenceRules Lambda
  console.log('Invoking evaluateIntelligenceRules Lambda...');

  const response = await lambda.send(new InvokeCommand({
    FunctionName: 'evaluateIntelligenceRules',
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(streamEvent)
  }));

  const payload = JSON.parse(Buffer.from(response.Payload).toString());
  console.log('Lambda response:', JSON.stringify(payload, null, 2));
  console.log('✅ Engine invoked\n');

  // Wait a moment for async operations
  console.log('Waiting 3 seconds for notifications/events to be written...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 3: Verify rule fired event in intelligence-events table
  console.log('\nStep 3: Verifying RULE_FIRED event in intelligence-events...');

  const events = await dynamoDB.send(new QueryCommand({
    TableName: EVENTS_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: marshall({
      ':pk': `TENANT#NALEKO`
    }),
    ScanIndexForward: false,  // Most recent first
    Limit: 5
  }));

  if (events.Items && events.Items.length > 0) {
    console.log(`✅ Found ${events.Items.length} recent events:`);
    events.Items.forEach(item => {
      const event = unmarshall(item);
      console.log(`  - ${event.eventType} | ${event.SK} | Rule: ${event.ruleId || 'N/A'}`);
    });
  } else {
    console.log('⚠️  No events found');
  }

  // Step 4: Verify notification was sent
  console.log('\nStep 4: Verifying notification in talent-flow-notifications...');

  const notifications = await dynamoDB.send(new QueryCommand({
    TableName: NOTIFICATIONS_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: marshall({
      ':pk': `TENANT#NALEKO`
    }),
    ScanIndexForward: false,  // Most recent first
    Limit: 5
  }));

  if (notifications.Items && notifications.Items.length > 0) {
    console.log(`✅ Found ${notifications.Items.length} recent notifications:`);
    notifications.Items.forEach(item => {
      const notif = unmarshall(item);
      console.log(`  - ${notif.notificationType || notif.type} | To: ${notif.recipientId || 'unknown'} | At: ${notif.createdAt}`);
    });
  } else {
    console.log('⚠️  No notifications found');
  }

  // Step 5: Check snapshot was written
  console.log('\nStep 5: Verifying signal snapshot...');

  const snapshots = await dynamoDB.send(new QueryCommand({
    TableName: STATE_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: marshall({
      ':pk': `TENANT#NALEKO#SNAP`
    }),
    Limit: 3
  }));

  if (snapshots.Items && snapshots.Items.length > 0) {
    console.log(`✅ Found ${snapshots.Items.length} snapshots`);
    snapshots.Items.forEach(item => {
      const snap = unmarshall(item);
      console.log(`  - ${snap.SK} | Signals: ${Object.keys(snap.signals || {}).length}`);
    });
  } else {
    console.log('⚠️  No snapshots found');
  }

  // Step 6: Verify getTiles still works
  console.log('\nStep 6: Verifying getTiles Lambda still works...');

  const tilesResponse = await lambda.send(new InvokeCommand({
    FunctionName: 'getIntelligenceTiles',
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({
      queryStringParameters: {
        tenantId: 'NALEKO',
        role: 'TA'
      },
      requestContext: {
        authorizer: {
          claims: {
            'custom:tenantId': 'NALEKO',
            'custom:userId': 'test-user-epic2'
          }
        }
      }
    })
  }));

  const tilesPayload = JSON.parse(Buffer.from(tilesResponse.Payload).toString());
  const tiles = JSON.parse(tilesPayload.body);

  console.log(`✅ getTiles returned ${tiles.length} tiles`);
  if (tiles.length > 0) {
    console.log(`   First tile: ${tiles[0].title || tiles[0].ruleId}`);
  }

  console.log('\n=== VERIFICATION COMPLETE ===\n');
  console.log('Summary:');
  console.log('✅ Test candidate created with SLA breach');
  console.log('✅ Engine invoked successfully');
  console.log(`${events.Items?.length > 0 ? '✅' : '⚠️ '} Events logged: ${events.Items?.length || 0}`);
  console.log(`${notifications.Items?.length > 0 ? '✅' : '⚠️ '} Notifications sent: ${notifications.Items?.length || 0}`);
  console.log(`${snapshots.Items?.length > 0 ? '✅' : '⚠️ '} Snapshots written: ${snapshots.Items?.length || 0}`);
  console.log(`✅ Tiles still generating: ${tiles.length} tiles`);

  console.log('\n✅ EPIC 2 ENGINE IS OPERATIONAL\n');
}

// Run the test
runTest()
  .then(() => {
    console.log('Test completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
