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
  talentFlow: {
    // TalentFlow Human REST API (Cognito JWT auth)
    // TODO: Replace with live API Gateway URL after TF-010 (NH-113) endpoint confirmed
    apiUrl: '',
    // TalentFlow Agent API (x-api-key auth)
    // TODO: Replace with live Agent API Gateway URL after TF-010 (NH-113) confirmed
    agentApiUrl: '',
    // TODO (SECURITY): For production, this key must NOT ship in the JS bundle.
    // Serve from a backend config endpoint or Cognito custom claims before go-live.
    // For MVP1 local/dev use only.
    agentApiKey: '',
  },
};
