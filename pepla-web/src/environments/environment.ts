// Where pepla-web signs people in. The values below are placeholders that let the app start with no
// backend (the acceptance journey answers Cognito in the browser). Real values are written into this
// file in the CI workspace only, by scripts/ci/dev-frontend-env.sh for pepla-dev. Never commit real ids.
export const environment = {
  production: false,
  // The employees API. The placeholder never resolves; the real address is written by CI for pepla-dev.
  employeesApiUrl: 'https://employees-api.invalid',
  // The document upload API (documents and their checks). Same placeholder rule as above.
  documentUploadApiUrl: 'https://document-api.invalid',
  // The Agent API (Ask Batsi: the chat, what waits for approval). Same placeholder rule as above.
  agentApiUrl: 'https://agent-api.invalid',
  // The TalentFlow API (Hire: roles, candidates, stages). Same placeholder rule as above.
  talentFlowApiUrl: 'https://talent-flow-api.invalid',
  cognito: {
    userPoolId: 'af-south-1_NotConfigured',
    clientId: 'not-configured',
    region: 'af-south-1',
  },
};
