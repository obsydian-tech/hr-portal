// Where pepla-web signs people in. The values below are placeholders that let the app start with no
// backend (the acceptance journey answers Cognito in the browser). Real values are written into this
// file in the CI workspace only, by scripts/ci/dev-frontend-env.sh for pepla-dev. Never commit real ids.
export const environment = {
  production: false,
  cognito: {
    userPoolId: 'af-south-1_NotConfigured',
    clientId: 'not-configured',
    region: 'af-south-1',
  },
};
