# Intelligence Layer Implementation Plan
## Naleko TalentFlow - AI-Powered Hiring Manager Actions

**Branch:** develop
**Prerequisites:** ✅ User Activity Tracking Complete (INTEL-001)
**Estimated Duration:** 3-4 weeks
**Status:** READY TO START

---

## 📋 Executive Summary

**Objective:** Implement AI-powered decision engine that automatically suggests actions to Hiring Managers based on candidate pipeline state and user activity patterns.

**Architecture:** Event-driven Lambda functions that:
1. Monitor candidate state changes via DynamoDB streams
2. Evaluate Intent Model rules against current state + signals
3. Generate action recommendations
4. Store decisions in audit log
5. Notify HMs via existing notification system

**Unblocked Signals (from INTEL-001):**
- ✅ HM_DAYS_SINCE_LOGIN (from lastLoginAt)
- ✅ TA_DAYS_SINCE_CANDIDATE_ACTION (from lastActionAt)
- ✅ SLA_BREACH_HOURS (existing)
- ✅ SLA_THRESHOLD_HOURS (existing)
- ✅ CANDIDATE_STAGE (existing)
- ✅ CANDIDATE_STATUS (existing)

**Success Criteria:**
- MVP rule operational (SLA-only)
- Rules 001 and 002 deployed
- 90%+ recommendation accuracy
- <5 second decision latency
- Zero false positives in first week

---

## 🏗️ Architecture Overview

### Components to Build

```
DynamoDB Stream (talent-flow-state)
    ↓
evaluateIntelligenceRules Lambda
    ↓ (reads Intent Model)
talent-flow-config table
    ↓ (reads user activity)
talent-flow-users table
    ↓ (writes decision log)
talent-flow-user-actions table
    ↓ (publishes event)
EventBridge (talent-flow-bus)
    ↓
sendTalentFlowNotification Lambda
    ↓
Hiring Manager (email/dashboard notification)
```

### Data Flow

1. **Trigger:** Candidate state changes (SAGA update)
2. **Evaluate:** Check all active rules in Intent Model
3. **Calculate:** Compute signals from current state + user data
4. **Decide:** Match rules → generate recommendation
5. **Log:** Store decision in audit table
6. **Notify:** Send notification if action recommended

---

## 📊 Implementation Phases

### Phase 1: Infrastructure Setup (Week 1)
**Goal:** Create tables, Lambda, and basic evaluation framework

**Tasks:**
1.1. Create talent-flow-user-actions table (decision log)
1.2. Create evaluateIntelligenceRules Lambda skeleton
1.3. Set up DynamoDB stream trigger
1.4. Create config reader for Intent Model
1.5. Deploy infrastructure via Terraform

**Deliverables:**
- ✅ talent-flow-user-actions table operational
- ✅ Lambda triggered by stream
- ✅ Can read Intent Model from config
- ✅ Can write decisions to actions table

---

### Phase 2: MVP Rule (Week 1-2)
**Goal:** Prove architecture with simple SLA-only rule

**MVP Rule:** "Notify HM when candidate SLA breached by >24 hours"

**Signals Required:**
- SLA_BREACH_HOURS (existing)
- CANDIDATE_STAGE (existing)

**Tasks:**
2.1. Implement signal calculation framework
2.2. Create rule matching engine
2.3. Implement MVP rule logic
2.4. Test with real candidate data
2.5. Deploy and monitor for 48 hours

**Success Criteria:**
- ✅ Rule triggers correctly on SLA breach
- ✅ No false positives
- ✅ Latency <5 seconds
- ✅ HM receives notification

---

### Phase 3: User Activity Rules (Week 2-3)
**Goal:** Add Rules 001 and 002 (now unblocked)

**RULE-001: Expiring Offer with Inactive HM**
```
IF:
  - candidate.stage = OFFER_IN_APPROVAL
  - HM_DAYS_SINCE_LOGIN > 3
  - offer.expiryDate - today < 5 days
THEN:
  ACTION: NUDGE_HM_REVIEW_OFFER
  PRIORITY: HIGH
```

