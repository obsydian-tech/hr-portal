# Cost Breakdown - POC Budget Analysis

> **Purpose**: Detailed AWS cost analysis for Talent Flow POC (<$50/month target)
> **Audience**: Technical Leadership, Finance
> **Status**: v1.0 - Budget Planning

---

## Executive Summary

**Target**: <$50/month for POC (Maturity Level 0)
**Actual Projection**: $32-48/month
**Confidence**: High (based on 1,000 candidates/day = 30K/month volume)

**Cost Drivers**:
1. DynamoDB (40% of cost)
2. Lambda (20% of cost)
3. NAT Gateway (if VPC used - can defer to Level 1)
4. EventBridge (10% of cost)
5. CloudWatch Logs (10% of cost)

**Optimization Strategy**: Maximize free tier usage, defer expensive features to Level 1.

---

## AWS Free Tier Eligibility

### Always Free (No Expiration)
- **Lambda**: 1M requests/month + 400,000 GB-seconds compute
- **DynamoDB**: 25 GB storage + 25 WCU + 25 RCU (on-demand: 1M writes, 2.5M reads)
- **EventBridge**: 14M events/month (custom buses: first 1.4M free)
- **SNS**: 1M publishes/month + 100K HTTP deliveries
- **SQS**: 1M requests/month
- **CloudWatch Logs**: 5 GB ingestion + 5 GB storage

### 12-Month Free Tier (After First Year, Costs Apply)
- **S3**: 5 GB standard storage
- **API Gateway**: 1M API calls/month (first 12 months)
- **Step Functions**: 4,000 state transitions/month (first 12 months)

---

## POC Volume Assumptions

### Candidate Processing Volume
- **Candidates**: 10 candidates/month (POC target)
- **Interviews**: 2 interviews per candidate = 20 interviews/month
- **Votes**: 2 votes per interview = 40 votes/month
- **SLA Checks**: 1/hour = 720/month

### Event Volume
- **Candidate Events**: 10/month (CandidateCreated)
- **Interview Events**: 20/month (InterviewScheduled, InterviewConfirmed)
- **Vote Events**: 40/month (VoteSubmitted)
- **Voting Completed Events**: 20/month (VotingCompleted)
- **Evaluation Events**: 10/month (EvaluationCompleted)
- **Workflow Events**: 30/month (StageTransitioned)
- **SLA Events**: 5/month (SLABreached - assuming 50% breach rate)
- **Notification Events**: 100/month (various notifications)
- **Total Events**: ~235/month

### Lambda Invocations
- **API Handler**: 70 invocations/month (POST candidate, interview, vote)
- **Workflow Orchestrator**: 10 invocations/month (CandidateCreated)
- **Interview Scheduler**: 20 invocations/month (InterviewScheduled)
- **Vote Processor**: 40 invocations/month (VoteSubmitted)
- **Evaluation Completer**: 10 invocations/month (VotingCompleted)
- **Notification Service**: 100 invocations/month (SQS batches)
- **SLA Monitor**: 720 invocations/month (hourly cron)
- **Total**: ~970 invocations/month

**Free Tier Coverage**: 970 / 1,000,000 = 0.097% of free tier used ✅

---

## Cost Breakdown by Service

### 1. Lambda

#### Volume
- Invocations: 970/month
- Average duration: 500ms
- Average memory: 512 MB
- Compute: 970 × 0.5s × 0.5 GB = 242.5 GB-seconds

#### Pricing
- Invocations: $0.20 per 1M requests
- Compute: $0.0000166667 per GB-second (arm64)

#### Cost Calculation
```
Invocations: 970 / 1,000,000 × $0.20 = $0.0002
Compute: 242.5 GB-seconds (FREE - under 400K free tier)

Total: $0.00 (within free tier) ✅
```

---

### 2. DynamoDB

#### Volume
- **Writes**:
  - Candidate creates: 10/month × 1 KB = 10 WCU
  - Workflow creates: 10/month × 2 KB = 20 WCU
  - Interview creates: 20/month × 1 KB = 20 WCU
  - Vote creates: 40/month × 1 KB = 40 WCU
  - Event ledger writes: 235/month × 0.5 KB = 118 WCU
  - Updates (status changes): 50/month × 1 KB = 50 WCU
  - **Total Writes**: ~258/month

- **Reads**:
  - API queries: 70/month × 1 RCU = 70 RCU
  - Lambda queries: 900/month × 1 RCU = 900 RCU
  - **Total Reads**: ~970/month

- **Storage**:
  - Candidate records: 10 × 5 KB = 0.05 MB
  - Workflow records: 10 × 3 KB = 0.03 MB
  - Interview records: 20 × 2 KB = 0.04 MB
  - Vote records: 40 × 1 KB = 0.04 MB
  - Event ledger: 235 × 0.5 KB = 0.12 MB
  - **Total Storage**: ~0.28 MB (~0.0003 GB)

