#!/usr/bin/env bash
# =============================================================================
# NH-10 Bootstrap — Naleko Terraform State Infrastructure
# =============================================================================
# Run ONCE before `terraform init`. Creates the S3 bucket and DynamoDB table
# that Terraform uses to store and lock state. These resources are intentionally
# NOT managed by Terraform (they must exist before Terraform can run).
#
# Prerequisites:
#   aws cli v2 configured with credentials for account 937137806477
#   Run: aws sts get-caller-identity   to confirm correct account
#
# Usage:
#   chmod +x scripts/bootstrap-terraform.sh
#   ./scripts/bootstrap-terraform.sh
# =============================================================================

set -euo pipefail

REGION="af-south-1"
ACCOUNT_ID="937137806477"
STATE_BUCKET="naleko-tfstate-af-south-1"
LOCK_TABLE="naleko-tflock"

echo "=== Naleko Terraform Bootstrap ==="
echo "Region:  $REGION"
echo "Account: $ACCOUNT_ID"
echo ""

# ── Guard: confirm we're in the right account ────────────────────────────────
CURRENT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
if [[ "$CURRENT_ACCOUNT" != "$ACCOUNT_ID" ]]; then
  echo "ERROR: Expected account $ACCOUNT_ID but got $CURRENT_ACCOUNT"
  echo "Configure the correct AWS credentials and retry."
  exit 1
fi
echo "✓ Account confirmed: $CURRENT_ACCOUNT"

# ── S3 state bucket ──────────────────────────────────────────────────────────
echo ""
echo "Creating S3 state bucket: $STATE_BUCKET"

# af-south-1 requires LocationConstraint (unlike us-east-1)
aws s3api create-bucket \
  --bucket "$STATE_BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" 2>/dev/null \
  || echo "  (bucket already exists — skipping)"

# Enable versioning — allows rollback to any previous state file
aws s3api put-bucket-versioning \
  --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled
echo "  ✓ Versioning enabled"

# Block all public access
aws s3api put-public-access-block \
  --bucket "$STATE_BUCKET" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
echo "  ✓ Public access blocked"

# Enable server-side encryption (AES-256 is fine for state — not PII)
aws s3api put-bucket-encryption \
  --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'
echo "  ✓ Encryption enabled (SSE-S3)"

# Block object deletion unless versioned (protects state from accidental rm)
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$STATE_BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-old-state-versions",
      "Status": "Enabled",
      "NoncurrentVersionExpiration": { "NoncurrentDays": 90 },
      "Filter": { "Prefix": "" }
    }]
  }'
echo "  ✓ Lifecycle: old state versions expire after 90 days"

# ── DynamoDB lock table ───────────────────────────────────────────────────────
echo ""
echo "Creating DynamoDB lock table: $LOCK_TABLE"

aws dynamodb create-table \
  --table-name "$LOCK_TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" 2>/dev/null \
  || echo "  (table already exists — skipping)"

echo "  ✓ DynamoDB lock table ready"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Next steps:"
echo "  cd infra"
echo "  terraform init"
echo "  terraform validate"
echo ""
echo "Then proceed to NH-11: terraform import existing resources."