**RULE-002: SLA Breach with No TA Action**
```
IF:
  - SLA_BREACH_HOURS > 24
  - TA_DAYS_SINCE_CANDIDATE_ACTION > 2
  - candidate.status = ACTIVE
THEN:
  ACTION: NUDGE_TA_PROGRESS_CANDIDATE
  PRIORITY: MEDIUM
```

**Tasks:**
3.1. Implement HM_DAYS_SINCE_LOGIN signal calculation
3.2. Implement TA_DAYS_SINCE_CANDIDATE_ACTION signal calculation
3.3. Add Rule 001 to Intent Model
3.4. Add Rule 002 to Intent Model
3.5. Test both rules end-to-end
3.6. Deploy to production
3.7. Monitor for 1 week

**Success Criteria:**
- ✅ Both rules trigger correctly
- ✅ Accuracy >90%
- ✅ No spam (max 1 notification per rule per day per candidate)

---

### Phase 4: Additional Rules (Week 3-4)
**Goal:** Add remaining rules from Intent Model

**RULE-003: Offer Lifecycle** (verify offer structure first)
**RULE-004: IT Task Tracking** (verify architecture first - separate table)
**RULE-005: Negative Sentiment** (existing events operational)

**Tasks:**
4.1. Verify offer structure in talent-flow-state
4.2. Verify IT tasks architecture (separate table)
4.3. Implement remaining signals
4.4. Add Rules 003, 004, 005 to Intent Model
4.5. Test and deploy incrementally

---

## 📐 Detailed Design

### 1. talent-flow-user-actions Table

**Purpose:** Decision log / audit trail

**Schema:**
```
PK: ACTION#{ulid}           # Unique action ID
SK: CANDIDATE#{candidateId} # GSI for candidate history

Attributes:
- actionId: ulid
- candidateId: string
- userId: string            # HM being notified
- ruleId: string            # Which rule triggered
- action: string            # NUDGE_HM_REVIEW_OFFER, etc.
- priority: HIGH|MEDIUM|LOW
- signals: object           # Snapshot of signals at decision time
- decision: RECOMMEND|SKIP|ERROR
- reason: string            # Why this decision was made
- notificationSent: boolean
- notificationId: string    # Reference to notification
- createdAt: ISO8601
- ttl: number              # Auto-delete after 90 days
```

**GSI:**
- GSI1: PK=CANDIDATE#{candidateId}, SK=ACTION#{actionId}
  - Query: Get all actions for a candidate
- GSI2: PK=USER#{userId}, SK=createdAt
  - Query: Get all actions for a user (HM dashboard)

**TTL:** 90 days (compliance + cost optimization)

---

### 2. evaluateIntelligenceRules Lambda

**Trigger:** DynamoDB Stream on talent-flow-state (SAGA updates)

**Flow:**
```javascript
export const handler = async (event) => {
  // 1. Filter for SAGA records
  const sagaUpdates = event.Records.filter(r =>
    r.dynamodb.NewImage.SK.S === 'SAGA'
  );

  // 2. For each SAGA update:
  for (const record of sagaUpdates) {
    const candidate = unmarshal(record.dynamodb.NewImage);
    const candidateId = candidate.candidateId;

    // 3. Load Intent Model from config
    const intentModel = await loadIntentModel();

    // 4. Calculate signals
    const signals = await calculateSignals(candidate);

    // 5. Evaluate all active rules
    const matchedRules = evaluateRules(intentModel.rules, signals);

    // 6. For each matched rule:
    for (const rule of matchedRules) {
      // Check if we already acted on this recently (de-dupe)
      const recentAction = await checkRecentAction(candidateId, rule.id);
      if (recentAction) {
        console.log('Skipping - already acted recently');
        continue;
      }

      // 7. Generate recommendation
      const action = generateAction(rule, candidate, signals);

      // 8. Log decision
      await logAction(action);

      // 9. Publish notification event
      await publishNotificationEvent(action);
    }
  }

  return { statusCode: 200, processed: sagaUpdates.length };
};
```

**Configuration:**
- Runtime: nodejs22.x
- Memory: 512MB (need to calculate signals)
- Timeout: 60s
- Batch size: 10
- Retry: 3 attempts with bisect

**Error Handling:**
- Log all errors
- Return partial batch failures
- Don't block candidate pipeline on intelligence errors

---

### 3. Signal Calculation

