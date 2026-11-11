/**
 * AI cost guardrail (Iggie's hard rule, 2026-11-11):
 * nothing automated may call Bedrock or Textract and run up a bill.
 *
 * Every paid AI client is wrapped with guardAi(). Unless the Lambda's
 * environment has AI_CALLS_ENABLED set to exactly "true", any .send() on it
 * throws AiDisabledError BEFORE a request leaves the function, so AWS never
 * bills it. The default (variable missing, empty, or anything else) is OFF.
 *
 * Handlers check aiEnabled() first and return a clearly labelled stand-in
 * result, so screens and workflows keep working without the AI.
 */

export const AI_DISABLED_LABEL = 'AI is switched off here (cost guardrail). Nothing was sent to an AI service.';

export class AiDisabledError extends Error {
  constructor(service) {
    super(`AI call to ${service} blocked: AI_CALLS_ENABLED is not "true"`);
    this.name = 'AiDisabledError';
    this.aiDisabled = true;
  }
}

export function aiEnabled() {
  return process.env.AI_CALLS_ENABLED === 'true';
}

/** Wrap an AWS SDK v3 client so send() refuses to run while AI is off. */
export function guardAi(client, service) {
  const realSend = client.send.bind(client);
  client.send = (...args) => {
    if (!aiEnabled()) return Promise.reject(new AiDisabledError(service));
    return realSend(...args);
  };
  return client;
}
