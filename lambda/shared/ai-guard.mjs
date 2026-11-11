/**
 * AI cost guardrail (Iggie's hard rule, 2026-11-11):
 * robots never use paid AI. People do, in dev and in prod.
 *
 * A "robot" is anything automated: Playwright tests, CI jobs, agents using
 * test logins, and any record those robots create. They are recognised by:
 *   - the Cognito group "e2e-robots" (every test login is in it), or
 *   - an email on the test-only domain blackhole.postmarkapp.com, which no
 *     real person uses (every test login and every test record has one).
 *
 * For a robot, the AI functions return a clearly labelled stand-in and never
 * call Bedrock or Textract, so a test run costs nothing.
 *
 * guardAi() is a second lock: every paid AI client is wrapped, and its send()
 * refuses to run while the request is marked as a robot (markRobot) or while
 * the Lambda has AI_CALLS_ENABLED set to "false" (an emergency off switch).
 * People are not affected: AI stays on unless that switch says "false".
 */

export const ROBOT_GROUP = 'e2e-robots';
export const ROBOT_EMAIL_DOMAIN = '@blackhole.postmarkapp.com';
export const AI_SKIPPED_LABEL = 'AI skipped: this is test data (cost guardrail). Nothing was sent to an AI service.';
export const AI_OFF_LABEL = 'AI is switched off here (cost guardrail). Nothing was sent to an AI service.';

export class AiBlockedError extends Error {
  constructor(service, reason) {
    super(`AI call to ${service} blocked: ${reason}`);
    this.name = 'AiBlockedError';
    this.aiBlocked = true;
    this.label = reason === 'robot' ? AI_SKIPPED_LABEL : AI_OFF_LABEL;
  }
}

/** Emergency off switch, per Lambda. Only the exact value "false" turns AI off. */
export function aiSwitchedOff() {
  return process.env.AI_CALLS_ENABLED === 'false';
}

export function isRobotEmail(email) {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(ROBOT_EMAIL_DOMAIN);
}

/** True when JWT claims belong to a test login (group or test-only email). */
export function isRobotCaller(claims = {}) {
  let groups = claims['cognito:groups'] ?? [];
  if (typeof groups === 'string') {
    // HTTP API JWT authorizers pass arrays as "[a b c]"
    groups = groups.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  }
  if (groups.includes(ROBOT_GROUP)) return true;
  return [claims.email, claims.username, claims['cognito:username']].some(isRobotEmail);
}

// Per-invocation robot flag. Lambda runs one request at a time per
// container, so a module-level flag is safe; handlers reset it on entry.
let robotRequest = false;
export function markRobot(isRobot) { robotRequest = !!isRobot; }

/** Wrap an AWS SDK v3 client so send() refuses while AI is blocked. */
export function guardAi(client, service) {
  const realSend = client.send.bind(client);
  client.send = (...args) => {
    if (robotRequest) return Promise.reject(new AiBlockedError(service, 'robot'));
    if (aiSwitchedOff()) return Promise.reject(new AiBlockedError(service, 'AI_CALLS_ENABLED is "false"'));
    return realSend(...args);
  };
  return client;
}
