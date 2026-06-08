# Intelligence Layer — Implementation Tracker

**Master Design Doc:** `INTELLIGENCE-SURFACING-DESIGN.md`
**Status:** 🟡 IN PROGRESS
**Last Updated:** 2026-06-08

---

## Current State Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Rule Evaluation Engine | ✅ Live | Phase 3 - Lambda processing stream |
| Event Log (§10.4) | ✅ Live | `talent-flow-intelligence-events` table |
| Atomic Signals (12) | ✅ Live | 4 original + 8 new |
| Latest-Signals Snapshot | ✅ Live | §10.2 - Verified in prod |
| Intelligence Tile Component | ✅ Live | §7 - `IntelligenceTileComponent` |
| Intelligence Service | ✅ Live | Signal-based state management |
| getIntelligenceTiles Lambda | ✅ Live | `GET /v1/intelligence/tiles` |
| TA Dashboard Zone 0 | ✅ Live | §8 - Integrated |
| Dismiss/Snooze Overlay | ⏳ Pending | §10.3 |

---

## Implementation Roadmap

### Phase 6.0: Data Plane Foundation ✅ COMPLETE
*Build what can't be backfilled*

| Task | Status | Commit |
|------|--------|--------|
| 6.0.1 Event log table + GSIs | ✅ Done | `bcd7ae1` |
| 6.0.2 Event logger utility | ✅ Done | `bcd7ae1` |
| 6.0.3 Lambda integration | ✅ Done | `bcd7ae1` |

---

### Phase 6.1: Signal Expansion ✅ PARTIAL
*More signals = more intelligence scenarios*

| Task | Status | Commit |
|------|--------|--------|
| 6.1.1 Atomic signals (§2.2-2.3) | ✅ Done | `4965d22` |
| 6.1.2 Latest-signals snapshot (§10.2) | ✅ Done | `f70d348` |
| 6.1.3 Cross-record signals (§2.4-2.6) | ⏳ Pending | - |

**Signals Implemented (12):**
```
✅ CANDIDATE_STAGE          ✅ SLA_STATUS
✅ HM_DAYS_SINCE_LOGIN      ✅ DAYS_SINCE_SLA_BREACH
✅ OFFER_DAYS_TO_EXPIRY     ✅ ENGAGEMENT_SCORE
✅ TA_DAYS_SINCE_ACTION     ✅ ENGAGEMENT_SENTIMENT
✅ DAYS_SINCE_CREATED       ✅ INTERVIEW_SENTIMENT
✅ FINAL_SCORE              ✅ EVALUATION_RESULT
```

**Signals Pending (Priority Order):**
```
⏳ DAYS_IN_CURRENT_STAGE    - Needs stage history (§10.1)
⏳ OFFER_STATE              - Cross-record lookup
⏳ DAYS_SINCE_OFFER_SENT    - Cross-record lookup
⏳ PANEL_FEEDBACK_PENDING   - Cross-record lookup
⏳ DAYS_TO_START_DATE       - From offer.startDate
⏳ EQUIPMENT_REQUEST_STATUS - Provisioning domain
⏳ ACCESS_PROVISIONED       - Provisioning domain
⏳ ONBOARDING_READINESS     - Composite
⏳ CANDIDATE_RISK_SCORE     - Composite (needs history)
```

---

### Phase 6.2: Tile Component & TA Dashboard ✅ COMPLETE
*First visible intelligence surface*

| Task | Est | Status | Commit |
|------|-----|--------|--------|
| 6.2.1 Create `IntelligenceTileComponent` | 1h | ✅ Done | `ee95a6d` |
| 6.2.2 Implement tile SCSS (§6.4) | 30m | ✅ Done | `ee95a6d` |
| 6.2.3 Add Zone 0 to TA dashboard | 30m | ✅ Done | `ee95a6d` |
| 6.2.4 Create `IntelligenceService` | 1h | ✅ Done | `ee95a6d` |
| 6.2.5 Wire up tile projection query | 1h | ✅ Done | `adcdc6c` |