**Framework:**
```javascript
const signalCalculators = {
  SLA_BREACH_HOURS: (candidate) => {
    const now = Date.now();
    const slaDeadline = new Date(candidate.slaDeadline).getTime();
    return Math.max(0, (now - slaDeadline) / (1000 * 60 * 60));
  },

  HM_DAYS_SINCE_LOGIN: async (candidate) => {
    const hm = await getUser(candidate.hiringManagerId);
    if (!hm.lastLoginAt) return 999; // Never logged in
    const daysSince = (Date.now() - new Date(hm.lastLoginAt).getTime()) / (1000 * 60 * 60 * 24);
    return Math.floor(daysSince);
  },

  TA_DAYS_SINCE_CANDIDATE_ACTION: async (candidate) => {
    const ta = await getUser(candidate.assignedTA);
    if (!ta.lastActionAt) return 999;
    const daysSince = (Date.now() - new Date(ta.lastActionAt).getTime()) / (1000 * 60 * 60 * 24);
    return Math.floor(daysSince);
  },

  CANDIDATE_STAGE: (candidate) => candidate.currentStage,
  CANDIDATE_STATUS: (candidate) => candidate.status,
  OFFER_DAYS_TO_EXPIRY: (candidate, offer) => {
    if (!offer) return null;
    const daysToExpiry = (new Date(offer.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return Math.ceil(daysToExpiry);
  },
};

async function calculateSignals(candidate) {
  const signals = {};
  for (const [name, calculator] of Object.entries(signalCalculators)) {
    try {
      signals[name] = await calculator(candidate);
    } catch (err) {
      console.error(`Failed to calculate signal ${name}:`, err);
      signals[name] = null; // Null signal = skip rules that depend on it
    }
  }
  return signals;
}
```

---

### 4. Rule Matching Engine

**Intent Model Structure (in talent-flow-config):**
```json
{
  "PK": "INTENT_MODEL",
  "SK": "v1.0",
  "version": "1.0",
  "updatedAt": "2026-06-08T00:00:00Z",
  "rules": [
    {
      "id": "RULE-001",
      "name": "Expiring Offer with Inactive HM",
      "enabled": true,
      "priority": "HIGH",
      "conditions": [
        { "signal": "CANDIDATE_STAGE", "operator": "equals", "value": "OFFER_IN_APPROVAL" },
        { "signal": "HM_DAYS_SINCE_LOGIN", "operator": "greaterThan", "value": 3 },
        { "signal": "OFFER_DAYS_TO_EXPIRY", "operator": "lessThan", "value": 5 }
      ],
      "action": {
        "type": "NUDGE_HM_REVIEW_OFFER",
        "priority": "HIGH",
        "cooldown": 24 // hours - don't re-trigger within 24 hours
      }
    }
  ]
}
```

**Evaluation Logic:**
```javascript
function evaluateRules(rules, signals) {
  return rules
    .filter(rule => rule.enabled)
    .filter(rule => {
      // Check if all conditions match
      return rule.conditions.every(condition => {
        const signalValue = signals[condition.signal];
        if (signalValue === null || signalValue === undefined) {
          return false; // Can't evaluate if signal missing
        }
        return evaluateCondition(signalValue, condition.operator, condition.value);
      });
    });
}

function evaluateCondition(actual, operator, expected) {
  switch (operator) {
    case 'equals': return actual === expected;
    case 'notEquals': return actual !== expected;
    case 'greaterThan': return actual > expected;
    case 'lessThan': return actual < expected;
    case 'greaterThanOrEqual': return actual >= expected;
    case 'lessThanOrEqual': return actual <= expected;
    case 'in': return expected.includes(actual);
    case 'notIn': return !expected.includes(actual);
    default: throw new Error(`Unknown operator: ${operator}`);
  }
}
```

---

### 5. Action Generation

```javascript
function generateAction(rule, candidate, signals) {
  return {
    actionId: ulid(),
    candidateId: candidate.candidateId,
    userId: candidate.hiringManagerId, // Or assignedTA for TA rules
    ruleId: rule.id,
    action: rule.action.type,
    priority: rule.action.priority,
    signals: signals, // Snapshot for audit
    decision: 'RECOMMEND',
    reason: `Rule ${rule.id} matched: ${rule.name}`,
    notificationSent: false,
    createdAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days
  };
}
```

