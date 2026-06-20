# Comprehensive Verification Plan
## Intelligence Layer - End-to-End Testing Across All Roles

**Date:** 2026-06-09
**Status:** 🔴 REQUIRED before CHECKPOINT E sign-off
**Reason:** 3 critical bugs discovered during EPIC 4 UI testing suggest systematic verification needed

---

## Executive Summary

**What we know works:**
- ✅ HM role - tested during EPIC 4 bug fixing
- ✅ Backend Lambdas (evaluateIntelligenceRules, getIntelligenceTiles)
- ✅ Signal calculation (all 26 signals)
- ✅ Rule evaluation (all 13 rules)

**What needs verification:**
- ❓ TA role dashboard and tiles
- ❓ IT role dashboard and tiles
- ❓ Frontend integration for all roles
- ❓ End-to-end flows (create → compute → display)
- ❓ Cross-role interactions

---

## Test Matrix

| Epic | Role | Backend | Frontend | E2E | Status |
|------|------|---------|----------|-----|--------|
| EPIC 1 | HM | ✅ | ⚠️ | ❌ | Partial |
| EPIC 1 | TA | ✅ | ❌ | ❌ | Not tested |
| EPIC 1 | IT | ✅ | ❌ | ❌ | Not tested |
| EPIC 2 | HM | ✅ | ❌ | ❌ | Backend only |
| EPIC 2 | TA | ✅ | ❌ | ❌ | Backend only |
| EPIC 2 | IT | ✅ | ❌ | ❌ | Backend only |
| EPIC 3 | HM | ✅ | ⚠️ | ❌ | Partial |
| EPIC 3 | TA | ✅ | ❌ | ❌ | Not tested |
| EPIC 4 | HM | ✅ | ⚠️ | ❌ | Bugs fixed |

---

## Phase 1: Backend Verification (Lambda + DynamoDB)

### Test 1.1: Signal Calculation (All 26 Signals)

**Goal:** Verify all signals compute correctly for diverse candidates

**Test Candidates:**
1. **Complete Candidate** (all signals should have values)
2. **Minimal Candidate** (graceful degradation for missing data)
3. **Edge Case Candidate** (boundary conditions)

**Signals to verify:**
```javascript
// EPIC 0 - Original 19 signals
1. CANDIDATE_STAGE
2. HM_DAYS_SINCE_LOGIN
3. OFFER_DAYS_TO_EXPIRY
4. TA_DAYS_SINCE_CANDIDATE_ACTION
5. DAYS_SINCE_CANDIDATE_CREATED
6. SLA_STATUS
7. DAYS_SINCE_SLA_BREACH
8. ENGAGEMENT_SCORE
9. ENGAGEMENT_SENTIMENT
10. INTERVIEW_SENTIMENT
11. FINAL_SCORE
12. EVALUATION_RESULT
13. CANDIDATE_RISK_SCORE
14. ONBOARDING_READINESS
15. DAYS_TO_START_DATE
16. EQUIPMENT_REQUEST_STATUS
17. ACCESS_PROVISIONED
18. DAYS_IN_CURRENT_STAGE (enhanced in EPIC 3)
19. Original composite signals

// EPIC 3 - New signals
20. ENGAGEMENT_TREND
21. CANDIDATE_DAYS_SINCE_RESPONSE

// EPIC 4 - New signals
22. PANEL_FEEDBACK_PENDING_COUNT
23. PANEL_CONSENSUS
24. PANEL_SPLIT_FLAG
25. OFFER_STATE
26. DAYS_SINCE_OFFER_SENT
27. APPROVAL_STEP_AGE (total: 26)
```

**Test Commands:**
```bash
# Create comprehensive test candidate
cd lambda
AWS_REGION=af-south-1 node test-all-signals.js

# Verify in CloudWatch
aws logs tail /aws/lambda/evaluateIntelligenceRules \
  --region af-south-1 \
  --since 5m | grep "Signals calculated"

# Check snapshot written
aws dynamodb query --table-name talent-flow-state \
  --region af-south-1 \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"TENANT#NALEKO#SNAP"},":sk":{"S":"CAND#TEST-COMPREHENSIVE"}}'
```

**Acceptance Criteria:**
- [ ] All 26 signals listed in CloudWatch "Signals calculated" log
- [ ] Signal snapshot written to TENANT#NALEKO#SNAP
- [ ] No null/undefined for signals that should have values
- [ ] Graceful degradation (null) for unavailable signals

---

### Test 1.2: Rule Evaluation (All 13 Rules)