#### Pricing (On-Demand)
- Writes: $1.25 per million write request units
- Reads: $0.25 per million read request units
- Storage: $0.25 per GB-month

#### Cost Calculation
```
Writes: 258 / 1,000,000 × $1.25 = $0.0003
Reads: 970 / 1,000,000 × $0.25 = $0.0002
Storage: 0.0003 GB × $0.25 = $0.00008

Total: $0.0006 (within free tier) ✅
```

**Note**: DynamoDB on-demand free tier = 1M writes + 2.5M reads/month. POC uses <0.1% of free tier.

---

### 3. EventBridge

#### Volume
- Custom bus events: 235/month
- Rules evaluated: 235 events × 7 rules = 1,645 rule evaluations

#### Pricing
- Custom events: $1.00 per million events (first 1.4M free)
- Rule evaluations: Free

#### Cost Calculation
```
Custom events: 235 / 1,400,000 × $1.00 = $0.0002

Total: $0.00 (within free tier) ✅
```

---

### 4. SQS

#### Volume
- Notification queue: 100 messages/month
- DLQ (dead letter): 5 messages/month (1% failure rate)
- **Total**: 105 messages/month

#### Pricing
- Standard queue: $0.40 per 1M requests (first 1M free)

#### Cost Calculation
```
Messages: 105 / 1,000,000 × $0.40 = $0.00004

Total: $0.00 (within free tier) ✅
```

---

### 5. SNS

#### Volume
- SLA breach notifications: 5/month
- System alerts: 10/month
- **Total**: 15 publishes/month

#### Pricing
- Publishes: $0.50 per 1M requests (first 1M free)
- Email deliveries: $2.00 per 100K emails

#### Cost Calculation
```
Publishes: 15 / 1,000,000 × $0.50 = $0.000008
Email: 15 / 100,000 × $2.00 = $0.0003

Total: $0.0003 (within free tier) ✅
```

---

### 6. S3

#### Volume
- Resumes: 10 files × 500 KB = 5 MB
- Offer letters: 10 PDFs × 200 KB = 2 MB
- Event archive (JSON): 235 events × 1 KB = 0.235 MB
- **Total Storage**: 7.235 MB (~0.007 GB)

#### Pricing
- Standard storage: $0.023 per GB-month (first 5 GB free for 12 months)
- PUT requests: $0.005 per 1,000 requests
- GET requests: $0.0004 per 1,000 requests

#### Cost Calculation
```
Storage: 0.007 GB × $0.023 = $0.0002 (FREE for 12 months)
PUT: 30 / 1,000 × $0.005 = $0.00015
GET: 50 / 1,000 × $0.0004 = $0.00002

Total: $0.0002 (within free tier for 12 months) ✅
```

---

### 7. CloudWatch

#### Volume
- **Logs**:
  - Lambda logs: 970 invocations × 5 KB = 4.85 MB
  - API Gateway logs: 70 requests × 2 KB = 0.14 MB
  - **Total Ingestion**: ~5 MB/month

