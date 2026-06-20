/**
 * Notification Verification Tool
 *
 * Verifies that notifications are being delivered correctly
 * and identifies any issues with notification delivery
 *
 * Usage: AWS_REGION=af-south-1 node verify-notifications.js
 */

const { DynamoDBClient, QueryCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: process.env.AWS_REGION || 'af-south-1' });
const logsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION || 'af-south-1' });

const EVENTS_TABLE = 'talent-flow-intelligence-events';
const NOTIFICATIONS_TABLE = 'talent-flow-notifications';
const STATE_TABLE = 'talent-flow-state';
const TENANT_ID = 'NALEKO';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bright: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '═'.repeat(80));
  log(`  ${title}`, colors.bright + colors.cyan);
  console.log('═'.repeat(80) + '\n');
}

async function fetchRuleFiredEvents(hours = 24) {
  const result = await dynamoDB.send(new QueryCommand({
    TableName: EVENTS_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `TENANT#${TENANT_ID}` }
    },
    ScanIndexForward: false,
    Limit: 200
  }));

  const events = (result.Items || []).map(item => unmarshall(item));
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);

  return events.filter(e => {
    const timestamp = new Date(e.SK.split('#')[1]).getTime();
    return timestamp > cutoff;
  });
}

async function fetchNotifications(hours = 24) {
  const result = await dynamoDB.send(new QueryCommand({
    TableName: NOTIFICATIONS_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `TENANT#${TENANT_ID}` }
    },
    ScanIndexForward: false,
    Limit: 200
  }));

  const notifications = (result.Items || []).map(item => unmarshall(item));
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);

  return notifications.filter(n => {
    const createdAt = n.createdAt || n.SK.split('#')[1];
    const timestamp = new Date(createdAt).getTime();
    return timestamp > cutoff;
  });
}

async function checkCandidateOwners() {
  // Sample a few candidates to check if they have owners
  const result = await dynamoDB.send(new ScanCommand({
    TableName: STATE_TABLE,
    FilterExpression: 'SK = :sk AND attribute_exists(candidateId)',
    ExpressionAttributeValues: {
      ':sk': { S: 'SAGA' }
    },
    Limit: 10
  }));

  const candidates = (result.Items || []).map(item => unmarshall(item));

  const withOwners = candidates.filter(c => c.recruiterId || c.hiringManagerId);
  const withoutOwners = candidates.filter(c => !c.recruiterId && !c.hiringManagerId);

  return {
    total: candidates.length,
    withOwners: withOwners.length,
    withoutOwners: withoutOwners.length,
    samples: {
      withOwner: withOwners[0],
      withoutOwner: withoutOwners[0]
    }
  };
}

async function fetchNotificationLambdaLogs(minutes = 30) {
  const startTime = Date.now() - (minutes * 60 * 1000);

  try {
    const response = await logsClient.send(new FilterLogEventsCommand({
      logGroupName: '/aws/lambda/sendTalentFlowNotification',
      startTime,
      limit: 50
    }));

    return response.events || [];
  } catch (error) {
    return [];
  }
}

