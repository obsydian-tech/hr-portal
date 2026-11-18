export const environment = {
  production: true,
  documentUploadApiUrl: 'https://b2wt303fc8.execute-api.af-south-1.amazonaws.com',
  employeesApiUrl: 'https://ndksa9ec0k.execute-api.af-south-1.amazonaws.com',
  agentApiUrl: 'https://fou21cj8tj.execute-api.af-south-1.amazonaws.com',
  cognito: {
    userPoolId: 'af-south-1_2LdAGFnw2',
    clientId: '1pk5rd58glsohfplnlr63tg0qb',
    region: 'af-south-1',
  },
  itProvisioning: {
    // Fill once Terraform provisions `it-provisioning-user-pool`
    cognitoConfig: {
      userPoolId: 'PLACEHOLDER_IT_POOL_ID',
      clientId: 'PLACEHOLDER_IT_CLIENT_ID',
      region: 'af-south-1',
    },
    apiUrl: '',
  },
  talentFlow: {
    apiUrl: 'https://57l0w7kk9h.execute-api.af-south-1.amazonaws.com/v1',
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