---

### 6. De-duplication (Cooldown)

**Problem:** Same rule might match on every SAGA update (e.g., every hour)

**Solution:** Check recent actions before creating new one

```javascript
async function checkRecentAction(candidateId, ruleId) {
  const cooldownHours = 24; // From rule.action.cooldown
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();

  const result = await dynamo.send(new QueryCommand({
    TableName: 'talent-flow-user-actions',
    IndexName: 'GSI1',
    KeyConditionExpression: 'PK = :candidateKey',
    FilterExpression: 'ruleId = :ruleId AND createdAt > :cutoff',
    ExpressionAttributeValues: {
      ':candidateKey': `CANDIDATE#${candidateId}`,
      ':ruleId': ruleId,
      ':cutoff': cutoff
    }
  }));

  return result.Items.length > 0;
}
```

---

### 7. Notification Integration

**EventBridge Event:**
```json
{
  "source": "talent-flow.intelligence",
  "detail-type": "ActionRecommended",
  "detail": {
    "actionId": "01HXYZ...",
    "candidateId": "CAND-01...",
    "userId": "user-123",
    "action": "NUDGE_HM_REVIEW_OFFER",
    "priority": "HIGH",
    "reason": "Offer expires in 4 days and HM hasn't logged in for 5 days"
  }
}
```

**Notification Lambda (existing sendTalentFlowNotification):**
- Already handles EventBridge events
- Add new event type: `ActionRecommended`
- Map action types to notification templates
- Send email + dashboard notification

---

## 🧪 Testing Strategy

### Unit Tests

**evaluateIntelligenceRules Lambda:**
- ✅ Signal calculation (mock DynamoDB responses)
- ✅ Rule matching (various signal combinations)
- ✅ Condition evaluation (all operators)
- ✅ Action generation
- ✅ De-duplication logic

**Test Cases:**
```javascript
describe('Signal Calculation', () => {
  it('calculates HM_DAYS_SINCE_LOGIN correctly', async () => {
    const hm = { lastLoginAt: '2026-06-01T00:00:00Z' };
    const days = await calculateHMDaysSinceLogin(hm);
    expect(days).toBe(7); // If today is 2026-06-08
  });

  it('returns 999 if HM never logged in', async () => {
    const hm = { lastLoginAt: null };
    const days = await calculateHMDaysSinceLogin(hm);
    expect(days).toBe(999);
  });
});