**Goal:** Verify each rule fires when conditions met, skips when not

**Test Candidates Needed:**
1. **SLA Breach** → RULE-SLA-001
2. **SLA At-Risk** → RULE-SLA-002
3. **High Risk** → RULE-RISK-001
4. **Stage Stalled** → RULE-STAGE-001
5. **Equipment Pending** → RULE-EQUIPMENT-001
6. **Onboarding Incomplete** → RULE-ONBOARD-001
7. **Strong Score** → RULE-EVAL-001
8. **HiPo Disengaging** → RULE-HIPO-001
9. **Engagement Cooling** → RULE-COOLING-001
10. **Fast-Track** → RULE-FASTTRACK-001
11. **Split Panel** → RULE-PANEL-001
12. **Approval Stalled** → RULE-APPROVAL-001
13. **Feedback Overdue** → RULE-FEEDBACK-001

**Test Commands:**
```bash
# Run comprehensive rule test
AWS_REGION=af-south-1 node test-all-rules.js

# Check CloudWatch for matches
aws logs tail /aws/lambda/evaluateIntelligenceRules \
  --region af-south-1 \
  --since 10m | grep "Rule matched"

# Verify event log
aws dynamodb query --table-name talent-flow-intelligence-events \
  --region af-south-1 \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"RULE#EVENT"}}' \
  --scan-index-forward false \
  --limit 20
```

**Acceptance Criteria:**
- [ ] Each rule fires for qualifying candidate
- [ ] Rules skip when conditions not met (correct reason logged)
- [ ] Event logged in talent-flow-intelligence-events
- [ ] Notification Lambda invoked (CloudWatch log)
- [ ] Cooldown prevents duplicate firing

---

### Test 1.3: getIntelligenceTiles Role Filtering

**Goal:** Verify tiles returned match role targeting

**Test Commands:**
```bash
# Test HM role
aws lambda invoke --function-name getIntelligenceTiles \
  --region af-south-1 \
  --payload '{"queryStringParameters":{"tenantId":"NALEKO","role":"HM"}}' \
  /tmp/hm-tiles.json

# Test TA role
aws lambda invoke --function-name getIntelligenceTiles \
  --region af-south-1 \
  --payload '{"queryStringParameters":{"tenantId":"NALEKO","role":"TA"}}' \
  /tmp/ta-tiles.json

# Test IT role
aws lambda invoke --function-name getIntelligenceTiles \
  --region af-south-1 \
  --payload '{"queryStringParameters":{"tenantId":"NALEKO","role":"IT"}}' \
  /tmp/it-tiles.json

# Compare results
cat /tmp/hm-tiles.json | jq '.body | fromjson | .tiles[].ruleId' | sort | uniq
cat /tmp/ta-tiles.json | jq '.body | fromjson | .tiles[].ruleId' | sort | uniq
cat /tmp/it-tiles.json | jq '.body | fromjson | .tiles[].ruleId' | sort | uniq
```

**Expected Role Distribution:**
```
HM rules: RULE-DECISION-001, RULE-HIPO-001, RULE-FASTTRACK-001, RULE-PANEL-001, RULE-APPROVAL-001, RULE-FEEDBACK-001
TA rules: RULE-SLA-001, RULE-SLA-002, RULE-RISK-001, RULE-STAGE-001, RULE-EVAL-001, RULE-COOLING-001
IT rules: RULE-EQUIPMENT-001, RULE-ONBOARD-001
```

**Acceptance Criteria:**
- [ ] HM sees only HM-targeted tiles
- [ ] TA sees only TA-targeted tiles
- [ ] IT sees only IT-targeted tiles
- [ ] No overlap between role-specific tiles

---

## Phase 2: Frontend Verification (UI Testing)

### Test 2.1: HM Dashboard

**URL:** `http://localhost:4200/platform/talentflow/hm/dashboard`

**Prerequisites:**
- Frontend running (`npm start`)
- Logged in as HM user
- Test candidates created with HM rules fired

**Test Steps:**
1. Navigate to HM Dashboard
2. Check Intelligence Alerts section appears
3. Verify tiles displayed
4. Test tile actions
5. Test dismiss/snooze

**Expected Tiles:**
- ⚡ **Fast-Track Recommended** (Alice Fasttrack) - CRITICAL
- ⚠️ **Split Panel - Document Rationale** (Bob Splitpanel) - CRITICAL
- ⏰ **Approval Stalled** (Charlie Stalled) - HIGH/MEDIUM
- 📊 **Decision Needed** (Joe Cole, Wayne Rooney) - MEDIUM
- 🎯 **Strong Candidate** - MEDIUM

