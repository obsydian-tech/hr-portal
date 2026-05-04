import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'getEmployees' });
const tracer = new Tracer({ serviceName: 'getEmployees' });

const handlerFn = async (event) => {
  logger.info('Handler invoked', { path: event.path, httpMethod: event.httpMethod });
  tracer.putAnnotation('operation', 'getEmployees');

  try {
    // 1. Get staff member ID and role from JWT claims (set by Cognito authorizer)
    const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
    const staffMemberId = claims['custom:staff_id'] || claims['sub'] || '';
    const groups = (claims['cognito:groups'] ?? '').toString();
    const isManager = groups.includes('hr_staff');

    if (!staffMemberId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ error: 'Unable to resolve staff identity from token' })
      };
    }

    // 2. Get query parameters (optional filters)
    const queryParams = event.queryStringParameters || {};
    const stage = queryParams.stage;
    const department = queryParams.department;
    const limit = parseInt(queryParams.limit || '100');

    logger.info('Query params', { staffMemberId, stage, department, limit });

    // 3. Scan employees table
    const scanParams = {
      TableName: 'employees',
      Limit: limit
    };

    const result = await dynamodb.send(new ScanCommand(scanParams));
    let items = result.Items.map(item => unmarshall(item));

    logger.info('Total employees in DB', { count: items.length });

    // 4. Filter by staff member (only show employees they created) — unless manager
    if (!isManager) {
      items = items.filter(item => item.created_by === staffMemberId);
    }
    
    logger.info('Employees filtered', { isManager, count: items.length });

    // 5. Apply additional filters if provided
    if (stage) {
      items = items.filter(item => item.stage === stage);
    }

    if (department) {
      items = items.filter(item => item.department === department);
    }

    // 6. Sort by created_at (newest first)
    items.sort((a, b) => {
      const dateA = new Date(a.created_at || 0);
      const dateB = new Date(b.created_at || 0);
      return dateB - dateA;
    });

    // 7. Format response — id_number_encrypted is NEVER returned; expose last 4 only (NH-11)
    const formattedItems = items.map(item => ({
      employee_id: item.employee_id,
      first_name: item.first_name,
      middle_name: item.middle_name || '',
      last_name: item.last_name,
      email: item.email,
      phone: item.phone,
      department: item.department,
      job_title: item.job_title || '',
      stage: item.stage,
      offer_accept_date: item.offer_accept_date || '',
      planned_start_date: item.planned_start_date || '',
      created_at: item.created_at,
      created_by: item.created_by,
      hr_staff_id: item.hr_staff_id || item.created_by || '',
      hr_staff_name: item.hr_staff_name || '',
      hr_staff_email: item.hr_staff_email || '',
      id_number_last4: item.id_number_last4 || '',
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        items: formattedItems,
        count: formattedItems.length,
        staff_id: staffMemberId,
        filters_applied: {
          created_by: staffMemberId,
          stage: stage || 'none',
          department: department || 'none'
        }
      })
    };

  } catch (error) {
    logger.error('Handler error', { error });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ 
        error: error.message,
        details: 'Failed to retrieve employees'
      })
    };
  }
};

export const handler = tracer.captureLambdaHandler(handlerFn);