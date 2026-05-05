// NH-50: nalekoAiChat Lambda — scaffold handler.
// Full Bedrock InvokeModel + tool resolution implemented in NH-54.
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'nalekoAiChat' });

export const handler = async (event) => {
  logger.info('nalekoAiChat invoked', {
    method: event.requestContext?.http?.method,
    path:   event.requestContext?.http?.path,
  });

  // NH-54 will replace this stub with the full Bedrock + tool-resolution pipeline.
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok', message: 'AI Mode Lambda live — NH-54 pending' }),
  };
};