**Actions to Test:**
- [ ] Click "View" → navigates to candidate page
- [ ] Click "Fast-Track to Offer" → action triggered
- [ ] Click "Document Decision" → action triggered
- [ ] Click Snooze icon → dropdown appears with durations
- [ ] Select "1 hour" → tile disappears
- [ ] Click Dismiss icon → tile disappears
- [ ] Refresh page → dismissed/snoozed tiles stay hidden

**Acceptance Criteria:**
- [ ] Intelligence Alerts section visible at top
- [ ] At least 3-5 tiles showing
- [ ] Tile priority colors correct (CRITICAL=red, HIGH=orange, MEDIUM=yellow)
- [ ] All signals displayed correctly
- [ ] Action buttons work
- [ ] Dismiss persists across reload
- [ ] Snooze returns after window expires

---

### Test 2.2: TA Dashboard

**URL:** `http://localhost:4200/platform/talentflow/ta/dashboard`

**Prerequisites:**
- Logged in as TA user
- Test candidates created with TA rules fired

**Expected Tiles:**
- 🔴 **SLA Breached** - CRITICAL
- ⚠️ **SLA At Risk** - HIGH
- 📈 **High Risk Candidate** - HIGH
- 🕐 **Stalled in Stage** - MEDIUM
- 🧊 **Engagement Cooling** - MEDIUM

**Actions to Test:**
- [ ] View SLA breach tile
- [ ] Dismiss risk tile
- [ ] Snooze stale candidate tile
- [ ] Verify no HM-only tiles appear

**Acceptance Criteria:**
- [ ] TA-specific tiles appear
- [ ] No HM-only tiles (Fast-Track, Split Panel, Approval)
- [ ] No IT-only tiles (Equipment, Onboarding)
- [ ] Actions work correctly
- [ ] Dismiss/snooze persist

---

### Test 2.3: IT Dashboard

**URL:** `http://localhost:4200/platform/talentflow/it/dashboard` or IT queue page

**Prerequisites:**
- Logged in as IT user
- Test candidates in onboarding with IT rules fired

**Expected Tiles:**
- 📦 **Equipment Not Ordered** - HIGH
- 🛠️ **Onboarding Prep Incomplete** - MEDIUM
- 📋 **Access Not Provisioned** - HIGH

**Actions to Test:**
- [ ] View equipment tile
- [ ] Dismiss onboarding tile
- [ ] Verify no TA/HM tiles appear

**Acceptance Criteria:**
- [ ] IT-specific tiles appear
- [ ] No TA-only tiles (SLA, Risk, Stale)
- [ ] No HM-only tiles (Fast-Track, Panel, Approval)
- [ ] IT queue page still loads (regression check)
- [ ] Actions work correctly

---

## Phase 3: End-to-End Verification

### Test 3.1: Complete Candidate Lifecycle

**Goal:** Verify intelligence layer works through entire hiring flow

**Test Flow:**
```
1. CREATE candidate
   → Verify: SAGA record created
   → Verify: Initial signals computed
   → Verify: Snapshot written

2. ADVANCE to SCREENING stage
   → Verify: STAGE# history record written
   → Verify: DAYS_IN_CURRENT_STAGE updated
   → Verify: Signals recomputed

3. WAIT 11 days (or backdate createdAt)
   → Verify: RULE-STAGE-001 fires (Stalled in Stage)
   → Verify: TA sees "Stalled in Stage" tile

4. ADVANCE to INTERVIEWING
   → Verify: Stage history updated
   → Verify: Stalled tile disappears

5. ADD panel votes (mixed: 2 YES, 2 NO)
   → Verify: PANEL_CONSENSUS computed (LOW)
   → Verify: PANEL_SPLIT_FLAG = false (no STRONG votes)

6. CHANGE votes to split (2 STRONG_YES, 2 STRONG_NO)
   → Verify: PANEL_SPLIT_FLAG = true
   → Verify: RULE-PANEL-001 fires
   → Verify: HM sees "Split Panel" tile (acknowledge-only)

7. ADVANCE to EVALUATION + set finalScore = 92
   → Verify: Stage updated
   → Verify: FINAL_SCORE signal set

8. UPDATE engagement (80 → 60)
   → Verify: ENGAGEMENT_TREND = FALLING
   → Verify: RULE-FASTTRACK-001 fires (high score + high consensus + falling engagement)
   → Verify: HM sees "Fast-Track" CRITICAL tile

9. CREATE offer
   → Verify: OFFER_STATE = PENDING_APPROVAL
   → Verify: APPROVAL_STEP_AGE = 0

10. WAIT 7 days (or backdate approvalStartedAt)
    → Verify: APPROVAL_STEP_AGE = 7
    → Verify: RULE-APPROVAL-001 fires
    → Verify: HM sees "Approval Stalled" tile

11. APPROVE offer
    → Verify: OFFER_STATE = APPROVED
    → Verify: Approval stalled tile clears

12. SEND offer
    → Verify: OFFER_STATE = SENT
    → Verify: DAYS_SINCE_OFFER_SENT calculated

13. ADVANCE to ONBOARDING
    → Verify: ONBOARDING_READINESS signal active
    → Verify: If < 75%, RULE-ONBOARD-001 fires
    → Verify: IT sees "Onboarding Prep" tile
```

