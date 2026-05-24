#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# create-it-specialist-demo-user.sh
#
# Creates a demo IT Specialist user in the Naleko Cognito pool and assigns
# them to the naleko-it-provisioning group so they can access Screen 4.
#
# Prerequisites: AWS CLI configured, correct profile/region active.
# Usage: bash scripts/create-it-specialist-demo-user.sh
# ---------------------------------------------------------------------------

set -euo pipefail

POOL_ID="af-south-1_2LdAGFnw2"
REGION="af-south-1"
EMAIL="it.specialist@naleko.co.za"
TEMP_PASSWORD="Naleko@IT2026!"
GIVEN_NAME="Sipho"
FAMILY_NAME="Dlamini"
GROUP="naleko-it-provisioning"

echo "==> Creating user: $EMAIL in pool $POOL_ID"
aws cognito-idp admin-create-user \
  --region "$REGION" \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --user-attributes \
    Name=email,Value="$EMAIL" \
    Name=email_verified,Value=true \
    Name=given_name,Value="$GIVEN_NAME" \
    Name=family_name,Value="$FAMILY_NAME" \
    Name=custom:role,Value="it_specialist" \
  --temporary-password "$TEMP_PASSWORD" \
  --message-action SUPPRESS

echo "==> Adding $EMAIL to group: $GROUP"
aws cognito-idp admin-add-user-to-group \
  --region "$REGION" \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --group-name "$GROUP"

echo ""
echo "✅ Done. Demo IT Specialist created."
echo "   Email:    $EMAIL"
echo "   Password: $TEMP_PASSWORD  (temporary — will prompt reset on first login)"
echo "   Group:    $GROUP"
echo ""
echo "The user will see the IT Requests tile on platform home after login."
