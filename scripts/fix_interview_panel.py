#!/usr/bin/env python3
"""
Fix all INTERVIEW# records:
 - Remove bogus 'hr@naleko.co.za' from panelMemberIds
 - Set votesRequired = 1 (single HM reviewer, no panel)
 - Keep votesSubmitted as-is so existing votes aren't lost
"""
import boto3
from boto3.dynamodb.conditions import Attr

TABLE  = 'talent-flow-state'
REGION = 'af-south-1'
BOGUS  = 'hr@naleko.co.za'

dynamo = boto3.resource('dynamodb', region_name=REGION)
table  = dynamo.Table(TABLE)

print("Scanning for INTERVIEW# records...")
records = []
kwargs = {
    'FilterExpression': Attr('SK').begins_with('INTERVIEW#'),
}
while True:
    resp = table.scan(**kwargs)
    records.extend(resp.get('Items', []))
    last = resp.get('LastEvaluatedKey')
    if not last:
        break
    kwargs['ExclusiveStartKey'] = last

print(f"Found {len(records)} INTERVIEW records\n")

for rec in records:
    pk = rec['PK']
    sk = rec['SK']
    panel = rec.get('panelMemberIds', [])
    votes_required = int(rec.get('votesRequired', 2))

    # Clean panel: remove bogus placeholder
    cleaned_panel = [m for m in panel if m != BOGUS]
    panel_changed  = len(cleaned_panel) != len(panel)

    changes = []
    update_expr_parts = ['votesRequired = :vr']
    expr_values = {':vr': 1}

    if panel_changed:
        update_expr_parts.append('panelMemberIds = :pm')
        expr_values[':pm'] = cleaned_panel
        changes.append(f"panelMemberIds: {panel} → {cleaned_panel}")

    if votes_required != 1:
        changes.append(f"votesRequired: {votes_required} → 1")

    table.update_item(
        Key={'PK': pk, 'SK': sk},
        UpdateExpression='SET ' + ', '.join(update_expr_parts),
        ExpressionAttributeValues=expr_values,
    )

    if changes:
        print(f"  FIXED {pk} / {sk}")
        for c in changes:
            print(f"        {c}")
    else:
        print(f"  OK    {pk} / {sk}  (votesRequired already 1, panel clean)")

print("\nDone.")
