#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Point the Angular app at pepla-dev for the E2E run.
#
# Looks up pepla-dev's sign-in pools, app clients and APIs by name and writes
# hr-portal/src/environments/environment.ts (the current app) and
# pepla-web/src/environments/environment.ts (the new app) in the CI workspace
# only (never committed). Both sign in to the Naleko pool through the
# pepla-web-dev app client. Refuses to run outside pepla-dev.
# ---------------------------------------------------------------------------
set -euo pipefail

REGION="${AWS_REGION:-af-south-1}"
[ "$(aws sts get-caller-identity --query Account --output text)" = "424556617428" ] \
  || { echo "::error::dev-frontend-env only runs in pepla-dev"; exit 1; }

pool() { aws cognito-idp list-user-pools --region "$REGION" --max-results 60 \
           --query "UserPools[?Name=='$1'].Id | [0]" --output text; }
client() { aws cognito-idp list-user-pool-clients --region "$REGION" --user-pool-id "$1" \
             --query "UserPoolClients[?ClientName=='$2'].ClientId | [0]" --output text; }
api() { aws apigatewayv2 get-apis --region "$REGION" \
          --query "Items[?Name=='$1'].ApiEndpoint | [0]" --output text; }

NALEKO_POOL=$(pool naleko-dev-user-pool)
NALEKO_CLIENT=$(client "$NALEKO_POOL" pepla-web-dev)
TF_POOL=$(pool talent-flow-user-pool)
TF_CLIENT=$(client "$TF_POOL" talent-flow-web-client)
EMP_API=$(api employees)
DOC_API=$(api document-upload-api)
AGENT_API=$(api naleko-agent-api)
TF_API=$(api talent-flow-api)

for v in NALEKO_POOL NALEKO_CLIENT TF_POOL TF_CLIENT EMP_API DOC_API AGENT_API TF_API; do
  [ -n "${!v}" ] && [ "${!v}" != "None" ] || { echo "::error::$v not found in pepla-dev"; exit 1; }
done

cat > hr-portal/src/environments/environment.ts <<TS
// Generated in CI by scripts/ci/dev-frontend-env.sh for the pepla-dev E2E run.
export const environment = {
  production: false,
  documentUploadApiUrl: '${DOC_API}',
  employeesApiUrl: '${EMP_API}',
  agentApiUrl: '${AGENT_API}',
  cognito: { userPoolId: '${NALEKO_POOL}', clientId: '${NALEKO_CLIENT}', region: '${REGION}' },
  itProvisioning: { apiUrl: '${TF_API}/v1' },
  talentFlow: {
    apiUrl: '${TF_API}/v1',
    tenantId: 'NALEKO',
    agentApiUrl: '${AGENT_API}',
    agentApiKey: '',
    cognitoConfig: { userPoolId: '${TF_POOL}', clientId: '${TF_CLIENT}', region: '${REGION}' },
  },
};
TS
cat > pepla-web/src/environments/environment.ts <<TS
// Generated in CI by scripts/ci/dev-frontend-env.sh for the pepla-dev E2E run.
export const environment = {
  production: false,
  employeesApiUrl: '${EMP_API}',
  cognito: { userPoolId: '${NALEKO_POOL}', clientId: '${NALEKO_CLIENT}', region: '${REGION}' },
};
TS
echo "dev-frontend-env: environment.ts now points at pepla-dev (hr-portal and pepla-web)"
