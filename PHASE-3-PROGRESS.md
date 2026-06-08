# Intelligence Layer - Phase 3 Progress

**Date Started:** TBD
**Phase:** Lambda Rule Evaluation Engine
**Status:** NOT STARTED

---

## Phase 3 Goal

**Build the Lambda that evaluates intelligence rules and triggers notifications when candidate data changes.**

---

## Prerequisites (From Phase 2)

✅ **Backend Config Storage Ready:**
- talent-flow-config table supports INTELLIGENCE_RULES
- manageTalentFlowConfig Lambda handles CRUD
- config-reader.js has INTELLIGENCE_RULES default

✅ **Admin UI Ready:**
- AdminIntelligenceRulesComponent functional
- TypeScript types defined (IntelligenceRule, RuleCondition, RuleAction)
- Save/load flow working

✅ **Architecture Patterns Documented:**
- INTELLIGENCE-LAYER-INVESTIGATION.md
- ADMIN-UI-PATTERNS-REFERENCE.md
- All existing patterns analyzed

---

## Phase 3 Tasks (To Be Planned)

### Task 3.1: Create Lambda Structure
- Create lambda/evaluateIntelligenceRules/ directory
- Set up package.json with dependencies
- Create index.js with handler skeleton
- Decide on internal module structure

### Task 3.2: Implement Config Loading
- Reuse config-reader.js pattern
- Load INTELLIGENCE_RULES for tenant
- Handle config read failures (fail-open)
- Add 5-minute cache

### Task 3.3: Implement Signal Calculators
- HM_DAYS_SINCE_LOGIN (from talent-flow-users.lastLoginAt)
- OFFER_DAYS_TO_EXPIRY (from offer.expiryDate)
- CANDIDATE_STAGE (from candidate.currentStage)
- TA_DAYS_SINCE_CANDIDATE_ACTION (from talent-flow-users.lastActionAt)
- Make signals extensible for future rules

### Task 3.4: Implement Rule Evaluator
- Evaluate conditions (equals, notEquals, greaterThan, lessThan, in, notIn)
- Support AND logic (all conditions must match)
- Handle missing signals gracefully (skip rule)
- Log rule matches and skips

### Task 3.5: Implement Action Handler
- Process matched rules
- Create notifications (schema TBD in Phase 4)
- Check cooldown (prevent spam)
- Log actions taken

### Task 3.6: Add DynamoDB Stream Trigger
- Configure event source mapping
- Filter for relevant records (candidates, offers)
- Set batch size and error handling
- Add bisect on error

### Task 3.7: Add IAM Permissions
- Read talent-flow-config (for rules)
- Read talent-flow-state (for candidate/offer data)
- Read talent-flow-users (for user activity signals)
- Write talent-flow-notifications (for action results)
- KMS decrypt permissions

### Task 3.8: Add Terraform Infrastructure
- Lambda function resource
- IAM role and policies
- Event source mapping
- CloudWatch log group
- Environment variables

### Task 3.9: Test Rule Evaluation
- Create test candidate
- Configure test rule in admin UI
- Trigger candidate update
- Verify rule evaluation
- Verify notification creation

---

## Key Decisions (To Be Made in Phase 3)

### 1. Notification Schema
**Question:** Where/how do we store notifications?

**Options:**
- A) Reuse talent-flow-state with SK prefix NOTIFICATION#
- B) Create new talent-flow-notifications table
- C) Create in-memory and send immediately (no persistence)

**Recommendation:** TBD (depends on requirements)

### 2. Cooldown Tracking
**Question:** How do we track cooldowns to prevent spam?

**Options:**
- A) Store lastTriggeredAt in rule-specific record
- B) Check notification history before creating new one
- C) In-memory cache (lost on Lambda cold start)

**Recommendation:** TBD

### 3. Signal Extensibility
**Question:** How do we make signals easy to add?

**Options:**
- A) Signal registry with calculator functions
- B) Hard-coded if/else for each signal
- C) Plugin system (overkill for MVP)

**Recommendation:** A (signal registry pattern)

### 4. Error Handling Strategy
**Question:** What happens when rule evaluation fails?

**Options:**
- A) Fail-open (skip notification, log error)
- B) Fail-closed (retry, then DLQ)
- C) Hybrid (fail-open for Intelligence Layer, fail-closed for critical signals)

**Recommendation:** A (fail-open) - Intelligence Layer is advisory, not critical

---

## Architecture Patterns to Follow

### From INTELLIGENCE-LAYER-INVESTIGATION.md:

**Lambda Structure:**
```javascript
const { getConfig } = require('/opt/config-reader');  // Lambda layer

exports.handler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== 'MODIFY' && record.eventName !== 'INSERT') continue;

    const candidate = unmarshall(record.dynamodb.NewImage);
    const { candidateId, tenantId } = candidate;

    // Load tenant-specific rules
    let intelligenceConfig;
    try {
      intelligenceConfig = await getConfig(tenantId, 'INTELLIGENCE_RULES');
    } catch (err) {
      console.warn('[evaluateIntelligenceRules] Config read failed — skipping:', err.message);
      continue;
    }

    const rules = intelligenceConfig.rules || [];

    // Calculate signals
    const signals = await calculateSignals(candidate);

    // Evaluate rules
    for (const rule of rules) {
      if (!rule.enabled) continue;

      const matched = rule.conditions.every(condition => {
        const signalValue = signals[condition.signal];
        if (signalValue == null) return false;
        return evaluateCondition(signalValue, condition.operator, condition.value);
      });

      if (matched) {
        console.info('RULE_MATCHED', { candidateId, ruleId: rule.id });
        await processAction(rule, candidate, signals);
      }
    }
  }
};
```

**Error Handling:**
- Fail-open for advisory features
- Log errors but don't crash
- Skip notifications if config unavailable

**Logging:**
```javascript
console.info('RULE_MATCHED', { candidateId, ruleId: rule.id, action: rule.action.type });
console.info('RULE_SKIPPED', { candidateId, ruleId: rule.id, reason: 'signal_not_available' });
console.error('RULE_EVALUATION_ERROR', { candidateId, ruleId: rule.id, error: err.message });
```

---

## Success Criteria

Phase 3 will be complete when:
- ⏳ Lambda evaluates rules on candidate changes
- ⏳ Signal calculators work for all defined signals
- ⏳ Rule conditions evaluate correctly
- ⏳ Actions trigger when rules match
- ⏳ Cooldown prevents notification spam
- ⏳ Error handling follows fail-open pattern
- ⏳ End-to-end test passes (rule → notification)

---

## Estimated Timeline

**Total Estimated Duration:** 3-4 hours

**Breakdown:**
- Task 3.1-3.2: Lambda structure + config loading (30 min)
- Task 3.3: Signal calculators (45 min)
- Task 3.4: Rule evaluator (45 min)
- Task 3.5: Action handler (30 min)
- Task 3.6-3.8: Infrastructure (Terraform, IAM) (45 min)
- Task 3.9: Testing (45 min)

---

## Next Steps

**When ready to start Phase 3:**
1. Review Phase 3 tasks
2. Break into small, focused tasks (avoid 400 errors)
3. Start with Task 3.1 (Lambda structure)
4. Follow same incremental approach as Phase 2

---

**Status:** Ready to begin when Phase 2 is complete ✅