describe('Rule Matching', () => {
  it('matches Rule 001 when all conditions met', () => {
    const signals = {
      CANDIDATE_STAGE: 'OFFER_IN_APPROVAL',
      HM_DAYS_SINCE_LOGIN: 5,
      OFFER_DAYS_TO_EXPIRY: 3
    };
    const matched = evaluateRule(RULE_001, signals);
    expect(matched).toBe(true);
  });

  it('does not match Rule 001 when HM recently logged in', () => {
    const signals = {
      CANDIDATE_STAGE: 'OFFER_IN_APPROVAL',
      HM_DAYS_SINCE_LOGIN: 1,
      OFFER_DAYS_TO_EXPIRY: 3
    };
    const matched = evaluateRule(RULE_001, signals);
    expect(matched).toBe(false);
  });
});
```

---

### Integration Tests

**Phase 2 (MVP):**
1. Create test candidate with SLA breach >24h
2. Wait for stream to trigger Lambda
3. Verify action logged in talent-flow-user-actions
4. Verify notification sent

**Phase 3 (User Activity Rules):**
1. Create test candidate in OFFER_IN_APPROVAL
2. Set HM lastLoginAt to 5 days ago
3. Set offer expiryDate to 3 days from now
4. Trigger SAGA update
5. Verify Rule 001 matches
6. Verify HM notified

**Phase 4 (All Rules):**
- End-to-end test for each rule
- Test rule combinations (multiple rules matching same candidate)
- Test cooldown (same rule doesn't spam)

---

### Production Smoke Tests

**After Each Phase Deployment:**
1. Monitor CloudWatch for 1 hour (no errors)
2. Check talent-flow-user-actions table (actions being created)
3. Verify notification delivery (check HM email)
4. Query decision log (validate decisions make sense)
5. Check for false positives (manual review of 10 recommendations)

---

## 📋 Implementation Checklist

### Phase 1: Infrastructure

- [ ] Task 1.1: Create talent-flow-user-actions table
  - [ ] Define schema
  - [ ] Create Terraform resource
  - [ ] Add GSI for candidate history
  - [ ] Add GSI for user dashboard
  - [ ] Enable TTL (90 days)
  - [ ] Apply Terraform

- [ ] Task 1.2: Create evaluateIntelligenceRules Lambda skeleton
  - [ ] Create lambda/evaluateIntelligenceRules/index.js
  - [ ] Add DynamoDB stream filtering (SAGA records only)
  - [ ] Add basic logging
  - [ ] Create package.json

- [ ] Task 1.3: Set up DynamoDB stream trigger
  - [ ] Create Terraform for event source mapping
  - [ ] Configure batch size: 10
  - [ ] Configure retry: 3 attempts
  - [ ] Configure bisect on error: true
  - [ ] Apply Terraform

- [ ] Task 1.4: Create config reader for Intent Model
  - [ ] Add getIntentModel() function
  - [ ] Cache config for 5 minutes
  - [ ] Handle config not found gracefully

- [ ] Task 1.5: Test infrastructure
  - [ ] Create test SAGA update
  - [ ] Verify Lambda triggered
  - [ ] Verify can read config
  - [ ] Verify can write to actions table

---

### Phase 2: MVP Rule

- [ ] Task 2.1: Implement signal calculation framework
  - [ ] Create signalCalculators object
  - [ ] Implement SLA_BREACH_HOURS calculator
  - [ ] Implement CANDIDATE_STAGE extractor
  - [ ] Add error handling for failed calculations
  - [ ] Unit test each calculator

- [ ] Task 2.2: Create rule matching engine
  - [ ] Implement evaluateRules() function
  - [ ] Implement evaluateCondition() for all operators
  - [ ] Add filtering for enabled rules only
  - [ ] Unit test rule matching

- [ ] Task 2.3: Implement MVP rule logic
  - [ ] Add MVP rule to Intent Model in config
  - [ ] Test rule matching with mock signals
  - [ ] Implement action generation
  - [ ] Implement de-duplication (24h cooldown)

- [ ] Task 2.4: Deploy MVP rule
  - [ ] Package Lambda with dependencies
  - [ ] Deploy Lambda code
  - [ ] Update Intent Model in talent-flow-config
  - [ ] Monitor CloudWatch for 1 hour

- [ ] Task 2.5: Test MVP rule end-to-end
  - [ ] Create test candidate with SLA breach
  - [ ] Wait for rule to trigger
  - [ ] Verify action logged
  - [ ] Verify notification sent
  - [ ] Verify cooldown works (doesn't spam)

---

### Phase 3: User Activity Rules

- [ ] Task 3.1: Implement user activity signal calculators
  - [ ] HM_DAYS_SINCE_LOGIN calculator
  - [ ] TA_DAYS_SINCE_CANDIDATE_ACTION calculator
  - [ ] OFFER_DAYS_TO_EXPIRY calculator
  - [ ] Unit test all calculators

- [ ] Task 3.2: Add Rule 001 to Intent Model
  - [ ] Define rule conditions
  - [ ] Define action (NUDGE_HM_REVIEW_OFFER)
  - [ ] Set cooldown (24 hours)
  - [ ] Deploy to config table

- [ ] Task 3.3: Add Rule 002 to Intent Model
  - [ ] Define rule conditions
  - [ ] Define action (NUDGE_TA_PROGRESS_CANDIDATE)
  - [ ] Set cooldown (24 hours)
  - [ ] Deploy to config table

- [ ] Task 3.4: Test Rule 001
  - [ ] Create test scenario (offer expiring, HM inactive)
  - [ ] Verify rule triggers
  - [ ] Verify HM notified
  - [ ] Verify no false positives

- [ ] Task 3.5: Test Rule 002
  - [ ] Create test scenario (SLA breach, TA inactive)
  - [ ] Verify rule triggers
  - [ ] Verify TA notified
  - [ ] Verify no false positives

- [ ] Task 3.6: Deploy to production
  - [ ] Deploy updated Lambda code
  - [ ] Enable both rules in config
  - [ ] Monitor for 1 week
  - [ ] Collect feedback from HMs/TAs

---

### Phase 4: Additional Rules

- [ ] Task 4.1: Verify offer structure
  - [ ] Read sample OFFER records from talent-flow-state
  - [ ] Confirm expiryDate, startDate, state fields exist
  - [ ] Update NALEKO-INTELLIGENCE-VERIFICATION-TRACKER.md

- [ ] Task 4.2: Verify IT tasks architecture
  - [ ] Investigate it-tasks table structure
  - [ ] Confirm how to link IT tasks to candidates
  - [ ] Determine if stream/event integration needed
  - [ ] Update architecture docs

- [ ] Task 4.3: Implement remaining signals
  - [ ] IT_DAYS_OVERDUE calculator
  - [ ] SENTIMENT_CAPTURED calculator
  - [ ] Any other signals for Rules 003-005

- [ ] Task 4.4: Add Rules 003, 004, 005 to Intent Model
  - [ ] Define each rule
  - [ ] Test individually
  - [ ] Deploy incrementally (one per week)

- [ ] Task 4.5: Final production validation
  - [ ] All 5 rules operational
  - [ ] Monitor for 1 week
  - [ ] Measure accuracy (target: >90%)
  - [ ] Collect stakeholder feedback
  - [ ] Document learnings

---

## 🎯 Success Metrics

### Technical Metrics

**Latency:**
- Target: <5 seconds from SAGA update to notification sent
- Measurement: CloudWatch duration metrics

**Accuracy:**
- Target: >90% of recommendations are acted upon by HMs
- Measurement: Track action.notificationClicked in actions table

**Reliability:**
- Target: 99.9% uptime
- Target: <1% error rate
- Measurement: CloudWatch error logs

**Cost:**
- Target: <$5/month for Lambda + DynamoDB
- Measurement: AWS Cost Explorer

---

### Business Metrics

**HM Engagement:**
- Target: 50% of HMs click on recommendations within 24 hours
- Measurement: Track clicks in actions table

**Pipeline Velocity:**
- Target: 10% reduction in SLA breaches after intelligence deployed
- Measurement: Compare pre/post SLA metrics

**Time to Hire:**
- Target: 5% reduction in average time to hire
- Measurement: Track from SOURCING to CONTRACT_SIGNED

---

## 🚨 Risk Mitigation

### Risk 1: False Positives (HM Spam)

**Likelihood:** MEDIUM
**Impact:** HIGH (HMs ignore all notifications)

**Mitigation:**
- Start with MVP rule only (high confidence)
- 24-hour cooldown on all rules
- Max 1 notification per candidate per day
- Monitor opt-out rate (should be <5%)
- A/B test rule thresholds before full rollout

---

### Risk 2: Signal Calculation Errors

**Likelihood:** MEDIUM
**Impact:** MEDIUM (incorrect recommendations)

**Mitigation:**
- Unit test all signal calculators
- Graceful handling of null signals (skip rule)
- Log all signal values for debugging
- Manual review of first 100 recommendations
- Rollback if accuracy <80%

---

### Risk 3: Performance Degradation

**Likelihood:** LOW
**Impact:** MEDIUM (slow notifications)

**Mitigation:**
- Lambda timeout: 60s (should complete in <5s)
- Batch size: 10 (prevents overload)
- Cache Intent Model (5-minute TTL)
- Use projection expressions (minimize data transfer)
- Monitor Lambda duration in CloudWatch

---

### Risk 4: Config Changes Break Rules

**Likelihood:** LOW
**Impact:** HIGH (all rules stop working)

**Mitigation:**
- Version Intent Model (v1.0, v1.1, etc.)
- Validate config schema before deployment
- Test rule matching after config updates
- Keep previous config version as backup
- Monitor error rate after config changes

---

## 🔄 Rollback Plan

### If Critical Issues Arise

**Step 1: Disable all rules**
```bash
# Update Intent Model to disable all rules
aws dynamodb update-item \
  --table-name talent-flow-config \
  --key '{"PK":{"S":"INTENT_MODEL"},"SK":{"S":"v1.0"}}' \
  --update-expression "SET #rules = :empty" \
  --expression-attribute-names '{"#rules":"rules"}' \
  --expression-attribute-values '{":empty":{"L":[]}}'
