// ONB-24 (THROWAWAY, not committed): after a password reset, sign the person out everywhere.
import { CognitoIdentityProviderClient, AdminUserGlobalSignOutCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'cognitoPostConfirmation' });
const metrics = new Metrics({ namespace: 'Naleko', serviceName: 'cognitoPostConfirmation' });
const cognito = new CognitoIdentityProviderClient({});

export const handler = async (event) => {
  if (event.triggerSource !== 'PostConfirmation_ConfirmForgotPassword') return event;
  const sub = event.request?.userAttributes?.sub;
  try {
    await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: event.userPoolId, Username: event.userName }));
    logger.info('Signed out everywhere after a reset', { sub });
  } catch (e) {
    logger.error('Reset sign-out failed', { sub, error: e?.name ?? 'Error' });
    metrics.addMetric('ResetSignOutFailed', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
  }
  return event;
};
