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
    // IT Provisioning routes live on the TalentFlow API Gateway (pool consolidation).
    // No separate Cognito pool — ITAdmin / ITSpecialist groups are in the TF pool.
    // apiUrl mirrors talentFlow.apiUrl; kept separate for future isolation.
    apiUrl: 'https://57l0w7kk9h.execute-api.af-south-1.amazonaws.com/v1',
  },
  talentFlow: {
    // TalentFlow Human REST API (Cognito JWT auth) — talent-flow-api HTTP API v2
    apiUrl: 'https://57l0w7kk9h.execute-api.af-south-1.amazonaws.com/v1',
    // TalentFlow Agent API (Cognito JWT auth) — naleko-agent-api HTTP API v2 (fou21cj8tj)
    agentApiUrl: 'https://fou21cj8tj.execute-api.af-south-1.amazonaws.com',
    agentApiKey: '', // unused — JWT Bearer auth via AuthService.getIdToken()
    // TEN-06: TalentFlow people sign in to the one pool now (they move at their next sign-in). Same pool and
    // client as `cognito` above; the TalentFlow pool is only read by the migration trigger.
    cognitoConfig: {
      userPoolId: 'af-south-1_2LdAGFnw2',
      clientId: '1pk5rd58glsohfplnlr63tg0qb',
      region: 'af-south-1',
    },
  },
};
