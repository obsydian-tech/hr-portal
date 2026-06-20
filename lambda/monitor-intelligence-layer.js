/**
 * Intelligence Layer - Production Monitoring Dashboard
 *
 * Real-time monitoring of rule fires, notifications, and system health
 *
 * Usage: AWS_REGION=af-south-1 node monitor-intelligence-layer.js
 *
 * Features:
 * - Live CloudWatch log streaming
 * - Rule firing statistics
 * - Notification delivery tracking
 * - Performance metrics
 * - Alert on anomalies
 */

const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const logsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION || 'af-south-1' });
const dynamoDB = new DynamoDBClient({ region: process.env.AWS_REGION || 'af-south-1' });

const LOG_GROUP = '/aws/lambda/evaluateIntelligenceRules';
const EVENTS_TABLE = 'talent-flow-intelligence-events';
const NOTIFICATIONS_TABLE = 'talent-flow-notifications';
const TENANT_ID = 'NALEKO';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// State tracking
const stats = {
  ruleMatches: {},
  totalMatches: 0,
  totalSkips: 0,
  notificationsSent: 0,
  avgDuration: 0,
  durations: [],
  errors: 0,
  lastUpdate: Date.now()
};

function log(message, color = colors.reset) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${message}${colors.reset}`);
}

function header(text) {
  console.log('\n' + colors.bright + colors.cyan + '═'.repeat(80) + colors.reset);
  console.log(colors.bright + colors.cyan + `  ${text}` + colors.reset);
  console.log(colors.bright + colors.cyan + '═'.repeat(80) + colors.reset + '\n');
}

function section(text) {
  console.log('\n' + colors.blue + '─'.repeat(80) + colors.reset);
  console.log(colors.bright + colors.blue + `  ${text}` + colors.reset);
  console.log(colors.blue + '─'.repeat(80) + colors.reset);
}

async function fetchRecentEvents(minutes = 10) {
  const startTime = Date.now() - (minutes * 60 * 1000);

  try {
    const response = await logsClient.send(new FilterLogEventsCommand({
      logGroupName: LOG_GROUP,
      startTime,
      filterPattern: '"Rule matched" OR "Rule skipped" OR "Batch complete" OR "Config loaded"'
    }));

    return response.events || [];
  } catch (error) {
    log(`Error fetching logs: ${error.message}`, colors.red);
    return [];
  }
}

async function fetchRuleFiredEvents(hours = 1) {
  const result = await dynamoDB.send(new QueryCommand({
    TableName: EVENTS_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `TENANT#${TENANT_ID}` }
    },
    ScanIndexForward: false,
    Limit: 100
  }));

  const events = (result.Items || []).map(item => unmarshall(item));

  // Filter by time
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return events.filter(e => {
    const timestamp = new Date(e.SK.split('#')[1]).getTime();
    return timestamp > cutoff;
  });
}

async function fetchNotifications(hours = 1) {
  const result = await dynamoDB.send(new QueryCommand({
    TableName: NOTIFICATIONS_TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `TENANT#${TENANT_ID}` }
    },
    ScanIndexForward: false,
    Limit: 50
  }));

  const notifications = (result.Items || []).map(item => unmarshall(item));

  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return notifications.filter(n => {
    const timestamp = new Date(n.createdAt || n.SK.split('#')[1]).getTime();
    return timestamp > cutoff;
  });
}

function parseLogEvent(event) {
  try {
    const message = JSON.parse(event.message);
    return message;
  } catch {
    return { message: event.message };
  }
}

function analyzeRulePerformance(events) {
  const ruleStats = {};
  let totalDuration = 0;
  let durationCount = 0;

  events.forEach(event => {
    const parsed = parseLogEvent(event);

    // Track rule matches
    if (parsed.message && parsed.message.includes('Rule matched')) {
      const match = parsed.message.match(/ruleId: '([^']+)'/);
      if (match) {
        const ruleId = match[1];
        ruleStats[ruleId] = ruleStats[ruleId] || { matches: 0, skips: 0 };
        ruleStats[ruleId].matches++;
        stats.totalMatches++;
        stats.ruleMatches[ruleId] = (stats.ruleMatches[ruleId] || 0) + 1;
      }
    }

    // Track rule skips
    if (parsed.message && parsed.message.includes('Rule skipped')) {
      const match = parsed.message.match(/ruleId: '([^']+)'/);
      if (match) {
        const ruleId = match[1];
        ruleStats[ruleId] = ruleStats[ruleId] || { matches: 0, skips: 0 };
        ruleStats[ruleId].skips++;
        stats.totalSkips++;
      }
    }

    // Track duration
    if (parsed.record && parsed.record.metrics && parsed.record.metrics.durationMs) {
      totalDuration += parsed.record.metrics.durationMs;
      durationCount++;
      stats.durations.push(parsed.record.metrics.durationMs);
    }
  });

  if (durationCount > 0) {
    stats.avgDuration = totalDuration / durationCount;
  }

  return ruleStats;
}

