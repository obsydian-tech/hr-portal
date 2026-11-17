#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Prints the address of the Naleko People web app on pepla-dev (OPS-01), for
# example https://d111111abcdef8.cloudfront.net, or fails if it does not exist.
#
# Looks the distribution up by its comment, so nothing is stored in the repo
# and nothing needs the Terraform state. Refuses to run outside pepla-dev.
# The address is public by design but not a secret; callers still keep it out
# of logs where they can (add-mask).
# ---------------------------------------------------------------------------
set -euo pipefail

[ "$(aws sts get-caller-identity --query Account --output text)" = "424556617428" ] \
  || { echo "::error::dev-web-address only runs in pepla-dev" >&2; exit 1; }

domain=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='naleko-people-dev-web'].DomainName | [0]" --output text)
if [ -z "$domain" ] || [ "$domain" = "None" ]; then
  echo "::error::no web distribution named naleko-people-dev-web in pepla-dev (has Terraform applied infra/web-dev.tf?)" >&2
  exit 1
fi
echo "https://${domain}"