**Deployed Components:**
- `IntelligenceTileComponent` - Priority-based tiles with signals, actions, dismiss/snooze
- `IntelligenceService` - Signal-based state management, API integration
- `getIntelligenceTiles` Lambda - Tile generation from signal snapshots
- API Route: `GET /v1/intelligence/tiles?tenantId=X&role=Y`
- TA Dashboard Zone 0 - Intelligence Alerts section

**Verified:** Lambda returns real tile data (Sabelo Hadebe - Evaluation Failed)

**Tile Types for TA (from §5.1):**
```
1. Offers going cold       - OFFER_ACCEPTANCE_LIKELIHOOD
2. Candidates cooling      - ENGAGEMENT_TREND + SCORE
3. Stalled in stage        - STAGE_VELOCITY_RATIO
4. Interview no-shows      - INTERVIEW_STATUS
5. Waiting on panel        - PANEL_FEEDBACK_PENDING
6. Documents missing       - REQUIRED_DOCUMENTS_MISSING
```

---

### Phase 6.3: HM & IT Dashboards
*Expand to all roles*

| Task | Est | Status |
|------|-----|--------|
| 6.3.1 HM Intelligence tab | 1h | ⏳ |
| 6.3.2 IT compact banner | 1h | ⏳ |
| 6.3.3 Role-based tile filtering | 30m | ⏳ |

**HM Tiles (from §5.2):**
```
1. Decision deadline       - DAYS_TO_SLA_BREACH
2. Awaiting your approval  - APPROVAL_STEP_AGE
3. Fast-track recommended  - FINAL_SCORE + CONSENSUS
4. Feedback overdue        - INTERVIEW_FEEDBACK_PENDING
5. Split panel decision    - PANEL_SPLIT_FLAG
```

**IT Tiles (from §5.3):**
```
1. Access not provisioned  - DAYS_TO_START + ACCESS_PROVISIONED
2. Provisioning at risk    - ONBOARDING_READINESS
3. Equipment overdue       - EQUIPMENT_REQUEST_OVERDUE
4. Equipment to order      - EQUIPMENT_REQUEST_STATUS
5. Incomplete onboarding   - ONBOARDING_COMPLETE_PCT
```

---

### Phase 6.4: Stage History & Composites
*Unlock advanced intelligence*

| Task | Est | Status |
|------|-----|--------|
| 6.4.1 Stage history tracking (§10.1) | 2h | ⏳ |
| 6.4.2 DAYS_IN_CURRENT_STAGE signal | 30m | ⏳ |
| 6.4.3 CANDIDATE_RISK_SCORE composite | 1h | ⏳ |
| 6.4.4 ONBOARDING_READINESS composite | 1h | ⏳ |
| 6.4.5 Per-entity critical tiles | 1h | ⏳ |

---

### Phase 6.5: Admin Configuration
*Rule & tile management UI*

| Task | Est | Status |
|------|-----|--------|
| 6.5.1 Rule form drawer (CRUD) | 2h | ⏳ |
| 6.5.2 Rule categories | 1h | ⏳ |
| 6.5.3 Tile configuration page | 2h | ⏳ |
| 6.5.4 Threshold settings | 1h | ⏳ |

---

### Phase 6.6: Telemetry & Tuning
*Measure and improve*

| Task | Est | Status |
|------|-----|--------|
| 6.6.1 Intelligence Health view | 2h | ⏳ |
| 6.6.2 Per-rule analytics | 1h | ⏳ |
| 6.6.3 Dismissal tracking | 30m | ⏳ |

---

## Next Up: Phase 6.3 — HM & IT Dashboards

**What:** Expand intelligence tiles to HM and IT roles
**Why:** All personas need actionable insights, not just TAs
**Where:** HM Dashboard, IT Queue pages

**Approach:**
1. Add Zone 0 to HM Dashboard with HM-specific tiles
2. Add compact intelligence banner to IT Queue
3. Implement role-based tile filtering in `IntelligenceService`
4. Add ownerId-scoped queries using GSI1

**HM Tiles (Priority):**
- Decision deadline (SLA_STATUS)
- Awaiting your approval (APPROVAL_STEP_AGE)
- Fast-track recommended (FINAL_SCORE ≥ 85)

