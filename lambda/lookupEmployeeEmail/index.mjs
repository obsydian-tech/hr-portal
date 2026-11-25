import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'lookupEmployeeEmail' });

/**
 * lookupEmployeeEmail
 * -------------------
 * NH-261: this route is kept only until prod's old portal is replaced. It gives nothing to anyone. Every call, whatever
 * the query, the headers or the caller, gets the same fixed "Not found" answer. The Lambda reads no table, makes no AWS
 * call, never looks at the event, and writes no employee id, query, header or error text to the log.
 * The route and this Lambda are removed in NH-261 step B.
 */
const NOT_FOUND = {
  statusCode: 404,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: 'Not found' }),
};

export const handler = async () => {
  try {
    logger.info('lookup refused');
  } catch (error) {
    try {
      logger.error('lookup failed', { errorName: error?.name });
    } catch {
      // nothing left to say; the answer stays the same
    }
  }
  return { ...NOT_FOUND, headers: { ...NOT_FOUND.headers } };
};