```

**Step 2: Disable Lambda (stops evaluation)**
```bash
aws lambda update-event-source-mapping \
  --uuid <mapping-uuid> \
  --no-enabled
```

**Step 3: Revert Lambda code**
```bash
# Deploy previous working version
aws lambda update-function-code \
  --function-name evaluateIntelligenceRules \
  --zip-file fileb://backup/previous-version.zip
```

**Impact:** Notifications stop, but no data loss or pipeline blocking

---

## 📚 Documentation Requirements

### For Development Team

- [ ] API documentation for action recommendation events
- [ ] Signal calculation formulas (for future signals)
- [ ] Rule authoring guide (how to add new rules)
- [ ] Testing guide (how to test rules locally)
- [ ] Troubleshooting guide (common issues)

### For Stakeholders

- [ ] User guide: What notifications mean
- [ ] FAQ: Why am I receiving this?
- [ ] Opt-out process (if needed)
- [ ] Feedback mechanism

### For Operations

- [ ] Monitoring setup (CloudWatch dashboards)
- [ ] Alert configuration (error rate, latency)
- [ ] Runbook: What to do if rules malfunction
- [ ] Incident response plan

---

## 🎓 Lessons from User Activity Tracking (Apply Here)

1. **Test Lambda code manually before debugging triggers**
   - Create test events for evaluateIntelligenceRules
   - Verify rule matching works before enabling stream

2. **Start simple, add complexity incrementally**
   - MVP rule first (SLA-only)
   - Add user activity rules second
   - Add remaining rules last

3. **Silent failure for non-critical paths**
   - Log signal calculation errors but don't crash
   - Skip rules with missing signals
   - Don't block candidate pipeline

4. **Comprehensive logging**
   - Log all matched rules
   - Log all signal values
   - Log why rules were skipped
   - Log notification outcomes

5. **De-duplication is critical**
   - 24-hour cooldown prevents spam
   - Check recent actions before creating new ones
   - Max 1 notification per candidate per day

---

## 📅 Estimated Timeline

### Week 1: Infrastructure + MVP
- Days 1-2: Create tables, Lambda skeleton, Terraform
- Days 3-4: Implement MVP rule
- Day 5: Test and deploy MVP

### Week 2: User Activity Rules
- Days 1-2: Implement signal calculators
- Days 3-4: Add Rules 001 and 002
- Day 5: Test and deploy

### Week 3: Additional Rules (Part 1)
- Days 1-2: Verify offer + IT architecture
- Days 3-4: Implement Rule 003 (offers)
- Day 5: Test and deploy

### Week 4: Additional Rules (Part 2) + Optimization
- Days 1-2: Implement Rules 004 and 005
- Days 3-4: Test all 5 rules together
- Day 5: Tune thresholds, collect feedback

**Total:** 4 weeks to full Intelligence Layer operational

---

## ✅ Definition of Done

**Infrastructure Complete When:**
- ✅ talent-flow-user-actions table deployed
- ✅ evaluateIntelligenceRules Lambda deployed
- ✅ DynamoDB stream trigger working
- ✅ Can read Intent Model from config
- ✅ Can write decisions to actions table

**MVP Complete When:**
- ✅ SLA rule triggers automatically
- ✅ HM receives notification
- ✅ No false positives in 48 hours
- ✅ Latency <5 seconds
- ✅ Error rate <1%

**User Activity Rules Complete When:**
- ✅ Rules 001 and 002 operational
- ✅ Accuracy >90%
- ✅ HM/TA click rate >30%
- ✅ No spam complaints
- ✅ Monitored for 1 week without issues

**Full Implementation Complete When:**
- ✅ All 5 rules operational
- ✅ Accuracy >90% overall
- ✅ Time to hire reduced by 5%
- ✅ SLA breaches reduced by 10%
- ✅ Stakeholder approval
- ✅ Documentation complete

---

## 🚀 Ready to Start

**Prerequisites Met:**
- ✅ User activity tracking operational
- ✅ All signals unblocked
- ✅ Architecture validated
- ✅ Team approval

**Next Action:** Create Phase 1 tasks and begin infrastructure setup

---

**End of Intelligence Layer Implementation Plan**
