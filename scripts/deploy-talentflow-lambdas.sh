#!/usr/bin/env bash
# =============================================================================
# deploy-talentflow-lambdas.sh — Package & deploy all TalentFlow EP2 Lambdas
#
# Usage:
#   bash scripts/deploy-talentflow-lambdas.sh               # deploy all 8
#   bash scripts/deploy-talentflow-lambdas.sh completeEvaluation submitVote
#
# Lambdas using ../shared/config-reader are automatically patched:
#   - shared/config-reader.js is bundled INTO the zip at root level
#   - require('../shared/config-reader') → require('./shared/config-reader')
#
# Prerequisites:
#   aws cli v2 configured (aws sts get-caller-identity to verify)
#   Node 22 + npm on PATH
# =============================================================================

set -euo pipefail

REGION="af-south-1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAMBDA_DIR="$REPO_ROOT/lambda"
SHARED_SRC="$LAMBDA_DIR/shared/config-reader.js"
BUILD_ROOT="/tmp/tf-ep2-build"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
fail() { echo -e "${RED}✗  $*${NC}"; }

# ---------------------------------------------------------------------------
# All Lambda directories (under lambda/) that have real code.
# EP2: createCandidate through talentFlowPreTokenTrigger
# EP3: talentFlowAuthorizer (AI-003) — extend as more AI tasks complete
# ---------------------------------------------------------------------------
ALL_TARGETS=(
  createCandidate
  orchestrateTalentFlowWorkflow
  scheduleInterview
  submitVote
  completeEvaluation
  manageTalentFlowConfig
  sendTalentFlowNotification
  talentFlowPreTokenTrigger
  talentFlowAuthorizer
)

# Lambdas that import from ../shared/config-reader (need patch+bundle)
NEEDS_SHARED=(
  orchestrateTalentFlowWorkflow
  scheduleInterview
  submitVote
  completeEvaluation
  sendTalentFlowNotification
)

needs_shared() {
  local name="$1"
  for s in "${NEEDS_SHARED[@]}"; do [[ "$s" == "$name" ]] && return 0; done
  return 1
}

# Use args if provided, otherwise deploy all
TARGETS=("${@:-${ALL_TARGETS[@]}}")

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
echo "=== TalentFlow EP2 Lambda Deploy ==="
echo "Region:  $REGION"
echo "Targets: ${TARGETS[*]}"
echo ""

aws sts get-caller-identity --query 'Account' --output text > /dev/null \
  || { echo "❌ AWS credentials not configured."; exit 1; }

rm -rf "$BUILD_ROOT" && mkdir -p "$BUILD_ROOT"

DEPLOYED=()
FAILED=()

# ---------------------------------------------------------------------------
# Deploy loop
# ---------------------------------------------------------------------------
for LAMBDA in "${TARGETS[@]}"; do
  SRC="$LAMBDA_DIR/$LAMBDA"
  BUILD="$BUILD_ROOT/$LAMBDA"
  ZIP="$BUILD_ROOT/${LAMBDA}.zip"

  echo "── $LAMBDA ──────────────────────────────────────────────────────────"

  if [[ ! -f "$SRC/index.js" ]]; then
    warn "SKIP $LAMBDA — no index.js found at $SRC"
    continue
  fi

  rm -rf "$BUILD" && mkdir -p "$BUILD"

  # Install prod deps
  echo "   npm ci --omit=dev"
  (cd "$SRC" && npm ci --omit=dev --silent)
  ok "deps ready"

  # Copy source into build dir
  cp "$SRC/index.js"    "$BUILD/"
  cp "$SRC/package.json" "$BUILD/"
  cp -r "$SRC/node_modules" "$BUILD/"

  # Bundle shared module and patch require path if needed
  if needs_shared "$LAMBDA"; then
    echo "   bundling shared/config-reader.js"
    mkdir -p "$BUILD/shared"
    cp "$SHARED_SRC" "$BUILD/shared/config-reader.js"
    # Patch: ../shared/config-reader → ./shared/config-reader
    sed -i '' \
      "s|require('../shared/config-reader')|require('./shared/config-reader')|g" \
      "$BUILD/index.js"
    ok "shared module patched"
  fi

  # Zip
  echo "   zipping → $ZIP"
  (cd "$BUILD" && zip -r "$ZIP" . \
    --exclude "*.test.js" \
    --exclude "*.spec.js" \
    --exclude ".git*" \
    --exclude "node_modules/.bin/*" \
    > /dev/null)
  ok "zipped ($(du -sh "$ZIP" | cut -f1))"

  # Deploy to AWS
  echo "   aws lambda update-function-code → $LAMBDA ($REGION)"
  if OUTPUT=$(aws lambda update-function-code \
      --function-name "$LAMBDA" \
      --zip-file "fileb://$ZIP" \
      --region "$REGION" \
      --architectures arm64 \
      --output json 2>&1); then
    CODE_SIZE=$(echo "$OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['CodeSize'])" 2>/dev/null || echo "?")
    ok "$LAMBDA deployed  (CodeSize: ${CODE_SIZE} bytes)"
    DEPLOYED+=("$LAMBDA")
  else
    fail "FAILED $LAMBDA: $OUTPUT"
    FAILED+=("$LAMBDA")
  fi
  echo ""
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════════════════════════"
echo "SUMMARY"
echo "═══════════════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ Deployed (${#DEPLOYED[@]}): ${DEPLOYED[*]:-none}${NC}"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo -e "${RED}❌ Failed   (${#FAILED[@]}): ${FAILED[*]}${NC}"
  exit 1
fi
echo ""
echo "All TalentFlow EP2 Lambdas deployed successfully."
echo "Next: verify in AWS Console → Lambda → Functions (filter: talentFlow / createCandidate etc.)"