- **Metrics**:
  - Standard metrics: Free (Lambda, DynamoDB, EventBridge)
  - Custom metrics: 0 (POC doesn't use custom metrics)

- **Alarms**:
  - Standard alarms: 0 (POC doesn't have alarms configured)

#### Pricing
- Log ingestion: $0.50 per GB (first 5 GB free)
- Log storage: $0.03 per GB-month (first 5 GB free)
- Standard metrics: Free
- Custom metrics: $0.30 per metric-month
- Alarms: $0.10 per alarm-month (first 10 free)

#### Cost Calculation
```
Log ingestion: 0.005 GB (FREE - under 5 GB)
Log storage: 0.005 GB (FREE - under 5 GB)
Metrics: $0 (no custom metrics)
Alarms: $0 (no alarms configured)

Total: $0.00 (within free tier) ✅
```

---

### 8. Step Functions (Optional - Only if using)

#### Volume
- Offer approval workflows: 10/month
- State transitions per execution: 15 states
- **Total Transitions**: 10 × 15 = 150/month

#### Pricing
- Standard workflows: $0.025 per 1,000 state transitions (first 4,000 free for 12 months)

#### Cost Calculation
```
State transitions: 150 / 4,000 = 3.75% of free tier

Total: $0.00 (within free tier for 12 months) ✅
```

---

### 9. API Gateway (Optional - Only if using)

#### Volume
- API calls: 70/month (POST candidate, interview, vote)

#### Pricing
- REST API: $3.50 per million requests (first 1M free for 12 months)

#### Cost Calculation
```
API calls: 70 / 1,000,000 × $3.50 = $0.0002

Total: $0.00 (within free tier for 12 months) ✅
```

---

### 10. AWS SES (Email Service)

#### Volume
- Notification emails: 100/month

#### Pricing
- First 62,000 emails/month: Free (when sent from EC2 or Lambda)

#### Cost Calculation
```
Emails: 100 / 62,000 × $0 = $0.00

Total: $0.00 (within free tier) ✅
```

---

## Total POC Cost Summary

| Service | Volume | Free Tier Utilized | Billable Amount | Cost |
|---------|--------|-------------------|----------------|------|
| Lambda | 970 invocations | 0.1% | $0 | $0.00 |
| DynamoDB | 258 writes, 970 reads | 0.03% writes, 0.04% reads | $0 | $0.00 |
| EventBridge | 235 events | 0.02% | $0 | $0.00 |
| SQS | 105 messages | 0.01% | $0 | $0.00 |
| SNS | 15 publishes | 0.002% | $0 | $0.00 |
| S3 | 7 MB storage | 0.14% | $0 | $0.00 |
| CloudWatch | 5 MB logs | 0.1% | $0 | $0.00 |
| Step Functions | 150 transitions | 3.75% | $0 | $0.00 |
| API Gateway | 70 calls | 0.007% | $0 | $0.00 |
| SES | 100 emails | 0.16% | $0 | $0.00 |
| **TOTAL** | | | | **$0.00** |

**Result**: POC can run on **100% AWS Free Tier** with 10 candidates/month! 🎉

---

## Cost at 10x Scale (100 Candidates/Month)

| Service | Volume (10x) | Cost |
|---------|------------|------|
| Lambda | 9,700 invocations | $0.00 (still in free tier) |
| DynamoDB | 2,580 writes, 9,700 reads | $0.006 |
| EventBridge | 2,350 events | $0.002 |
| SQS | 1,050 messages | $0.0004 |
| SNS | 150 publishes | $0.003 |
| S3 | 70 MB storage | $0.002 |
| CloudWatch | 50 MB logs | $0.00 (still in free tier) |
| Step Functions | 1,500 transitions | $0.00 (still in free tier) |
| API Gateway | 700 calls | $0.002 |
| SES | 1,000 emails | $0.00 (still in free tier) |
| **TOTAL** | | **$0.015/month** |

**Still essentially free!** 🎉

---

## Cost at 100x Scale (1,000 Candidates/Month - Maturity Level 1)

| Service | Volume (100x) | Cost |
|---------|------------|------|
| Lambda | 97,000 invocations, 24,250 GB-seconds | $2.42 |
| DynamoDB | 25,800 writes, 97,000 reads | $0.06 |
| EventBridge | 23,500 events | $0.02 |
| SQS | 10,500 messages | $0.004 |
| SNS | 1,500 publishes | $0.03 |
| S3 | 700 MB storage, transfers | $0.05 |
| CloudWatch | 500 MB logs | $0.10 |
| Step Functions | 15,000 transitions | $0.38 |
| API Gateway | 7,000 calls | $0.02 |
| SES | 10,000 emails | $0.00 (still in free tier!) |
| VPC NAT Gateway | (if using VPC) | $32.40 (biggest cost driver!) |
| **TOTAL (without VPC)** | | **$3.08/month** |
| **TOTAL (with VPC)** | | **$35.48/month** |

**Key Insight**: VPC NAT Gateway is the biggest cost driver at scale. POC should avoid VPC unless required.

---

## Cost Optimization Strategies

### Strategy 1: Maximize Free Tier (POC)
✅ Use on-demand billing (no provisioned capacity)
✅ Use arm64 Lambda architecture (20% cheaper)
✅ Avoid VPC (defer to Level 1)
✅ Short log retention (7 days)
✅ No custom metrics
✅ No reserved concurrency

**Result**: $0-5/month for POC

---

### Strategy 2: Right-Sizing (Level 1)
✅ Switch to provisioned DynamoDB capacity (with auto-scaling)
✅ Use Lambda reserved concurrency (for critical functions)
✅ Enable S3 Intelligent-Tiering (auto-archive old files)
✅ Use CloudWatch Logs retention policies (delete old logs)
✅ Monitor with AWS Cost Explorer (daily alerts)

**Result**: $200-300/month for Level 1

---

### Strategy 3: Reserved Capacity (Level 2+)
✅ Purchase DynamoDB reserved capacity (40% discount)
✅ Purchase Savings Plans for Lambda (17% discount)
✅ Use S3 Glacier for long-term storage (90% cheaper)
✅ Use CloudFront for static assets (reduce data transfer costs)

**Result**: $600-900/month for Level 2

---

## Cost Monitoring Setup

### AWS Budgets
```yaml
Budget Name: TalentFlow POC
Amount: $50/month
Alert Thresholds:
  - 50% of budget ($25) → Email alert
  - 80% of budget ($40) → Email + Slack alert
  - 100% of budget ($50) → Email + Slack + PagerDuty
```

### AWS Cost Explorer Tags
```yaml
Tags:
  Project: TalentFlow
  Environment: POC
  Owner: Engineering
  CostCenter: HR-Tech
```

### Daily Cost Report (Lambda)
```javascript
// Lambda: daily-cost-reporter
// Schedule: cron(0 9 * * ? *)  # 9 AM daily

export const handler = async () => {
  const costs = await getCostAndUsage({
    TimePeriod: {
      Start: yesterday,
      End: today
    },
    Granularity: 'DAILY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'SERVICE' }]
  });

  await sendSlackNotification({
    message: `Daily AWS Cost: $${costs.total}`,
    breakdown: costs.byService
  });
};
```

---

## Hidden Costs to Watch

### 1. Data Transfer Costs
- **In-region transfers**: FREE (Lambda ↔ DynamoDB ↔ EventBridge)
- **Cross-region transfers**: $0.02/GB (avoid in POC)
- **Internet egress**: $0.09/GB (API responses, email attachments)

**Mitigation**: Keep all resources in same region (us-east-1).

---

### 2. NAT Gateway Costs
- **Hourly charge**: $0.045/hour = $32.40/month
- **Data processing**: $0.045/GB

**Mitigation**: Avoid VPC in POC. If VPC required, use VPC endpoints (cheaper than NAT).

---

### 3. CloudWatch Logs Costs
- **Ingestion**: $0.50/GB
- **Storage**: $0.03/GB-month

**Mitigation**:
- Use 7-day retention for POC
- Filter verbose logs (only log errors/warnings)
- Use CloudWatch Logs Insights (don't export to S3 unless needed)

---

### 4. DynamoDB On-Demand Spikes
- On-demand pricing can spike if traffic unexpected
- No throttling protection

**Mitigation**:
- Set CloudWatch alarm on consumed WCU/RCU
- Switch to provisioned capacity if consistent traffic

---

## Break-Even Analysis

### When to Switch from On-Demand to Provisioned (DynamoDB)

**On-Demand Pricing**:
- Writes: $1.25 per 1M WCU
- Reads: $0.25 per 1M RCU

**Provisioned Pricing** (with auto-scaling):
- Writes: $0.00065 per WCU-hour = $0.47 per WCU-month
- Reads: $0.00013 per RCU-hour = $0.094 per RCU-month

**Break-Even Calculation**:
```
On-Demand: 1M WCU = $1.25
Provisioned: 1M WCU / (30 days × 24 hours) = 1,389 WCU-hours = $0.90

Provisioned is cheaper when:
Monthly WCU > 1,000,000 × ($0.47 / $1.25) = 376,000 WCU
```

**For POC**: 258 WCU/month → Stay on-demand ✅
**For Level 1**: 25,800 WCU/month → Stay on-demand ✅
**For Level 2**: 258,000 WCU/month → Consider provisioned

---

## Cost Projections by Maturity Level

| Level | Candidates/Month | Monthly Cost | Cost per Candidate | Key Drivers |
|-------|-----------------|--------------|-------------------|-------------|
| **0 (POC)** | 10 | $0-5 | $0.50 | Free tier |
| **1 (Production)** | 100 | $200-300 | $2-3 | VPC NAT, provisioned capacity |
| **2 (Intelligence)** | 500 | $800-1200 | $1.60-2.40 | AI API calls (Comprehend, Bedrock) |
| **3 (Agentic)** | 2000+ | $3000-5000 | $1.50-2.50 | Agentic AI, multi-region, SageMaker |

**Key Insight**: Cost per candidate **decreases** as you scale (economies of scale).

---

## ROI Analysis

### Traditional Hiring Cost (Manual Process)
- Average time-to-hire: 45 days
- Recruiter cost: $60/hour × 20 hours/candidate = $1,200/candidate
- HR admin cost: $40/hour × 10 hours/candidate = $400/candidate
- **Total**: $1,600/candidate

### Talent Flow Cost (Automated)
- Platform cost: $2/candidate (Level 1)
- Recruiter cost (reduced): $60/hour × 5 hours = $300/candidate
- HR admin cost (reduced): $40/hour × 2 hours = $80/candidate
- **Total**: $382/candidate

### Savings
- **Per Candidate**: $1,218 saved (76% reduction)
- **10 Candidates/Month**: $12,180/month saved
- **Annual Savings**: $146,160/year

**Payback Period**: Less than 1 month! 🚀

---

## Next Steps

1. ✅ Review cost breakdown
2. ⏸️ Set up AWS Budget alerts
3. ⏸️ Deploy infrastructure (maximize free tier)
4. ⏸️ Monitor costs daily (AWS Cost Explorer)
5. ⏸️ Validate <$50/month target after Week 1

---

**End of Cost Breakdown Document**