**Commands:**
```bash
cd lambda
AWS_REGION=af-south-1 node test-complete-lifecycle.js
```

**Acceptance Criteria:**
- [ ] All stage transitions write history
- [ ] All rules fire at correct times
- [ ] Tiles appear for correct roles at correct stages
- [ ] No errors in CloudWatch logs
- [ ] All signals update correctly throughout lifecycle

---

### Test 3.2: Cross-Role Interactions

**Goal:** Verify per-user state doesn't interfere across roles

**Test Flow:**
```
1. HM user dismisses "Fast-Track" tile
   → Verify: HM no longer sees tile
   → Verify: TA user DOES NOT see Fast-Track tile (role filtering)
   → Verify: Another HM user STILL SEES the tile (per-user)

2. TA user dismisses "SLA Breach" tile
   → Verify: TA no longer sees tile
   → Verify: HM user DOES NOT see SLA tile (role filtering)
   → Verify: Another TA user STILL SEES the tile (per-user)

3. Admin changes threshold (e.g., offerExpiryUrgent from 3 to 5)
   → Verify: Tiles update for ALL users
   → Verify: New tiles appear matching new threshold
   → Verify: Old tiles that no longer qualify disappear
```

**Acceptance Criteria:**
- [ ] Dismissals are per-user (other users unaffected)
- [ ] Role filtering prevents cross-role tile visibility
- [ ] Threshold changes affect all users
- [ ] No state leakage between tenants

---

## Phase 4: Performance & Scale Verification

### Test 4.1: High-Volume Aggregation

**Goal:** Verify aggregation model handles scale correctly

**Test Setup:**
- Create 50 candidates
- Trigger same rule for all (e.g., RULE-STAGE-001)

**Expected Behavior:**
- Top 3 CRITICAL candidates show as per-entity tiles
- Remaining 47 aggregate into single tile: "47 items require attention"
- Aggregate tile routes to filtered candidate list

**Test Commands:**
```bash
AWS_REGION=af-south-1 node test-high-volume.js

# Check tile count
aws lambda invoke --function-name getIntelligenceTiles \
  --region af-south-1 \
  --payload '{"queryStringParameters":{"tenantId":"NALEKO","role":"TA"}}' \
  /tmp/volume-test.json

cat /tmp/volume-test.json | jq '.body | fromjson | {
  totalTiles: (.tiles | length),
  perEntityTiles: [.tiles[] | select(.mode == "per-entity")],
  aggregateTiles: [.tiles[] | select(.mode == "aggregate")]
}'
```

**Acceptance Criteria:**
- [ ] Max 3 per-entity tiles per rule (CRITICAL only)
- [ ] Aggregate tiles created for volume > 3
- [ ] Count badge shows correct number
- [ ] routeTarget contains correct filters
- [ ] Performance < 500ms for 50 candidates

---

### Test 4.2: Lambda Cold Start & Memory

**Goal:** Verify no regressions in cold start or memory usage

**Test Commands:**
```bash
# Force cold start by updating env var
aws lambda update-function-configuration \
  --function-name getIntelligenceTiles \
  --region af-south-1 \
  --environment Variables={DUMMY=test} 2>&1 > /dev/null

# Wait for update
sleep 5

# Invoke and measure
time aws lambda invoke --function-name getIntelligenceTiles \
  --region af-south-1 \
  --payload '{"queryStringParameters":{"tenantId":"NALEKO","role":"HM"}}' \
  /tmp/cold-start.json

# Check CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=getIntelligenceTiles \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum \
  --region af-south-1
```

**Acceptance Criteria:**
- [ ] Cold start < 3 seconds
- [ ] Warm invocation < 500ms
- [ ] Memory usage < 256MB (current limit)
- [ ] No timeout errors
- [ ] No out-of-memory errors

