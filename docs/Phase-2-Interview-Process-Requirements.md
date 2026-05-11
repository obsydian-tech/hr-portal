# Phase 2 — Interview Process Requirements

> **Document Title:** HR Verification Portal – System Documentation  
> **Subject:** Interview & Onboarding Process  
> **Version:** 1  
> **Date:** 06 May 2026  
> **Compiled by:** Koketso Zandile Mogashwa  
> **Organisation:** Naleko Digital Solutions  
> **Repository:** `obsydian-tech/hr-portal`  
> **Status:** 🔜 Planning — Not yet implemented

---

## Table of Contents

1. [Overview](#1-overview)
2. [The 12-Step Interview & Onboarding Process](#2-the-12-step-interview--onboarding-process)
3. [Detailed Step Breakdown](#3-detailed-step-breakdown)
4. [Critical Phase — Pre-Onboarding](#4-critical-phase--pre-onboarding-where-most-companies-fail)
5. [Key Tracking Triggers & KPIs](#5-key-tracking-triggers--kpis)
6. [Stakeholder Responsibility Matrix](#6-stakeholder-responsibility-matrix)
7. [Tracking & Engagement Checkpoints](#7-tracking--engagement-checkpoints)
8. [Government Onboarding Specifics](#8-government-onboarding-specifics)
9. [Data Model Requirements](#9-data-model-requirements)
10. [Integration with Existing Naleko System](#10-integration-with-existing-naleko-system)
11. [Open Questions & Decisions Required](#11-open-questions--decisions-required)

---

## 1. Overview

The current Naleko HR Portal handles the **post-offer onboarding phase** — document submission, OCR verification, AI risk classification, and staff provisioning. 

**Phase 2 extends the system upstream** to capture the entire lifecycle from the very first interview through to Day 1 onboarding, with measurable engagement signals at every stage.

### The Core Problem This Solves

> *"Pre-Onboarding is where most companies fail."*

Most HR systems track **hiring** (did we make an offer?) and **onboarding** (did we provision access?). They miss the crucial gap in between — the **engagement and sentiment journey** of a candidate from first contact to Day 1. This results in:

- High offer-to-drop-off rates (candidates accept then ghost)
- No visibility into candidate sentiment trends
- First engagement taking longer than 48 hours post-acceptance (a key retention risk)
- IT & Facilities bottlenecks going undetected until Day 1

### Phase 2 Goals

| Goal | Metric |
|---|---|
| Capture candidate sentiment from first interview | Sentiment score per stage |
| Track conversion quality at the offer acceptance point | Acceptance timestamp + sentiment flag |
| Ensure first engagement within 48 hours of offer acceptance | Time-to-first-engagement KPI |
| Achieve 100% Day 1 readiness | Day 1 readiness score (Equipment + Access + Engagement) |
| Provide HR with bottleneck visibility across all 12 steps | Stage turnaround time dashboards |

---

## 2. The 12-Step Interview & Onboarding Process

```
1.  First Interview Completed
    ↓
2.  Candidate Evaluation & Shortlisting
    ↓
3.  Second Interview Scheduled
    ↓
4.  Second Interview Conducted
    ↓
5.  Final Decision (Approve / Reject)
    ↓
6.  Offer Creation & Approval
    ↓
7.  Offer Sent to Candidate
    ↓
8.  Offer Accepted                          ← ★ CONVERSION POINT
    ↓
9.  Pre-Onboarding Initiated
    ↓
10. IT & Facilities Preparation
    ↓
11. First Engagement Touchpoint             ← ★ CRITICAL STEP TO TRACK
    ↓
12. Day 1 Onboarding
```

### Phase Groupings

| Phase | Steps | Description |
|---|---|---|
| **Interview & Evaluation** | 1–5 | From first interview through final hire/reject decision |
| **Offer & Acceptance** | 6–8 | Offer creation, approval, dispatch, and acceptance |
| **Pre-Onboarding & Preparation** | 9–10 | Welcome, provisioning, IT, facilities |
| **Onboarding & First Day** | 11–12 | First engagement touchpoint + Day 1 |

---

## 3. Detailed Step Breakdown

### Step 1 — First Interview Completed

**What happens:**
- Interview conducted between candidate and hiring manager
- Feedback captured by interviewer immediately after
- Candidate sentiment recorded (this is the engagement baseline)

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `interview_date` | Timestamp | Date and time of interview |
| `interviewer_id` | String | Staff/hiring manager ID |
| `candidate_id` | String | Candidate reference |
| `feedback_notes` | Text | Free-text interview feedback |
| `sentiment_score` | Enum | `POSITIVE` / `NEUTRAL` / `NEGATIVE` / `HESITANT` |
| `move_to_next_round` | Boolean | Did candidate proceed? |

**Tracking trigger:** First interaction logged in CRM/ATS  
**KPI:** Interaction logging rate (target: 100% same-day capture)

---

### Steps 2–4 — Interview Loop (Evaluation → Second Interview)

**Step 2 — Candidate Evaluation & Shortlisting:**
- Evaluate and consolidate feedback from Step 1
- Shortlist candidates for second round
- Send communication to shortlisted candidates

**Step 3 — Second Interview Scheduled:**
- Share interview details with candidate
- Log scheduling communication

**Step 4 — Second Interview Conducted:**
- Second interview completed
- Feedback captured
- Candidate sentiment recorded again (compare with Step 1 baseline)

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `time_between_interviews` | Duration | Step 1 → Step 4 in days |
| `response_time` | Duration | Time from shortlist notification → candidate confirmation |
| `engagement_score` | Number (0–100) | Derived from responsiveness + sentiment |
| `shortlist_status` | Enum | `SHORTLISTED` / `NOT_SHORTLISTED` |
| `second_interview_sentiment` | Enum | Same scale as Step 1 |

**Tracking trigger:** Response time + engagement score  
**KPI:** Time between interviews (benchmark to be defined); engagement score delta (Step 1 vs Step 4)

---

### Step 5 — Final Decision (Approve / Reject)

**What happens:**
- HR and hiring panel consolidate all feedback
- Final decision made: APPROVED or REJECTED
- Candidate informed of outcome
- If rejected: rejection process logged

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `decision` | Enum | `APPROVED` / `REJECTED` |
| `decision_date` | Timestamp | |
| `decision_panel` | Array | Staff IDs of decision makers |
| `rejection_reason` | Text | If rejected — for analytics/improvement |
| `candidate_informed_at` | Timestamp | When candidate was notified |

---

### Steps 6–7 — Offer Stage

**Step 6 — Offer Creation & Approval:**
- Offer package created by HR
- Reviewed by HR and Finance
- Approved by authorised authorities (per delegation)
- Candidate informed offer is being prepared

**Step 7 — Offer Sent to Candidate:**
- Official offer letter issued
- Benefits and CTC (Cost to Company) details shared
- Queries from candidate addressed

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `offer_created_at` | Timestamp | When offer was drafted |
| `offer_approved_at` | Timestamp | When final approval was given |
| `offer_sent_at` | Timestamp | When candidate received the offer |
| `offer_turnaround_time` | Duration | `offer_created_at` → `offer_sent_at` |
| `ctc_value` | Number | Offer value (encrypted, manager-only access) |
| `candidate_responsiveness` | Enum | `IMMEDIATE` / `WITHIN_24H` / `DELAYED` / `NO_RESPONSE` |

**Tracking trigger:** Offer turnaround time + candidate responsiveness  
**KPI:** Offer turnaround time (target: to be benchmarked)

---

### Step 8 — Offer Accepted ✅ (Conversion Point)

> **This is the most important single event in the pipeline.** Everything before this step is recruitment. Everything after is onboarding.

**What happens:**
- Candidate formally accepts the offer
- Required documents submitted
- Joining date and details confirmed

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `acceptance_timestamp` | Timestamp | Exact date/time of acceptance — critical |
| `acceptance_sentiment` | Enum | `EXCITED` / `NEUTRAL` / `HESITANT` / `RELUCTANT` |
| `joining_date_confirmed` | Date | Confirmed start date |
| `documents_submitted` | Boolean | Initial document set received |
| `conversion_channel` | Enum | `EMAIL` / `PHONE` / `PORTAL` / `IN_PERSON` |

**Tracking trigger:** Acceptance timestamp + sentiment (excited vs. hesitant)  
**KPI:** Offer-to-acceptance rate; acceptance sentiment distribution

> ⚠️ **Note for implementation:** A `HESITANT` sentiment at acceptance is a significant early retention risk signal. The system should flag this for elevated engagement follow-up.

---

### Step 9 — Pre-Onboarding Initiated

**What happens:**
- Welcome email sent to new hire
- Onboarding portal access provisioned
- Onboarding schedule shared
- Buddy / team introduction arranged
- Team info and next steps communicated

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `welcome_email_sent_at` | Timestamp | |
| `portal_access_granted_at` | Timestamp | |
| `schedule_shared_at` | Timestamp | |
| `buddy_assigned` | Boolean | Was a buddy/mentor assigned? |
| `buddy_id` | String | Staff ID of assigned buddy |
| `team_intro_scheduled` | Boolean | |

---

### Step 10 — IT & Facilities Preparation

> **This is a checklist-driven step.** Every item must be tracked individually to ensure Day 1 readiness.

**What happens:**
- Laptop allocated
- Email account created
- System access provisioned
- Access card requested

**IT & Facilities Checklist:**

| Item | Field | Type | Target |
|---|---|---|---|
| Laptop allocated | `laptop_allocated` | Boolean (Y/N) | Before Day 1 |
| Access card ready | `access_card_ready` | Boolean (Y/N) | Before Day 1 |
| System credentials issued | `system_credentials_issued` | Boolean (Y/N) | Before Day 1 |
| Email account created | `email_created` | Boolean (Y/N) | Before Day 1 |
| System access provisioned | `system_access_provisioned` | Boolean (Y/N) | Before Day 1 |

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `it_preparation_started_at` | Timestamp | When IT team was notified |
| `checklist_completion_date` | Timestamp | When all items checked |
| `it_readiness_score` | Number (0–100) | % of checklist items complete |
| `blocking_items` | Array | List of incomplete items at Day 1 |

**Tracking trigger:** Checklist completion date vs. joining date  
**KPI:** IT readiness score at Day 1 (target: 100%)

---

### Step 11 — First Engagement Touchpoint ⭐ (Critical Tracked Step)

> **"The Ignored Step" — This is the most commonly skipped step, and the one with the highest impact on Day 1 retention.**

**Definition of First Engagement:**  
The **first meaningful interaction** after offer acceptance that builds a human connection between the candidate and the organisation.

**Valid engagement types:**
- Welcome call from the direct manager
- HR onboarding session (video or in-person)
- Team introduction meeting
- Buddy check-in call or message

**What is NOT a valid engagement:**
- Automated system emails
- IT provisioning notifications
- Document request emails

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `first_engagement_date` | Timestamp | When it happened |
| `engagement_type` | Enum | `CALL` / `MEETING` / `EMAIL` / `IN_PERSON` |
| `initiated_by` | Enum | `MANAGER` / `HR` / `BUDDY` / `TEAM_MEMBER` |
| `initiated_by_id` | String | Staff ID of person who initiated |
| `candidate_feedback` | Text | Free-text candidate response/reaction |
| `candidate_response_sentiment` | Enum | `POSITIVE` / `NEUTRAL` / `NEGATIVE` |
| `time_to_first_engagement` | Duration | `acceptance_timestamp` → `first_engagement_date` |

**KPI:**  
> ⏱️ **Time from offer acceptance → first engagement: Target < 48 hours**

This is the single most important pre-onboarding KPI. Candidates who receive meaningful first engagement within 48 hours of accepting an offer have significantly lower Day 1 no-show and early resignation rates.

---

### Step 12 — Day 1 Onboarding 🟢

**What happens:**
- Candidate joins at workplace (physical or remote)
- Laptop issued and confirmed working
- Access card activated
- System login confirmed successful
- Orientation session completed
- Candidate experience captured

**Day 1 Readiness Score (composite):**

| Component | Weight | Pass Condition |
|---|---|---|
| Equipment ✔ | 33% | Laptop issued and functional |
| Access ✔ | 33% | System login + access card working |
| Engagement ✔ | 33% | First engagement touchpoint completed (Step 11) |

**Data to capture:**
| Field | Type | Notes |
|---|---|---|
| `day1_date` | Date | Actual Day 1 date |
| `laptop_issued` | Boolean | Laptop confirmed functional |
| `access_card_activated` | Boolean | Physical access confirmed |
| `system_login_successful` | Boolean | IT credentials working |
| `orientation_completed` | Boolean | Orientation session done |
| `day1_readiness_score` | Number (0–100) | Composite score |
| `candidate_experience_score` | Number (1–5) | End-of-day candidate survey |
| `day1_no_show` | Boolean | Did the candidate not arrive? |

**KPI:** Day 1 readiness score (target: 100%); Day 1 no-show rate (target: 0%)

---

## 4. Critical Phase — Pre-Onboarding (Where Most Companies Fail)

Steps 9–11 collectively form the **Pre-Onboarding & Preparation** phase. This is the highest-risk period in the entire candidate journey.

### Why Companies Fail Here

| Failure Mode | Symptom | Root Cause |
|---|---|---|
| IT not notified in time | Candidate has no laptop/access on Day 1 | No automated trigger from offer acceptance → IT |
| No meaningful first engagement | Candidate feels ignored, withdraws | First engagement not tracked or enforced |
| Welcome email is the only contact | Candidate feels like a number | No HUMAN touchpoint tracked |
| Onboarding date creep | Joining date shifts | No SLA tracking on document submission |

### Proposed SLA Framework for Pre-Onboarding

| Trigger Event | Required Action | SLA |
|---|---|---|
| Offer accepted (`acceptance_timestamp`) | Send welcome email | < 2 hours |
| Offer accepted | Assign buddy | < 24 hours |
| Offer accepted | First engagement touchpoint | < 48 hours |
| Joining date confirmed | Notify IT & Facilities | Joining date minus 5 business days |
| IT notified | Full IT checklist complete | By Day 1 08:00 |

---

## 5. Key Tracking Triggers & KPIs

Every stage of the process has a measurable signal. These are used to identify bottlenecks, improve candidate experience, and reduce drop-off.

| Phase | Step(s) | Tracking Trigger / Signal | Key Metrics / KPIs |
|---|---|---|---|
| **First Interview** | 1 | CRM/ATS log entry | Candidate sentiment score; interaction logging rate |
| **Interview Loop** | 2–4 | Response time; engagement score | Time between interviews; engagement score delta |
| **Offer Stage** | 6–7 | Offer sent timestamp | Offer turnaround time; candidate responsiveness |
| **Acceptance** | 8 | Acceptance timestamp + sentiment | Offer acceptance rate; sentiment flag (HESITANT = risk) |
| **First Engagement** | 11 | Date, type, initiator | **Time to first engagement (target: < 48 hours)** |
| **Pre-Onboarding Completion** | 9–10 | IT checklist completion | IT readiness score (target: 100%) |
| **Day 1** | 12 | Checklist completion; candidate survey | Day 1 readiness score; candidate experience score |

### Dashboard KPIs (Summary)

| KPI | Target | Frequency |
|---|---|---|
| First Interaction Logged | 100% same day | Per candidate |
| Interview Turnaround Time | TBD (benchmark required) | Per candidate |
| Decision Turnaround Time | TBD | Per batch |
| Offer Turnaround Time | TBD | Per offer |
| Offer Acceptance Rate | > 85% | Monthly |
| Time to First Engagement | < 48 hours | Per candidate |
| Pre-Onboarding Completion Rate | 100% before Day 1 | Per cohort |
| Day 1 Readiness Score | 100% | Per candidate |
| Candidate Experience Score | > 4.0 / 5.0 | Per candidate |
| Day 1 No-Show Rate | 0% | Monthly |

---

## 6. Stakeholder Responsibility Matrix

Based on the process flow diagrams:

| Step | HR | Hiring Manager | IT Department | Facilities / Admin | Candidate |
|---|---|---|---|---|---|
| 1. First Interview | ● | ● | | | ● |
| 2. Evaluation & Shortlisting | ● | ● | | | |
| 3. Second Interview Scheduled | ● | ● | | | ● |
| 4. Second Interview Conducted | ● | ● | | | ● |
| 5. Final Decision | ● | ● | | | |
| 6. Offer Creation & Approval | ● | ● | | | |
| 7. Offer Sent | ● | | | | ● |
| 8. Offer Accepted | ● | | | | ● |
| 9. Pre-Onboarding Initiated | ● | | | | ● |
| 10. IT & Facilities Prep | ● | | ● | ● | |
| 11. First Engagement Touchpoint | ● | ● | | | ● |
| 12. Day 1 Onboarding | ● | | ● | ● | ● |

**Key:**
- HR: Responsible throughout all 12 steps
- Hiring Manager: Primarily steps 1–7, plus Step 11 (First Engagement)
- IT Department: Steps 10–12
- Facilities/Admin: Steps 10–12
- Candidate: Active participant in all steps except Step 6 (Offer Creation) and Step 10 (IT/Facilities Prep)

---

## 7. Tracking & Engagement Checkpoints

These are the 8 core checkpoints that the system must track and report on:

### 1. First Interaction Logged
- **Trigger:** Interview conducted
- **What to capture:** CRM/ATS log entry + candidate sentiment score
- **Responsible:** HR

### 2. Interview Turnaround Time
- **Trigger:** Second interview completed
- **What to capture:** Track time between Step 1 and Step 4
- **Responsible:** HR

### 3. Decision Turnaround Time
- **Trigger:** Final decision made (Step 5)
- **What to capture:** Track time from last interview to decision
- **Responsible:** HR + Hiring Manager

### 4. Offer Turnaround Time
- **Trigger:** Offer sent (Step 7)
- **What to capture:** Track time from decision to offer sent
- **Responsible:** HR

### 5. Offer Acceptance Timestamp
- **Trigger:** Offer accepted (Step 8)
- **What to capture:** Capture acceptance date + sentiment flag
- **Responsible:** HR

### 6. Time to First Engagement
- **Trigger:** First meaningful post-acceptance interaction (Step 11)
- **What to capture:** Date, type, initiator, candidate feedback
- **Target:** < 48 hours from acceptance timestamp
- **Responsible:** HR + Hiring Manager

### 7. Pre-Onboarding Completion
- **Trigger:** IT checklist complete + welcome package sent
- **What to capture:** Checklist Y/N per item; completion timestamp
- **Responsible:** IT + Facilities + HR

### 8. Day 1 Readiness Score
- **Trigger:** Day 1 arrived
- **What to capture:** Equipment ✓ + Access ✓ + Engagement ✓
- **Target:** 100%
- **Responsible:** IT + Facilities + HR

---

## 8. Government Onboarding Specifics

The documentation includes a specialised **Government Onboarding Process** that extends the standard 12-step flow with additional compliance and clearance requirements.

### Additional Phase: Pre-Onboarding & Statutory Clearances (Step 9 — Government)

In the government context, Step 9 is significantly expanded:

| Clearance Type | Description | Required For |
|---|---|---|
| Background Verification | General background check | All roles |
| Character & Antecedent Verification | Character reference verification | All roles |
| Medical Examination | Fitness for duty | As applicable |
| Security Clearance | Security vetting | Sensitive roles |
| Document Verification | Certificate and qualification verification | All roles |
| Government ID Creation | DIGILOCKER / e-HRMS registration | All roles |

### Government IT Provisioning (Step 10 — Government)

Extended provisioning requirements beyond standard IT setup:

| System | Purpose |
|---|---|
| eOffice | Government document management |
| HRMS | HR Management System |
| PFMS | Public Financial Management System |
| Email ID | Official government email |

### Government Compliance & Policy Alignment (Applicable Throughout All 12 Steps)

| Requirement | Reference |
|---|---|
| Adherence to relevant Acts, Rules & Policies | CCS Rules, GFR, DoPT Guidelines |
| Data privacy & confidentiality | DPDP Act + Government IT Security Policy |
| Equal opportunity & reservation compliance | Government norms |
| Record keeping & audit trail | e-HRMS / official systems |
| Transparency, fairness & integrity | At every stage |

### Government Stakeholder Additions

| Role | Steps Involved |
|---|---|
| HR / Establishment Section | All 12 steps |
| Hiring Manager / Interview Panel | Steps 1–5 |
| Selection Committee / Appointing Authority | Steps 3–5 |
| IT Department | Steps 10–12 |
| Security / Vigilance | Steps 9–12 |
| Facilities / Admin | Steps 10–12 |
| Candidate | Steps 1–9, 11–12 |

---

## 9. Data Model Requirements

### Proposed New DynamoDB Table: `candidate-pipeline`

| Field | Type | Description |
|---|---|---|
| `candidate_id` | String (PK) | Unique candidate reference |
| `employee_id` | String | Links to `employees` table on conversion |
| `current_stage` | Enum | Current step (1–12) |
| `stage_history` | Map | Timestamps for each stage transition |
| `sentiment_history` | Array | Sentiment score at each captured stage |
| `conversion_timestamp` | Timestamp | Step 8 acceptance timestamp |
| `conversion_sentiment` | Enum | `EXCITED` / `NEUTRAL` / `HESITANT` / `RELUCTANT` |
| `first_engagement_timestamp` | Timestamp | Step 11 |
| `first_engagement_type` | Enum | Type of first engagement |
| `first_engagement_initiated_by` | String | Staff ID |
| `time_to_first_engagement_hours` | Number | Calculated field |
| `it_checklist` | Map | All IT/Facilities checklist items |
| `day1_readiness_score` | Number (0–100) | Composite Day 1 score |
| `candidate_experience_score` | Number (1–5) | Post Day-1 survey |
| `created_at` | Timestamp | |
| `updated_at` | Timestamp | |

### Proposed New DynamoDB Table: `interview-events`

Append-only audit trail of all interview-stage events (mirrors the `onboarding-events` pattern).

| Field | Type | Description |
|---|---|---|
| `event_id` | String (PK) | UUID |
| `timestamp` | String (SK) | ISO 8601 |
| `candidate_id` | String | |
| `step` | Number (1–12) | Which step |
| `actor_type` | Enum | `HUMAN` / `AGENT` |
| `actor_id` | String | Staff ID |
| `action` | String | What happened |
| `sentiment_captured` | Enum | If applicable |
| `metadata` | Map | Step-specific data |

### Proposed GSIs

| Table | GSI Name | PK | SK | Purpose |
|---|---|---|---|---|
| `candidate-pipeline` | `stage-index` | `current_stage` | `created_at` | Filter candidates by stage |
| `candidate-pipeline` | `conversion-index` | `conversion_sentiment` | `conversion_timestamp` | Analyse conversion sentiment trends |
| `interview-events` | `candidate-events-index` | `candidate_id` | `timestamp` | All events for a candidate |

---

## 10. Integration with Existing Naleko System

### Connection Points to Current System

| Phase 2 Event | Triggers in Current System | How |
|---|---|---|
| Step 8: Offer Accepted | Create employee record in `employees` table | `createEmployee` Lambda; `candidate_id` → `employee_id` |
| Step 8: Offer Accepted | Start `naleko-onboarding-flow` Step Functions | Current entry point — shift trigger upstream to acceptance |
| Step 10: IT Checklist complete | Resume Step Functions `WaitForTaskToken` | New task token pattern for IT readiness |
| Step 11: First Engagement logged | Write to `interview-events` audit table | New Lambda or extend `nalekoAiChat` |
| Step 12: Day 1 complete | Update `employees.stage` to `ACTIVE` | Extend `reviewDocumentVerification` or new Lambda |

### New Lambda Functions Required

| Function | Purpose |
|---|---|
| `createCandidateRecord` | Step 1 — log first interview, create candidate record |
| `updateCandidateStage` | Steps 2–12 — move candidate through pipeline stages |
| `logInterviewEvent` | Append event to `interview-events` audit table |
| `captureEngagementTouchpoint` | Step 11 — log first engagement with timestamp + type |
| `calculateDay1ReadinessScore` | Step 12 — composite score calculation |
| `getCandidatePipeline` | Query candidate pipeline for dashboard |
| `getPipelineAnalytics` | Aggregate KPIs (turnaround times, sentiment trends) |

### New Agent API Routes Required

| Method | Route | Lambda | Notes |
|---|---|---|---|
| `POST` | `/agent/v1/candidates` | `createCandidateRecord` | Start candidate at Step 1 |
| `GET` | `/agent/v1/candidates` | `getCandidatePipeline` | List all candidates + stages |
| `GET` | `/agent/v1/candidates/{id}` | `getCandidatePipeline` | Single candidate |
| `PUT` | `/agent/v1/candidates/{id}/stage` | `updateCandidateStage` | Advance stage |
| `POST` | `/agent/v1/candidates/{id}/engagement` | `captureEngagementTouchpoint` | Log Step 11 |
| `POST` | `/agent/v1/candidates/{id}/day1` | `calculateDay1ReadinessScore` | Log Day 1 |
| `GET` | `/agent/v1/analytics/pipeline` | `getPipelineAnalytics` | KPI dashboard data |

### New AI Assistant Templates Required (Phase 2)

Extend the existing 8 AI template cards with new Phase 2 templates:

| Template ID | Label | Purpose | HITL? |
|---|---|---|---|
| `check_pipeline_status` | Check Pipeline Status | Show all candidates by stage | No |
| `flag_engagement_risk` | Flag Engagement Risk | Identify HESITANT acceptances or missing first engagement | No |
| `log_first_engagement` | Log First Engagement | Record Step 11 touchpoint | Yes |
| `check_day1_readiness` | Day 1 Readiness Check | IT checklist status for joining candidates | No |
| `pipeline_analytics` | Pipeline Analytics | Turnaround time and conversion rate trends | No |

---

## 11. Open Questions & Decisions Required

| # | Question | Options | Priority |
|---|---|---|---|
| Q1 | Should the candidate pipeline be a separate system or extend the current HR Portal? | (a) Separate portal module; (b) Extend current portal with new route `/candidates` | High |
| Q2 | How is a "candidate" different from an "employee" — should they share one record? | (a) Separate `candidates` table, linked at conversion; (b) Single `persons` table with `status` field | High |
| Q3 | Who can see candidate sentiment data? | (a) HR only; (b) HR + Hiring Manager; (c) All staff with manager role | Medium |
| Q4 | Will sentiment capture be manual (HR enters it) or AI-assisted (NLP on notes)? | (a) Manual dropdown; (b) AI NLP on free-text notes via Bedrock | Medium |
| Q5 | Is there a Government onboarding client for Phase 2? | (a) Build government variant now; (b) Standard only, government later | Medium |
| Q6 | Should `time_to_first_engagement` trigger an alert if > 48 hours? | (a) Yes — email alert to HR manager; (b) Yes — AI panel warning; (c) Dashboard only | High |
| Q7 | Who owns the IT checklist in the portal? | (a) IT team has separate login; (b) HR submits on IT's behalf; (c) Self-service portal for IT | Medium |
| Q8 | Is the Day 1 readiness score visible to the candidate? | (a) Yes — candidate portal; (b) No — internal only | Low |

---

*Document prepared by Naleko Engineering for Phase 2 planning.*  
*Source: HR Verification Portal System Documentation v1, compiled by Koketso Zandile Mogashwa, 06 May 2026.*  
*Next step: Architecture review and Phase 2 sprint planning.*