**IT Tiles (Priority):**
- Equipment not ordered (EQUIPMENT_REQUEST_STATUS)
- Provisioning at risk (DAYS_TO_START_DATE)

---

## Key Rules from Expansion Doc

**High-Value Rules to Implement First:**

### 1. Engagement Falling Before Offer (RULE-DROP-001)
```json
{
  "id": "RULE-DROP-001",
  "name": "Engagement Falling Before Offer",
  "severity": "WARNING",
  "conditions": [
    { "signal": "ENGAGEMENT_SENTIMENT", "operator": "in", "value": ["HESITANT", "DISENGAGED"] },
    { "signal": "CANDIDATE_STAGE", "operator": "in", "value": ["TECHNICAL_INTERVIEW", "HM_REVIEW", "OFFER"] }
  ],
  "action": { "type": "NOTIFY_TA_CANDIDATE_COOLING", "recipient": "TA" },
  "cooldown": 48
}
```

### 2. SLA Breach Alert (RULE-SLA-001)
```json
{
  "id": "RULE-SLA-001",
  "name": "SLA Breached - Escalate",
  "severity": "CRITICAL",
  "conditions": [
    { "signal": "SLA_STATUS", "operator": "equals", "value": "BREACHED" }
  ],
  "action": { "type": "ESCALATE_SLA_BREACH", "recipient": "TA" },
  "cooldown": 24
}
```

### 3. High Score Ready for Decision (RULE-HIPO-001)
```json
{
  "id": "RULE-HIPO-001",
  "name": "Strong Candidate Ready",
  "severity": "HIGH",
  "conditions": [
    { "signal": "FINAL_SCORE", "operator": "greaterThanOrEqual", "value": 85 },
    { "signal": "CANDIDATE_STAGE", "operator": "equals", "value": "HM_REVIEW" }
  ],
  "action": { "type": "NOTIFY_HM_FAST_TRACK", "recipient": "HM" },
  "cooldown": 48
}
```

### 4. Offer Expiring Soon (RULE-OFFER-001)
```json
{
  "id": "RULE-OFFER-001",
  "name": "Offer Expiring Soon",
  "severity": "CRITICAL",
  "conditions": [
    { "signal": "OFFER_DAYS_TO_EXPIRY", "operator": "lessThanOrEqual", "value": 3 }
  ],
  "action": { "type": "NOTIFY_TA_OFFER_EXPIRY", "recipient": "TA" },
  "cooldown": 24
}
```

---

## File Reference

| File | Purpose |
|------|---------|
| `INTELLIGENCE-SURFACING-DESIGN.md` | Master architecture (tiles, UI, signals) |
| `INTELLIGENCE-LAYER-EXPANSION.md` | Detailed rules, composites, metrics |
| `lambda/evaluateIntelligenceRules/index.js` | Rule evaluation Lambda handler |
| `lambda/evaluateIntelligenceRules/snapshot-writer.js` | Signal snapshot writer (§10.2) |
| `lambda/evaluateIntelligenceRules/event-logger.js` | Intelligence event logger (§10.4) |
| `talent-flow-intelligence-events` | Event log table |

---

## Session Log

| Date | Work Done | Commits |
|------|-----------|---------|
| 2026-06-08 | Event log (§10.4) deployed & tested | `bcd7ae1` |
| 2026-06-08 | 8 atomic signals added (12 total) | `4965d22` |
| 2026-06-08 | Created implementation tracker | - |
| 2026-06-08 | Latest-signals snapshot (§10.2) | `f70d348` |
| 2026-06-08 | Snapshot deployed & verified | `bbcaae5` |
| 2026-06-08 | **Phase 6.2 COMPLETE** - IntelligenceTileComponent, IntelligenceService | `ee95a6d` |
| 2026-06-08 | getIntelligenceTiles Lambda + API Gateway route | `adcdc6c` |
| 2026-06-08 | TA Dashboard Zone 0 integration | `ee95a6d` |
| 2026-06-08 | End-to-end verification with real data | - |

---

**Ready to continue?** Next task: `6.3.1 HM Intelligence tab`