function displayDashboard(ruleStats, ruleFiredEvents, notifications) {
  // Clear console
  console.clear();

  header('🎯 INTELLIGENCE LAYER - PRODUCTION MONITORING DASHBOARD');

  // System Status
  section('📊 System Status');
  const uptime = Math.floor((Date.now() - stats.lastUpdate) / 1000);
  log(`Status: ${colors.green}OPERATIONAL${colors.reset}`, colors.bright);
  log(`Region: af-south-1`, colors.dim);
  log(`Tenant: ${TENANT_ID}`, colors.dim);
  log(`Monitoring: ${LOG_GROUP}`, colors.dim);
  log(`Dashboard Updated: ${new Date().toLocaleTimeString()}`, colors.dim);

  // Rule Firing Statistics (Last 10 minutes from logs)
  section('🔥 Rule Firing Statistics (Last 10 Minutes)');

  if (Object.keys(ruleStats).length === 0) {
    log('No rule activity in the last 10 minutes', colors.yellow);
  } else {
    console.log(colors.bright + '  Rule ID          │ Matches │ Skips │ Match Rate' + colors.reset);
    console.log('  ' + '─'.repeat(70));

    Object.entries(ruleStats)
      .sort((a, b) => b[1].matches - a[1].matches)
      .forEach(([ruleId, stats]) => {
        const total = stats.matches + stats.skips;
        const matchRate = total > 0 ? ((stats.matches / total) * 100).toFixed(1) : '0.0';
        const color = stats.matches > 0 ? colors.green : colors.dim;

        console.log(
          `  ${color}${ruleId.padEnd(16)}${colors.reset} │ ` +
          `${color}${String(stats.matches).padStart(7)}${colors.reset} │ ` +
          `${colors.dim}${String(stats.skips).padStart(5)}${colors.reset} │ ` +
          `${color}${matchRate.padStart(7)}%${colors.reset}`
        );
      });
  }

  // Rule Events (Last Hour from DynamoDB)
  section('📝 Recent Rule Events (Last Hour)');

  if (ruleFiredEvents.length === 0) {
    log('No RULE_FIRED events in the last hour', colors.yellow);
  } else {
    const eventsByRule = {};
    ruleFiredEvents.forEach(e => {
      eventsByRule[e.ruleId] = (eventsByRule[e.ruleId] || 0) + 1;
    });

    log(`Total Events: ${colors.bright}${ruleFiredEvents.length}${colors.reset}`, colors.cyan);
    console.log('\n  ' + colors.bright + 'Rule ID          │ Count │ Latest Event' + colors.reset);
    console.log('  ' + '─'.repeat(70));

    Object.entries(eventsByRule)
      .sort((a, b) => b[1] - a[1])
      .forEach(([ruleId, count]) => {
        const latestEvent = ruleFiredEvents.find(e => e.ruleId === ruleId);
        const timestamp = latestEvent.SK.split('#')[1];
        const timeAgo = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);

        console.log(
          `  ${colors.green}${ruleId.padEnd(16)}${colors.reset} │ ` +
          `${colors.bright}${String(count).padStart(5)}${colors.reset} │ ` +
          `${colors.dim}${timeAgo} minutes ago${colors.reset}`
        );
      });

    // Show recent events
    log('\n  Recent Events:', colors.cyan);
    ruleFiredEvents.slice(0, 5).forEach(event => {
      const timestamp = new Date(event.SK.split('#')[1]).toLocaleTimeString();
      log(`    ${timestamp} - ${colors.green}${event.ruleId}${colors.reset} → ${event.entityId}`, colors.dim);
    });
  }

  // Notifications (Last Hour)
  section('🔔 Notification Delivery (Last Hour)');

  if (notifications.length === 0) {
    log('No notifications sent in the last hour', colors.yellow);
    log('Note: Notifications require candidates with assigned owners (recruiterId/hiringManagerId)', colors.dim);
  } else {
    log(`Total Notifications: ${colors.bright}${notifications.length}${colors.reset}`, colors.cyan);

    const notifsByType = {};
    notifications.forEach(n => {
      const type = n.notificationType || n.type || 'UNKNOWN';
      notifsByType[type] = (notifsByType[type] || 0) + 1;
    });

    console.log('\n  ' + colors.bright + 'Type                 │ Count' + colors.reset);
    console.log('  ' + '─'.repeat(40));

    Object.entries(notifsByType).forEach(([type, count]) => {
      console.log(`  ${colors.green}${type.padEnd(20)}${colors.reset} │ ${colors.bright}${count}${colors.reset}`);
    });

    // Show recent notifications
    log('\n  Recent Notifications:', colors.cyan);
    notifications.slice(0, 5).forEach(notif => {
      const timestamp = new Date(notif.createdAt || notif.SK.split('#')[1]).toLocaleTimeString();
      const recipient = notif.recipientId || 'N/A';
      log(`    ${timestamp} - ${colors.cyan}${notif.notificationType || notif.type}${colors.reset} → ${recipient}`, colors.dim);
    });
  }

  // Performance Metrics
  section('⚡ Performance Metrics');

  if (stats.durations.length > 0) {
    const sorted = [...stats.durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    log(`Average Duration: ${colors.bright}${stats.avgDuration.toFixed(0)}ms${colors.reset}`, colors.cyan);
    log(`P50 (Median): ${p50.toFixed(0)}ms`, colors.dim);
    log(`P95: ${p95.toFixed(0)}ms`, colors.dim);
    log(`P99: ${p99.toFixed(0)}ms`, colors.dim);
    log(`Invocations: ${stats.durations.length}`, colors.dim);
  } else {
    log('No performance data available yet', colors.yellow);
  }

  // Health Indicators
  section('💚 Health Indicators');

  const healthChecks = [
    {
      name: 'Rule Engine',
      status: ruleStats && Object.keys(ruleStats).length > 0 ? 'ACTIVE' : 'IDLE',
      color: ruleStats && Object.keys(ruleStats).length > 0 ? colors.green : colors.yellow
    },
    {
      name: 'Rule Matches',
      status: stats.totalMatches > 0 ? `${stats.totalMatches} matches` : 'No matches yet',
      color: stats.totalMatches > 0 ? colors.green : colors.yellow
    },
    {
      name: 'Notifications',
      status: notifications.length > 0 ? `${notifications.length} sent` : 'None sent',
      color: notifications.length > 0 ? colors.green : colors.yellow
    },
    {
      name: 'Performance',
      status: stats.avgDuration > 0 ? `${stats.avgDuration.toFixed(0)}ms avg` : 'N/A',
      color: stats.avgDuration < 500 ? colors.green : stats.avgDuration < 1000 ? colors.yellow : colors.red
    },
    {
      name: 'Errors',
      status: stats.errors === 0 ? 'None detected' : `${stats.errors} errors`,
      color: stats.errors === 0 ? colors.green : colors.red
    }
  ];

  healthChecks.forEach(check => {
    console.log(`  ${check.color}●${colors.reset} ${check.name.padEnd(20)} ${check.color}${check.status}${colors.reset}`);
  });

  // Recommendations
  section('💡 Recommendations');

  const recommendations = [];

  if (stats.totalMatches === 0 && stats.totalSkips > 50) {
    recommendations.push('⚠️  Rules are being evaluated but not matching. Consider:');
    recommendations.push('   - Check if real candidate data meets rule conditions');
    recommendations.push('   - Review rule thresholds in Admin → Intelligence Rules');
  }

  if (notifications.length === 0 && stats.totalMatches > 0) {
    recommendations.push('⚠️  Rules are matching but no notifications sent. Check:');
    recommendations.push('   - Candidates have assigned recruiterId/hiringManagerId');
    recommendations.push('   - sendTalentFlowNotification Lambda logs');
  }

  if (stats.avgDuration > 500) {
    recommendations.push('⚠️  Average duration above 500ms. Consider:');
    recommendations.push('   - Check Lambda memory allocation (currently 512MB)');
    recommendations.push('   - Review signal calculation performance');
  }

  if (recommendations.length === 0) {
    log('✅ System performing optimally', colors.green);
  } else {
    recommendations.forEach(rec => log(rec, colors.yellow));
  }

  // Instructions
  console.log('\n' + colors.dim + '─'.repeat(80) + colors.reset);
  log('Press Ctrl+C to stop monitoring', colors.dim);
  log('Dashboard refreshes every 30 seconds', colors.dim);
  console.log(colors.dim + '─'.repeat(80) + colors.reset + '\n');
}

