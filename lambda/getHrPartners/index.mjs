import { Logger } from '@aws-lambda-powertools/logger';
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { hrOnly, json, listHrMembers, toPartner } from '../shared/hr-group.mjs';
import { requireTenant } from '../shared/tenant.mjs';
import { inCompany } from '../shared/membership.mjs';

const logger = new Logger({ serviceName: 'getHrPartners' });
const cognito = new CognitoIdentityProviderClient({ region: 'af-south-1' });

/** GET /v1/hr-partners: the HR staff group, as { items: [{ id, name, staffId, email }] }, sorted by name. HR only. */
export const handler = async (event) => {
  const refused = hrOnly(event, 'Only HR can list HR partners');
  if (refused) return refused;
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  try {
    // TEN-02: only the caller's company's HR partners.
    const members = await inCompany(await listHrMembers(cognito, ListUsersInGroupCommand, process.env.COGNITO_POOL_ID), tenantId);
    const items = members.map(toPartner).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en') || a.id.localeCompare(b.id));
    return json(200, { items });
  } catch (error) {
    logger.error('Could not list HR partners', { errorName: error?.name ?? 'Error' });
    return json(500, { error: 'HR partners could not be loaded' });
  }
};
