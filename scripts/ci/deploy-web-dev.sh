#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Copies the built web app to its pepla-dev bucket and clears the cache (OPS-01).
#
#   scripts/ci/deploy-web-dev.sh [build folder]    default pepla-web/dist/pepla-web/browser
#
# Files are copied in three passes, so a page never points at a file that is
# not there yet:
#   1. hashed scripts and styles (name changes when content changes): cached a year
#   2. everything else that is not a page (site.css, icon, media): "no-cache"
#   3. the pages (index.html, index.csr.html, <route>/index.html): "no-cache", last
# Nothing is deleted: older hashed files stay, so a page opened before this
# deploy keeps working. (A cleanup of very old files is a later, separate step.)
#
# Then it clears CloudFront's copies and waits until that is done, so the tests
# that follow read the new files. Refuses to run outside pepla-dev. Prints no
# address and no file names.
# ---------------------------------------------------------------------------
set -euo pipefail

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
[ "$ACCOUNT" = "424556617428" ] || { echo "::error::deploy-web-dev only runs in pepla-dev" >&2; exit 1; }

BUILD="${1:-pepla-web/dist/pepla-web/browser}"
BUCKET="naleko-people-dev-web-${ACCOUNT}"
[ -f "$BUILD/index.html" ] && [ -f "$BUILD/index.csr.html" ] \
  || { echo "::error::$BUILD has no index.html and index.csr.html: the build did not run, or its output moved" >&2; exit 1; }

DIST=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='naleko-people-dev-web'].Id | [0]" --output text)
if [ -z "$DIST" ] || [ "$DIST" = "None" ]; then
  echo "::error::no web distribution named naleko-people-dev-web in pepla-dev (has Terraform applied infra/web-dev.tf?)" >&2
  exit 1
fi

aws s3 sync "$BUILD" "s3://${BUCKET}" --only-show-errors \
  --exclude "*" --include "*.js" --include "styles-*.css" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 sync "$BUILD" "s3://${BUCKET}" --only-show-errors \
  --exclude "*.js" --exclude "styles-*.css" --exclude "*.html" \
  --cache-control "no-cache"

aws s3 sync "$BUILD" "s3://${BUCKET}" --only-show-errors \
  --exclude "*" --include "*.html" \
  --cache-control "no-cache"

INV=$(aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DIST" --id "$INV"
echo "deploy-web-dev: build copied to the pepla-dev web bucket and the cache cleared"
