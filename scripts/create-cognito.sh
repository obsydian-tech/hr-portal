#!/bin/bash
# Naleko HR Portal — Cognito Setup Script
# Creates User Pool, App Client, Groups, and Seeds HR Users
# Region: af-south-1 | Account: 937137806477

set -e

REGION="af-south-1"
POOL_NAME="naleko-dev-user-pool"

echo "=== Step 1: Creating User Pool ==="

USER_POOL_ID=$(aws cognito-idp create-user-pool \
  --pool-name "$POOL_NAME" \
  --region "$REGION" \
  --policies '{"PasswordPolicy":{"MinimumLength":12,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":true,"TemporaryPasswordValidityDays":7}}' \
  --auto-verified-attributes email \
  --username-attributes email \
  --username-configuration '{"CaseSensitivity":false}' \
  --schema '[{"Name":"email","AttributeDataType":"String","Required":true,"Mutable":true},{"Name":"given_name","AttributeDataType":"String","Required":false,"Mutable":true},{"Name":"family_name","AttributeDataType":"String","Required":false,"Mutable":true}]' \
  --admin-create-user-config '{"AllowAdminCreateUserOnly":true,"InviteMessageTemplate":{"EmailSubject":"Welcome to Naleko HR Portal","EmailMessage":"Hello {username}, your Naleko HR Portal account has been created. Your temporary password is: {####}. Please log in and change your password."}}' \
  --account-recovery-setting '{"RecoveryMechanisms":[{"Priority":1,"Name":"verified_email"}]}' \
  --query 'UserPool.Id' \
  --output text)

echo "User Pool created: $USER_POOL_ID"

echo ""
echo "=== Step 2: Adding Custom Attributes ==="

aws cognito-idp add-custom-attributes \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --custom-attributes \
    '[{"Name":"staff_id","AttributeDataType":"String","Mutable":true,"StringAttributeConstraints":{"MinLength":"0","MaxLength":"20"}},{"Name":"employee_id","AttributeDataType":"String","Mutable":true,"StringAttributeConstraints":{"MinLength":"0","MaxLength":"20"}},{"Name":"role","AttributeDataType":"String","Mutable":true,"StringAttributeConstraints":{"MinLength":"0","MaxLength":"20"}}]'

echo "Custom attributes added: staff_id, employee_id, role"

echo ""
echo "=== Step 3: Creating App Client (SPA - no secret) ==="

CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --client-name "naleko-dev-web-client" \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_PASSWORD_AUTH \
  --access-token-validity 1 \
  --id-token-validity 1 \
  --refresh-token-validity 30 \
  --token-validity-units '{"AccessToken":"hours","IdToken":"hours","RefreshToken":"days"}' \
  --read-attributes '["email","given_name","family_name","custom:staff_id","custom:employee_id","custom:role"]' \
  --write-attributes '["email","given_name","family_name"]' \
  --query 'UserPoolClient.ClientId' \
  --output text)

echo "App Client created: $CLIENT_ID"

echo ""
echo "=== Step 4: Creating User Groups ==="

aws cognito-idp create-group \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --group-name "hr_staff" \
  --description "HR managers and administrators - full access"

echo "Group created: hr_staff"

aws cognito-idp create-group \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --group-name "employee" \
  --description "Onboarding employees - own data access only"

echo "Group created: employee"

echo ""
echo "=== Step 5: Seeding HR Staff Users ==="

# HR Staff Registry (from hr-staff.ts)
# Format: "FirstName:LastName:Email"
declare -A HR_USERS
HR_USERS["AS00001"]="Thabo:Molefe:Thabo.Molefe@gcu.co.za"
HR_USERS["AS00002"]="Neo:Zonke:Neo@gcu.co.za"
HR_USERS["AS00003"]="Joe:Doe:Joe.Doe@gcu.co.za"
HR_USERS["AS00004"]="Lindiwe:Khumalo:Lindiwe.Khumalo@gcu.co.za"
HR_USERS["AS00005"]="Sipho:Dlamini:Sipho.Dlamini@gcu.co.za"
HR_USERS["AS00006"]="Nomsa:Mthembu:Nomsa.Mthembu@gcu.co.za"

# Default password for dev testing (HR staff will change on first login in production)
DEV_PASSWORD="Naleko@2026!Dev"

for STAFF_ID in "${!HR_USERS[@]}"; do
  IFS=':' read -r FIRST_NAME LAST_NAME EMAIL <<< "${HR_USERS[$STAFF_ID]}"

  echo "Creating user: $STAFF_ID ($FIRST_NAME $LAST_NAME - $EMAIL)"

  aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --region "$REGION" \
    --username "$EMAIL" \
    --user-attributes \
      Name=email,Value="$EMAIL" \
      Name=email_verified,Value=true \
      Name=given_name,Value="$FIRST_NAME" \
      Name=family_name,Value="$LAST_NAME" \
      Name=custom:staff_id,Value="$STAFF_ID" \
      Name=custom:employee_id,Value="" \
      Name=custom:role,Value="hr_staff" \
    --message-action SUPPRESS \
    --query 'User.Username' \
    --output text

  # Set a permanent password (skips FORCE_CHANGE_PASSWORD state)
  aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --region "$REGION" \
    --username "$EMAIL" \
    --password "$DEV_PASSWORD" \
    --permanent

  echo "  -> Password set"

  # Add to hr_staff group
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --region "$REGION" \
    --username "$EMAIL" \
    --group-name "hr_staff"

  echo "  -> Added to hr_staff group"
done

echo ""
echo "============================================"
echo "  COGNITO SETUP COMPLETE"
echo "============================================"
echo ""
echo "  User Pool ID:  $USER_POOL_ID"
echo "  App Client ID: $CLIENT_ID"
echo "  Region:        $REGION"
echo ""
echo "  Add these to your environment.ts:"
echo "  cognito: {"
echo "    userPoolId: '$USER_POOL_ID',"
echo "    clientId: '$CLIENT_ID',"
echo "    region: '$REGION'"
echo "  }"
echo ""
echo "  HR Users created (6):"
echo "  AS00001 - Thabo Molefe"
echo "  AS00002 - Neo Zonke"
echo "  AS00003 - Joe Doe"
echo "  AS00004 - Lindiwe Khumalo"
echo "  AS00005 - Sipho Dlamini"
echo "  AS00006 - Nomsa Mthembu"
echo ""
echo "  Dev password for all HR users: Naleko@2026!Dev"
echo "  (Set permanently — no force-change in dev)"
echo "============================================"