---

## Phase 5: Regression Verification

### Regression Checklist (from §3 of tracker)

- [ ] All 26 signals resolve without error
- [ ] getIntelligenceTiles returns tiles for TA, HM, IT roles
- [ ] IT queue page loads and renders IT tiles
- [ ] Event logging (event-logger.js) fires on stream events
- [ ] Snapshot writing (snapshot-writer.js) fires on stream events
- [ ] sendTalentFlowNotification Lambda functions correctly
- [ ] No new CloudWatch errors
- [ ] No IAM permission errors

**Test Commands:**
```bash
# Check for errors in all Lambdas
for lambda in evaluateIntelligenceRules getIntelligenceTiles dismissTile snoozeTile acknowledgeTile; do
  echo "=== $lambda ==="
  aws logs tail /aws/lambda/$lambda \
    --region af-south-1 \
    --since 1h \
    --filter-pattern ERROR | head -20
done

# Check IAM issues
aws logs tail /aws/lambda/evaluateIntelligenceRules \
  --region af-south-1 \
  --since 1h \
  --filter-pattern AccessDenied
```

---

## Verification Script Template

```javascript
// test-comprehensive-verification.js
const { verifySignals } = require('./test-utils/signal-verifier');
const { verifyRules } = require('./test-utils/rule-verifier');
const { verifyTiles } = require('./test-utils/tile-verifier');
const { verifyE2E } = require('./test-utils/e2e-verifier');

async function runComprehensiveVerification() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🔍 COMPREHENSIVE INTELLIGENCE LAYER VERIFICATION');
  console.log('═══════════════════════════════════════════════════════\n');

  const results = {
    signals: { passed: 0, failed: 0, errors: [] },
    rules: { passed: 0, failed: 0, errors: [] },
    tiles: { passed: 0, failed: 0, errors: [] },
    e2e: { passed: 0, failed: 0, errors: [] },
  };

  // Phase 1: Signals
  console.log('📊 PHASE 1: Signal Verification');
  results.signals = await verifySignals();

  // Phase 2: Rules
  console.log('\n📋 PHASE 2: Rule Verification');
  results.rules = await verifyRules();

  // Phase 3: Tiles
  console.log('\n🎨 PHASE 3: Tile Verification (All Roles)');
  results.tiles = await verifyTiles();

  // Phase 4: End-to-End
  console.log('\n🔄 PHASE 4: End-to-End Flow Verification');
  results.e2e = await verifyE2E();

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════');

  const totalPassed = Object.values(results).reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0);
  const totalTests = totalPassed + totalFailed;

  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

  if (totalFailed > 0) {
    console.log('\n❌ VERIFICATION FAILED - Fix issues before proceeding');
    process.exit(1);
  }

  console.log('\n✅ ALL VERIFICATIONS PASSED - Ready for CHECKPOINT E sign-off');
  process.exit(0);
}

runComprehensiveVerification();
```

---

## Sign-off Criteria

Before CHECKPOINT E can be approved, ALL of the following must be ✅:

### Backend
- [ ] All 26 signals compute correctly
- [ ] All 13 rules evaluate correctly
- [ ] Tiles generated for all 3 roles (HM, TA, IT)
- [ ] Role filtering works correctly
- [ ] Aggregation model works
- [ ] No CloudWatch errors

### Frontend
- [ ] HM dashboard shows HM tiles
- [ ] TA dashboard shows TA tiles
- [ ] IT dashboard shows IT tiles
- [ ] All tile actions work
- [ ] Dismiss/snooze persist correctly
- [ ] No console errors

### End-to-End
- [ ] Complete lifecycle test passes
- [ ] Cross-role interactions work correctly
- [ ] No state leakage between users/roles
- [ ] Performance acceptable (< 500ms)

### Regressions
- [ ] All §3 regression guardrails still pass
- [ ] No new errors in CloudWatch
- [ ] No IAM permission issues
- [ ] IT queue page still works

---

## Next Steps After Verification

1. ✅ **If all tests pass:**
   - Update tracker: Mark CHECKPOINT E as APPROVED
   - Document any minor issues found (non-blocking)
   - Proceed to EPIC 5 planning

2. ❌ **If tests fail:**
   - Document failures in tracker Result lines
   - Create bug fix tasks (BUG #4, #5, etc.)
   - Re-run verification after fixes
   - DO NOT proceed to EPIC 5

---

**Verification Owner:** [Name]
**Started:** [Date]
**Completed:** [Date]
**Status:** 🔴 Not Started
