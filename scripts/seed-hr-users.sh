#!/bin/bash
set -e

POOL_ID="af-south-1_2LdAGFnw2"
REGION="af-south-1"
PASSWORD='Naleko@2026#Dev'

create_hr_user() {
  local email=$1
  local first=$2
  local last=$3
  local staff_id=$4
  
  echo "Processing $staff_id ($first $last - $email)..."
  
  # Try to create; skip if already exists
  if aws cognito-idp admin-create-user \
    --user-pool-id "$POOL_ID" \
    --region "$REGION" \
    --username "$email" \
    --user-attributes \
      "Name=email,Value=$email" \
      "Name=email_verified,Value=true" \
      "Name=given_name,Value=$first" \
      "Name=family_name,Value=$last" \
      "Name=custom:staff_id,Value=$staff_id" \
      "Name=custom:employee_id,Value=" \
      "Name=custom:role,Value=hr_staff" \
    --message-action SUPPRESS \
    --query 'User.Username' \
    --output text 2>&1; then
    echo "  Created."
  else
    echo "  Already exists, skipping create."
  fi
  
  echo "  Setting password..."
  aws cognito-idp admin-set-user-password \
    --user-pool-id "$POOL_ID" \
    --region "$REGION" \
    --username "$email" \
    --password "$PASSWORD" \
    --permanent
  
  echo "  Adding to hr_staff group..."
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$POOL_ID" \
    --region "$REGION" \
    --username "$email" \
    --group-name "hr_staff"
  
  echo "  Done."
  echo ""
}

create_hr_user "Thabo.Molefe@gcu.co.za" "Thabo" "Molefe" "AS00001"
create_hr_user "Neo@gcu.co.za" "Neo" "Zonke" "AS00002"
create_hr_user "Joe.Doe@gcu.co.za" "Joe" "Doe" "AS00003"
create_hr_user "Lindiwe.Khumalo@gcu.co.za" "Lindiwe" "Khumalo" "AS00004"
create_hr_user "Sipho.Dlamini@gcu.co.za" "Sipho" "Dlamini" "AS00005"
create_hr_user "Nomsa.Mthembu@gcu.co.za" "Nomsa" "Mthembu" "AS00006"

echo "=== All 6 HR users created and configured ==="
echo "Password for all: $PASSWORD"
