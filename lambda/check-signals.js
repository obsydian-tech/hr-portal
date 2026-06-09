const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'af-south-1' }));

const candidateId = process.argv[2] || 'CAND-EPIC4-T2-1781015177757-1';

(async () => {
  const result = await client.send(new GetCommand({
    TableName: 'talent-flow-state',
    Key: {
      PK: 'TENANT#NALEKO#SNAP',
      SK: `CAND#${candidateId}`
    }
  }));

  if (!result.Item) {
    console.log('❌ SNAPSHOT does not exist for', candidateId);
    return;
  }

  const signals = result.Item.signals || {};
  console.log('\nSignals for', candidateId);
  console.log('='.repeat(80));
  console.log('CANDIDATE_STAGE:', JSON.stringify(signals.CANDIDATE_STAGE));
  console.log('OFFER_STATE:', JSON.stringify(signals.OFFER_STATE));
  console.log('DAYS_SINCE_OFFER_SENT:', JSON.stringify(signals.DAYS_SINCE_OFFER_SENT));
  console.log('APPROVAL_STEP_AGE:', JSON.stringify(signals.APPROVAL_STEP_AGE));
  console.log('\nTotal signals:', Object.keys(signals).length);
  console.log('\nAll offer/approval signals:');
  Object.keys(signals).filter(k => k.includes('OFFER') || k.includes('APPROVAL')).forEach(k => {
    console.log(`  ${k}: ${JSON.stringify(signals[k])}`);
  });
})();
