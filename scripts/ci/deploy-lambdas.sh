#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy the zips built by scripts/ci/build-lambdas.py to the AWS account the
# current credentials belong to (pepla-dev or prod, chosen by the CI role).
#
# * Deploys a zip only when a function with the same name exists there, so
#   the account boundary decides what goes where; unmatched folders are listed.
# * Skips a function whose live CodeSha256 already equals the zip's, so a
#   re-run changes nothing.
# * Code only: Terraform owns configuration (env vars, roles, memory).
#
# Output is names and counts only: the repo and its Actions logs are public.
# Usage: deploy-lambdas.sh dist/lambdas
# ---------------------------------------------------------------------------
set -euo pipefail

DIR="${1:?usage: deploy-lambdas.sh <dist dir>}"
REGION="${AWS_REGION:-af-south-1}"
MANIFEST="$DIR/manifest.json"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

live=$(aws lambda list-functions --region "$REGION" \
        --query 'Functions[].[FunctionName,CodeSha256]' --output text)

deployed=() ; unchanged=() ; missing=() ; failed=()

for name in $(jq -r 'keys[]' "$MANIFEST"); do
  want=$(jq -r --arg n "$name" '.[$n]' "$MANIFEST")
  have=$(awk -v n="$name" '$1==n {print $2}' <<<"$live")
  if [[ -z "$have" ]]; then missing+=("$name"); continue; fi
  if [[ "$have" == "$want" ]]; then unchanged+=("$name"); continue; fi

  if aws lambda update-function-code --region "$REGION" --function-name "$name" \
       --zip-file "fileb://$DIR/$name.zip" --query 'CodeSha256' --output text >/dev/null \
     && aws lambda wait function-updated-v2 --region "$REGION" --function-name "$name"; then
    deployed+=("$name"); echo "deployed $name"
  else
    failed+=("$name"); echo "::error::deploy failed for $name"
  fi
done

{
  echo "### Lambda code deploy"
  echo "- deployed: ${#deployed[@]}"
  echo "- unchanged: ${#unchanged[@]}"
  echo "- no function with that name here: ${#missing[@]}"
  echo "- failed: ${#failed[@]}"
  if ((${#deployed[@]})); then echo; echo "Deployed: ${deployed[*]}"; fi
  if ((${#missing[@]})); then echo; echo "Not deployed (no matching function): ${missing[*]}"; fi
  if ((${#failed[@]})); then echo; echo "Failed: ${failed[*]}"; fi
} >> "$SUMMARY"

((${#failed[@]} == 0))
