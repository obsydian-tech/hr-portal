import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { answer, bodyOf, readInvite } from '../shared/invite.mjs';
import { ownsItem, legacyCompany } from '../shared/tenant.mjs';

const logger = new Logger({ serviceName: 'lookupInvite' });
const ddb = new DynamoDBClient();
const COMPANY = (() => { const v = process.env.COMPANY_NAME; if (!v) throw new Error('Missing setting COMPANY_NAME'); return v; })();

/** POST /v1/invites/lookup  public. */
export const handler = async (event) => {
  const body = bodyOf(event);
  if (!body) return answer(400, { error: 'The request body is missing or not valid' });
  try {
    const found = await readInvite(body.token);
    if (found.status === 'invalid') return answer(200, { status: 'invalid' });
    const e = (await ddb.send(new GetItemCommand({
      TableName: 'employees', Key: { employee_id: found.row.employee_id },
      ProjectionExpression: 'email, first_name, planned_start_date, hr_staff_name, tenant_id',
    }))).Item ?? {};
    // TEN-02: the company is the invite's; a person of another company is never shown.
    if (Object.keys(e).length && !ownsItem(e, found.row.tenant_id?.S ?? legacyCompany())) return answer(200, { status: 'invalid' });
    const hrPartnerName = e.hr_staff_name?.S ?? '';
    if (found.status !== 'ok') return answer(200, { status: found.status, company: COMPANY, hrPartnerName });
    return answer(200, { status: 'ok', company: COMPANY, firstName: e.first_name?.S ?? '', email: e.email?.S ?? '', startDate: e.planned_start_date?.S ?? '', hrPartnerName });
  } catch (error) {
    logger.error('Invite lookup failed', { errorName: error?.name ?? 'Error' });
    return answer(500, { error: 'Something went wrong' });
  }
};