async function runMonitoring() {
  header('🚀 Starting Intelligence Layer Monitoring');
  log('Initializing...', colors.cyan);

  // Initial fetch
  await updateDashboard();

  // Refresh every 30 seconds
  setInterval(async () => {
    await updateDashboard();
  }, 30000);
}

async function updateDashboard() {
  try {
    // Fetch data
    const [events, ruleFiredEvents, notifications] = await Promise.all([
      fetchRecentEvents(10),
      fetchRuleFiredEvents(1),
      fetchNotifications(1)
    ]);

    // Analyze
    const ruleStats = analyzeRulePerformance(events);

    // Display
    displayDashboard(ruleStats, ruleFiredEvents, notifications);

    stats.lastUpdate = Date.now();
  } catch (error) {
    log(`Error updating dashboard: ${error.message}`, colors.red);
    stats.errors++;
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n' + colors.cyan + '═'.repeat(80) + colors.reset);
  log('Monitoring stopped', colors.yellow);
  log(`Total rule matches observed: ${stats.totalMatches}`, colors.cyan);
  log(`Total notifications: ${stats.notificationsSent}`, colors.cyan);
  console.log(colors.cyan + '═'.repeat(80) + colors.reset + '\n');
  process.exit(0);
});

// Run
runMonitoring().catch(error => {
  console.error(colors.red + 'Fatal error:' + colors.reset, error);
  process.exit(1);
});
