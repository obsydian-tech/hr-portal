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
  talentFlow: {
    apiUrl: '',
    agentApiUrl: '',
    agentApiKey: '',
    // TalentFlow Cognito User Pool (TF pool, NOT Naleko pool - Lesson 18)
    cognitoConfig: {
      userPoolId: 'af-south-1_C8TTlQxY7',
      clientId: '74644m5eck56vvq4fp7nfm8dht',
      region: 'af-south-1',
    },
  },
};
