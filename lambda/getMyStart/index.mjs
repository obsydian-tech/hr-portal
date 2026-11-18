import { Logger } from '@aws-lambda-powertools/logger';
import { isIdToken, json } from '../shared/hr-group.mjs';
import { groupsOf } from '../shared/document-check.mjs';
import { CURRENT_NOTICE_VERSION, renderNotice } from '../shared/privacy-notice.mjs';
import { NEW_EMPLOYEES_ONLY, NOT_FOUND, emailIsVerified, findEmployee, readConsent } from '../shared/consent.mjs';
import { requireTenant } from '../shared/tenant.mjs';
import { documentsDueDate } from '../shared/due-date.mjs';

const logger = new Logger({ serviceName: 'getMyStart' });
const COMPANY = (() => { const v = process.env.COMPANY_NAME; if (!v) throw new Error('Missing setting COMPANY_NAME'); return v; })();

/**
 * GET /v1/me (Cognito JWT). The new employee's own start page: their first name, company, department and start
 * date, the current privacy notice, and whether they have accepted it. Nothing else from their record.
 */
export const handler = async (event) => {
  // The group comes first: nothing is read for anyone who is not an employee.
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !isIdToken(claims) || !groupsOf(claims).includes('employee')) return json(403, { error: NEW_EMPLOYEES_ONLY });
  // TEN-02: the company comes from the token only.
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  // The record is found by the token's email, so the email must be a verified one: nothing is read before this.
  if (!emailIsVerified(claims)) {
    logger.warn('The sign-in email is not verified', { sub: claims.sub });
    return json(404, { error: NOT_FOUND });
  }

  try {
    const found = await findEmployee(claims.email, tenantId);
    if (!found.row) {
      logger.warn('No single employee record for this sign-in', { sub: claims.sub, records: found.count });
      return json(404, { error: NOT_FOUND });
    }
    const e = found.row;
    const consent = await readConsent(e.employee_id.S, CURRENT_NOTICE_VERSION);
    const department = e.department?.S ?? '';
    const startDate = e.planned_start_date?.S ?? '';
    const documentsDue = documentsDueDate(startDate, tenantId) ?? '';
    return json(200, {
      firstName: e.first_name?.S ?? '',
      company: COMPANY,
      ...(department ? { department } : {}),
      ...(startDate ? { startDate } : {}),
      ...(documentsDue ? { documentsDue } : {}),
      notice: renderNotice(CURRENT_NOTICE_VERSION, COMPANY),
      consent,
    });
  } catch (error) {
    logger.error('Could not load the start page', { sub: claims.sub, errorName: error?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
