#!/usr/bin/env python3
"""
Backfill currentInterviewId on SAGA records.
For each candidate that has INTERVIEW# records, finds the most recent SCHEDULED
interview and writes its interviewId as currentInterviewId on the SAGA record.
"""
import boto3
from boto3.dynamodb.conditions import Key, Attr
from collections import defaultdict

TABLE = 'talent-flow-state'
REGION = 'af-south-1'

dynamo = boto3.resource('dynamodb', region_name=REGION)
table = dynamo.Table(TABLE)

# Step 1: Scan all INTERVIEW# records
print("Scanning for all INTERVIEW# records...")
interview_records = []
scan_kwargs = {
    'FilterExpression': Attr('SK').begins_with('INTERVIEW#'),
    'ProjectionExpression': 'PK, SK, interviewId, #s, createdAt',
    'ExpressionAttributeNames': {'#s': 'status'},
}
while True:
    resp = table.scan(**scan_kwargs)
    interview_records.extend(resp.get('Items', []))
    last_key = resp.get('LastEvaluatedKey')
    if not last_key:
        break
    scan_kwargs['ExclusiveStartKey'] = last_key

print(f"Found {len(interview_records)} INTERVIEW records")

# Step 2: Group by candidateId (PK)
by_candidate = defaultdict(list)
for rec in interview_records:
    by_candidate[rec['PK']].append(rec)

# Step 3: For each candidate, pick the active interview
#   Priority: SCHEDULED > COMPLETED > others; most recent createdAt
def pick_interview(records):
    scheduled = [r for r in records if r.get('status') == 'SCHEDULED']
    if scheduled:
        return sorted(scheduled, key=lambda r: r.get('createdAt', ''), reverse=True)[0]
    # fallback: most recent
    return sorted(records, key=lambda r: r.get('createdAt', ''), reverse=True)[0]

# Step 4: Backfill SAGA records
updated = 0
skipped = 0
for pk, records in by_candidate.items():
    chosen = pick_interview(records)
    interview_id = chosen.get('interviewId')
    if not interview_id:
        print(f"  SKIP {pk}: interview record has no interviewId field")
        skipped += 1
        continue

    # Check current SAGA state
    saga_resp = table.get_item(Key={'PK': pk, 'SK': 'SAGA'})
    saga = saga_resp.get('Item')
    if not saga:
        print(f"  WARN {pk}: no SAGA record found")
        skipped += 1
        continue

    existing = saga.get('currentInterviewId')
    if existing == interview_id:
        print(f"  OK   {pk}: already has currentInterviewId={interview_id}")
        skipped += 1
        continue

    # Write currentInterviewId
    table.update_item(
        Key={'PK': pk, 'SK': 'SAGA'},
        UpdateExpression='SET currentInterviewId = :iid',
        ExpressionAttributeValues={':iid': interview_id},
    )
    print(f"  SET  {pk}: currentInterviewId={interview_id} (was {existing!r})")
    updated += 1

print(f"\nDone. Updated: {updated}, Skipped/OK: {skipped}")
