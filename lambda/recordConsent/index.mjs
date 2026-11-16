import { Logger } from '@aws-lambda-powertools/logger';
import { json } from '../shared/hr-group.mjs';
import { groupsOf } from '../shared/document-check.mjs';
import { CURRENT_NOTICE_VERSION, noticeHash, renderNotice } from '../shared/privacy-notice.mjs';
import { NEW_EMPLOYEES_ONLY, NOT_FOUND, addConsent, findEmployee } from '../shared/consent.mjs';

const logger = new Logger({ serviceName: 'recordConsent' });
const COMPANY = (() => { const v = process.env.COMPANY_NAME; if (!v) throw new Error('Missing setting COMPANY_NAME'); return v; })();

/** The version the person sent, or null when the body is missing, not a JSON object, or has no version text. */
function versionOf(event) {
  if (!event?.body) return null;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const b = JSON.parse(raw);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    return typeof b.version === 'string' && b.version !== '' ? b.version : null;
  } catch {
    return null;
  }
}

/**
 * POST /v1/me/consent (Cognito JWT) { version }. Records that the signed-in employee accepted the current
 * notice. There is no employee id in the path or body: the person is found by the token's email, so nobody can
 * record consent for someone else. The row is added once and never changed.
 */
export const handler = async (event) => {
  // The group comes first: nothing is read or written for anyone who is not an employee.
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !groupsOf(claims).includes('employee')) return json(403, { error: NEW_EMPLOYEES_ONLY });

  const version = versionOf(event);
  if (!version) return json(400, { error: 'Send the notice version' });

  try {
    const found = await findEmployee(claims.email);
    if (!found.row) {
      logger.warn('No single employee record for this sign-in', { sub: claims.sub, records: found.count });
      return json(404, { error: NOT_FOUND });
    }
    if (version !== CURRENT_NOTICE_VERSION) {
      return json(409, { error: 'The notice has changed. Read it again.', version: CURRENT_NOTICE_VERSION });
    }
    const saved = await addConsent({
      employeeId: found.row.employee_id.S,
      version,
      acceptedAt: new Date().toISOString(),
      sub: String(claims.sub ?? ''),
      hash: noticeHash(renderNotice(version, COMPANY)),
    });
    return json(saved.created ? 201 : 200, { version, acceptedAt: saved.acceptedAt });
  } catch (error) {
    logger.error('Could not record consent', { sub: claims.sub, error: error.message });
    return json(500, { error: 'Something went wrong' });
  }
};
