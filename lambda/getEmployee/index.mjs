/**
 * NH-43: getEmployee — GET /agent/v1/employees/{id}
 *
 * Returns a single employee record (non-PII fields only) for the given ID.
 * Called exclusively via the agent API namespace so the actor is always AGENT,
 * but the code reads it from request context for future extensibility.
 *
 * Audit context:
 *   actor = event.requestContext?.authorizer?.lambda?.actor ?? 'HUMAN'
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { requireTenant, ownsRow, notFound } from '../shared/tenant.mjs';
import { stepOf } from '../shared/onboarding-step.mjs';
import { documentsDueDate } from '../shared/due-date.mjs';

const dynamodb = new DynamoDBClient();
const logger = new Logger({ serviceName: 'getEmployee' });
const tracer = new Tracer({ serviceName: 'getEmployee' });

const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE ?? 'employees';

export const handler = async (event) => {
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return refusal;
  const actor = event.requestContext?.authorizer?.lambda?.actor ?? 'HUMAN';
  const employeeId = event.pathParameters?.id;

  logger.info('getEmployee invoked', { employeeId, actor });
  tracer.putAnnotation('actor', actor);

  if (!employeeId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Missing path parameter: id' }),
    };
  }

  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } },
    }));

    if (!result.Item || !ownsRow({ tenant_id: result.Item.tenant_id?.S }, tenantId)) {
      logger.warn('Employee not found', { employeeId });
      return notFound();
    }

    const item = result.Item;

    // Return non-PII fields safe for agent consumption.
    // Encrypted fields (national_id, etc.) are intentionally omitted.
    const employee = {
      employee_id:  item.employee_id?.S,
      email:        item.email?.S,
      first_name:   item.first_name?.S,
      last_name:    item.last_name?.S,
      department:   item.department?.S,
      stage:        item.stage?.S,
      step:         stepOf({ stage: item.stage?.S, step: item.step?.S }),
      risk_band:    item.riskBand?.S,
      risk_reason:  item.riskReason?.S,
      created_at:   item.created_at?.S,
      updated_at:   item.updated_at?.S,
      // CHAT-09: what the person page shows, from the same row (same names as getEmployees).
      job_title:          item.job_title?.S ?? '',
      step:               stepOf({ step: item.step?.S, stage: item.stage?.S }),
      planned_start_date: item.planned_start_date?.S ?? '',
      documents_due:      documentsDueDate(item.planned_start_date?.S, tenantId) ?? '',
      hr_staff_name:      item.hr_staff_name?.S ?? '',
      risk_assessed_at:   item.riskAssessedAt?.S ?? null,
    };

    tracer.putAnnotation('employeeId', employeeId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ employee }),
    };
  } catch (error) {
    logger.error('Error fetching employee', { errorName: error?.name ?? 'Error', employeeId });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
