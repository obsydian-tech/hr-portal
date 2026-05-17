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
# EP3: talentFlowAuthorizer (AI-003), talentFlowApproveAction (AI-004)  talentFlowAuthorizer
  talentFlowApproveAction
)