async function verifyNotificationDelivery() {
  section('🔔 NOTIFICATION DELIVERY VERIFICATION');

  log('Fetching data from last 24 hours...', colors.cyan);
  console.log('');

  const [ruleFiredEvents, notifications, candidateOwnerInfo, notifLogs] = await Promise.all([
    fetchRuleFiredEvents(24),
    fetchNotifications(24),
    checkCandidateOwners(),
    fetchNotificationLambdaLogs(30)
  ]);

  // Analysis 1: Rule Fires vs Notifications
  section('📊 Rule Fires vs Notifications Sent');

  log(`Rule Fired Events: ${colors.bright}${ruleFiredEvents.length}${colors.reset}`, colors.cyan);
  log(`Notifications Sent: ${colors.bright}${notifications.length}${colors.reset}`, colors.cyan);

  const deliveryRate = ruleFiredEvents.length > 0
    ? ((notifications.length / ruleFiredEvents.length) * 100).toFixed(1)
    : 0;

  log(`Delivery Rate: ${colors.bright}${deliveryRate}%${colors.reset}`, colors.cyan);

  if (deliveryRate < 50 && ruleFiredEvents.length > 0) {
    console.log('');
    log('⚠️  WARNING: Low notification delivery rate!', colors.yellow);
    log('This suggests notifications are not reaching the table.', colors.dim);
  } else if (deliveryRate >= 90) {
    console.log('');
    log('✅ Excellent delivery rate!', colors.green);
  }

  // Analysis 2: Candidate Owner Assignment
  section('👤 Candidate Owner Assignment');

  log(`Sampled Candidates: ${colors.bright}${candidateOwnerInfo.total}${colors.reset}`, colors.cyan);
  log(`With Owners: ${colors.bright}${candidateOwnerInfo.withOwners}${colors.reset} (${((candidateOwnerInfo.withOwners / candidateOwnerInfo.total) * 100).toFixed(0)}%)`, colors.green);
  log(`Without Owners: ${colors.bright}${candidateOwnerInfo.withoutOwners}${colors.reset} (${((candidateOwnerInfo.withoutOwners / candidateOwnerInfo.total) * 100).toFixed(0)}%)`, colors.yellow);

  if (candidateOwnerInfo.withoutOwners > 0) {
    console.log('');
    log('⚠️  Some candidates lack owner assignment', colors.yellow);
    log('Notifications cannot be sent without recipientId (recruiterId/hiringManagerId)', colors.dim);

    if (candidateOwnerInfo.samples.withoutOwner) {
      log(`\nExample candidate without owner: ${candidateOwnerInfo.samples.withoutOwner.candidateId}`, colors.dim);
    }
  }

  // Analysis 3: Notification Breakdown
  section('📋 Notification Breakdown');

  if (notifications.length === 0) {
    log('No notifications found in last 24 hours', colors.yellow);
    console.log('');
    log('Possible reasons:', colors.yellow);
    log('  1. Rules are not matching (check CloudWatch logs)', colors.dim);
    log('  2. Candidates lack recruiterId/hiringManagerId', colors.dim);
    log('  3. sendTalentFlowNotification Lambda has errors', colors.dim);
  } else {
    const byType = {};
    const byRecipient = {};
    const byRule = {};

    notifications.forEach(n => {
      const type = n.notificationType || n.type || 'UNKNOWN';
      byType[type] = (byType[type] || 0) + 1;

      const recipient = n.recipientId || 'UNKNOWN';
      byRecipient[recipient] = (byRecipient[recipient] || 0) + 1;

      const rule = n.ruleId || 'UNKNOWN';
      byRule[rule] = (byRule[rule] || 0) + 1;
    });

    log('By Notification Type:', colors.cyan);
    Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        log(`  ${type}: ${colors.bright}${count}${colors.reset}`, colors.green);
      });

    console.log('');
    log('By Rule:', colors.cyan);
    Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .forEach(([rule, count]) => {
        log(`  ${rule}: ${colors.bright}${count}${colors.reset}`, colors.green);
      });

    console.log('');
    log('By Recipient:', colors.cyan);
    Object.entries(byRecipient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([recipient, count]) => {
        log(`  ${recipient}: ${colors.bright}${count}${colors.reset}`, colors.dim);
      });

    console.log('');
    log('Recent Notifications:', colors.cyan);
    notifications.slice(0, 5).forEach(n => {
      const time = new Date(n.createdAt || n.SK.split('#')[1]).toLocaleString();
      const type = n.notificationType || n.type;
      const recipient = n.recipientId || 'N/A';
      log(`  ${time} - ${type} → ${recipient}`, colors.dim);
    });
  }

  // Analysis 4: sendTalentFlowNotification Lambda Health
  section('⚙️  sendTalentFlowNotification Lambda Status');

  if (notifLogs.length === 0) {
    log('⚠️  No recent logs found for sendTalentFlowNotification Lambda', colors.yellow);
    log('This may indicate the Lambda is not being invoked', colors.dim);
  } else {
    log(`Recent invocations: ${colors.bright}${notifLogs.length}${colors.reset}`, colors.green);

    // Check for errors
    const errors = notifLogs.filter(log => {
      try {
        const parsed = JSON.parse(log.message);
        return parsed.level === 'ERROR' || log.message.includes('ERROR');
      } catch {
        return log.message.includes('ERROR');
      }
    });

    if (errors.length > 0) {
      log(`Errors detected: ${colors.bright}${errors.length}${colors.reset}`, colors.red);
      console.log('');
      log('Recent errors:', colors.red);
      errors.slice(0, 3).forEach(error => {
        log(`  ${error.message.substring(0, 100)}`, colors.dim);
      });
    } else {
      log('No errors detected', colors.green);
    }
  }

  // Recommendations
  section('💡 Recommendations');

  const recommendations = [];

  if (ruleFiredEvents.length > 0 && notifications.length === 0) {
    recommendations.push('🔴 CRITICAL: Rules are firing but no notifications are being sent');
    recommendations.push('   Action: Check sendTalentFlowNotification Lambda logs for errors');
    recommendations.push('   Action: Verify candidates have recruiterId or hiringManagerId assigned');
  }

  if (candidateOwnerInfo.withoutOwners > candidateOwnerInfo.withOwners) {
    recommendations.push('⚠️  Most candidates lack owner assignment');
    recommendations.push('   Action: Ensure recruiterId/hiringManagerId is set when creating candidates');
    recommendations.push('   Action: Backfill existing candidates with owner assignments');
  }

  if (deliveryRate < 50 && ruleFiredEvents.length > 5) {
    recommendations.push('⚠️  Low notification delivery rate (<50%)');
    recommendations.push('   Action: Investigate sendTalentFlowNotification Lambda');
    recommendations.push('   Action: Check DynamoDB permissions for talent-flow-notifications table');
  }

  if (notifLogs.length === 0 && ruleFiredEvents.length > 0) {
    recommendations.push('⚠️  Notification Lambda not being invoked despite rule fires');
    recommendations.push('   Action: Check evaluateIntelligenceRules invocation logic');
    recommendations.push('   Action: Verify Lambda permissions and IAM roles');
  }

  if (recommendations.length === 0) {
    log('✅ Notification delivery is working correctly!', colors.green);
    log('All checks passed. Continue monitoring.', colors.dim);
  } else {
    recommendations.forEach(rec => {
      if (rec.startsWith('🔴')) {
        log(rec, colors.red);
      } else if (rec.startsWith('⚠️')) {
        log(rec, colors.yellow);
      } else {
        log(rec, colors.dim);
      }
    });
  }

  // Summary
  section('📊 Summary');

  const status = notifications.length > 0 ? '✅ OPERATIONAL' : '⚠️  NEEDS ATTENTION';
  const statusColor = notifications.length > 0 ? colors.green : colors.yellow;

  log(`Overall Status: ${statusColor}${status}${colors.reset}`, colors.bright);
  log(`Rule Fires (24h): ${ruleFiredEvents.length}`, colors.dim);
  log(`Notifications (24h): ${notifications.length}`, colors.dim);
  log(`Delivery Rate: ${deliveryRate}%`, colors.dim);
  log(`Candidates with Owners: ${candidateOwnerInfo.withOwners}/${candidateOwnerInfo.total}`, colors.dim);

  console.log('\n' + '═'.repeat(80) + '\n');
}

// Run verification
verifyNotificationDelivery()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    console.error(error.stack);
    process.exit(1);
  });
