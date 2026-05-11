#!/usr/bin/env bash
# =============================================================================
# deploy-lambdas.sh — zip + update-function-code for one or more Lambdas
#
# Usage:
#   ./scripts/deploy-lambdas.sh                    # deploy all sprint-changed Lambdas
#   ./scripts/deploy-lambdas.sh nalekoAiChat       # deploy a single Lambda
#   ./scripts/deploy-lambdas.sh nalekoAiChat agentAuthorizer
#
# Prerequisites:
#   aws cli v2 configured (run: aws sts get-caller-identity to confirm)
#   Node 22 + npm on PATH
#
# Lambdas changed in sprint NH-80:
#   cognitoPostAuth    — new: bumps stage INVITED → ACTIVE on first login
#   processDocumentOCR — bumps stage ACTIVE → DOCUMENTS_SUBMITTED on first doc
#   reviewDocumentVerification — conditional guard added to VERIFIED transition
# =============================================================================

set -euo pipefail

REGION="af-south-1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAMBDA_DIR="$REPO_ROOT/lambda"
TMP_DIR="${TMPDIR:-/tmp}"

# Default sprint batch — override by passing names as args
SPRINT_LAMBDAS=(cognitoPostAuth processDocumentOCR reviewDocumentVerification)
TARGETS=("${@:-${SPRINT_LAMBDAS[@]}}")

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
fail() { echo -e "${RED}✗  $*${NC}"; exit 1; }

# ── Preflight ─────────────────────────────────────────────────────────────────
echo "=== Naleko Lambda Deploy ==="
echo "Region:  $REGION"
echo "Targets: ${TARGETS[*]}"
echo ""

aws sts get-caller-identity --query 'Account' --output text > /dev/null \
  || fail "AWS credentials not configured. Run: aws configure"

# ── Deploy each Lambda ────────────────────────────────────────────────────────
for LAMBDA in "${TARGETS[@]}"; do
  SRC="$LAMBDA_DIR/$LAMBDA"
  ZIP="$TMP_DIR/${LAMBDA}.zip"

  echo "── $LAMBDA ──────────────────────────────────────────"

  [[ -d "$SRC" ]] || fail "Directory not found: $SRC"

  # Install production deps if package.json exists
  if [[ -f "$SRC/package.json" ]]; then
    echo "   npm ci --omit=dev"
    (cd "$SRC" && npm ci --omit=dev --silent)
    ok "deps installed"
  else
    warn "no package.json — skipping npm ci"
  fi

  # Remove old zip if present
  rm -f "$ZIP"

  # Zip from inside the Lambda dir so paths are root-relative
  echo "   zipping → $ZIP"
  (cd "$SRC" && zip -r "$ZIP" . \
    --exclude "*.test.*" \
    --exclude "*.spec.*" \
    --exclude ".git*" \
    --exclude "node_modules/.bin/*" \
    > /dev/null)
  ok "zipped ($(du -sh "$ZIP" | cut -f1))"

  # Push to AWS
  echo "   aws lambda update-function-code"
  aws lambda update-function-code \
    --function-name "$LAMBDA" \
    --zip-file "fileb://$ZIP" \
    --region "$REGION" \
    --query 'FunctionArn' \
    --output text

  ok "$LAMBDA deployed"
  echo ""
done

echo -e "${GREEN}=== All done ===${NC}"
