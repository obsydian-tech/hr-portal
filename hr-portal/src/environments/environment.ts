export const environment = {
  production: false,
  documentUploadApiUrl: 'https://b2wt303fc8.execute-api.af-south-1.amazonaws.com',
  employeesApiUrl: 'https://ndksa9ec0k.execute-api.af-south-1.amazonaws.com',
  agentApiUrl: 'https://fou21cj8tj.execute-api.af-south-1.amazonaws.com',
  cognito: {
    userPoolId: 'af-south-1_2LdAGFnw2',
    clientId: '1pk5rd58glsohfplnlr63tg0qb',
    region: 'af-south-1',
  },
  itProvisioning: {
    // IT Provisioning Cognito User Pool — separate pool, mirrors TalentFlow pattern
    // Fill userPoolId/clientId once Terraform provisions `it-provisioning-user-pool`
    cognitoConfig: {
      userPoolId: 'PLACEHOLDER_IT_POOL_ID',
      clientId: 'PLACEHOLDER_IT_CLIENT_ID',
      region: 'af-south-1',
    },
    apiUrl: '', // set when IT Provisioning API is deployed
  },
  talentFlow: {
    // TalentFlow Human REST API (Cognito JWT auth) — talent-flow-api HTTP API v2
    apiUrl: 'https://57l0w7kk9h.execute-api.af-south-1.amazonaws.com/v1',
    // Single-tenant MVP. Replace with a per-user claim or config endpoint before multi-tenant go-live.
    tenantId: 'NALEKO',
    // TalentFlow Agent API (Cognito JWT auth) — naleko-agent-api HTTP API v2 (fou21cj8tj)
    agentApiUrl: 'https://fou21cj8tj.execute-api.af-south-1.amazonaws.com',
    agentApiKey: '', // unused — JWT Bearer auth via AuthService.getIdToken()
    // TalentFlow Cognito User Pool (TF pool, NOT Naleko pool - Lesson 18)
    cognitoConfig: {
      userPoolId: 'af-south-1_C8TTlQxY7',
      clientId: '74644m5eck56vvq4fp7nfm8dht',
      region: 'af-south-1',
    },
  },
};
