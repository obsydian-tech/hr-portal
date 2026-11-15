import { Logger } from '@aws-lambda-powertools/logger';
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { hrOnly, json, listHrMembers, toPartner } from '../shared/hr-group.mjs';

const logger = new Logger({ serviceName: 'getHrPartners' });
const cognito = new CognitoIdentityProviderClient({ region: 'af-south-1' });

/** GET /v1/hr-partners: the HR staff group, as { items: [{ id, name, staffId, email }] }, sorted by name. HR only. */
export const handler = async (event) => {
  const refused = hrOnly(event, 'Only HR can list HR partners');
  if (refused) return refused;
  try {
    const members = await listHrMembers(cognito, ListUsersInGroupCommand, process.env.COGNITO_POOL_ID);
    const items = members.map(toPartner).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en') || a.id.localeCompare(b.id));
    return json(200, { items });
  } catch (error) {
    logger.error('Could not list HR partners', { error: error.message });
    return json(500, { error: 'HR partners could not be loaded' });
  }
};
