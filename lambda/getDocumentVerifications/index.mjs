import { DynamoDBClient, ScanCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';

const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'getDocumentVerifications' });

export const handler = async (event) => {
  logger.info('Handler invoked', { path: event.path, httpMethod: event.requestContext?.http?.method });

  try {
    const queryParams = event.queryStringParameters || {};
    const status = queryParams.status;
    const decision = queryParams.decision;
    const employeeId = queryParams.employee_id;
    const limit = parseInt(queryParams.limit || '50');

    // Get staff ID and role from headers for filtering
    const headers = event.headers || {};
    const staffMemberId = headers['x-staff-id'] || headers['X-Staff-Id'] || '';
    const role = headers['x-role'] || headers['X-Role'] || '';
    const isManager = role.toLowerCase() === 'manager';

    logger.info('Query params', { status, decision, employeeId, limit, isManager });

    // For prototype: simple scan (not optimized for production)
    const scanParams = {
      TableName: 'document-verification',
      Limit: limit
    };

    const result = await dynamodb.send(new ScanCommand(scanParams));
    let items = result.Items.map(item => unmarshall(item));

    // Apply filters
    if (status) {
      // Get document IDs with matching status from documents table
      const docsResult = await dynamodb.send(new ScanCommand({
        TableName: 'documents',
        FilterExpression: 'ocr_status = :status',
        ExpressionAttributeValues: {
          ':status': { S: status }
        }
      }));
      
      const matchingDocIds = docsResult.Items.map(item => unmarshall(item).document_id);
      items = items.filter(item => matchingDocIds.includes(item.documentId));
    }

    if (decision) {
      items = items.filter(item => item.decision === decision);
    }

    if (employeeId) {
      items = items.filter(item => item.employeeId === employeeId);
    }

    // Enrich with employee names and HR staff info (join with employees table)
    const enrichedItems = await Promise.all(items.map(async (item) => {
      try {
        const empResult = await dynamodb.send(new QueryCommand({
          TableName: 'employees',
          KeyConditionExpression: 'employee_id = :id',
          ExpressionAttributeValues: {
            ':id': { S: item.employeeId }
          }
        }));

        if (empResult.Items && empResult.Items.length > 0) {
          const employee = unmarshall(empResult.Items[0]);
          return {
            ...item,
            employee_name: `${employee.first_name} ${employee.last_name}`,
            employee_hr_staff_id: employee.hr_staff_id || employee.created_by || '',
          };
        }
        return { ...item, employee_hr_staff_id: '' };
      } catch (err) {
        logger.error('Failed to get employee', { error: err });
        return { ...item, employee_hr_staff_id: '' };
      }
    }));

    // Filter by HR staff — partners only see verifications for their employees
    let filteredItems = enrichedItems;
    if (staffMemberId && !isManager) {
      filteredItems = enrichedItems.filter(
        item => item.employee_hr_staff_id === staffMemberId
      );
      logger.info('Filtered verifications', { staffMemberId, filtered: filteredItems.length, total: enrichedItems.length });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,x-staff-id,x-role',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({
        items: filteredItems.map(item => ({
          verification_id: item.verificationId,
          employee_id: item.employeeId,
          employee_name: item.employee_name || 'Unknown',
          document_type: item.documentType,
          document_id: item.documentId,
          confidence: item.confidence,
          decision: item.decision,
          created_at: item.createdAt
        })),
        count: filteredItems.length
      })
    };

  } catch (error) {
    logger.error('Handler error', { error });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,x-staff-id,x-role',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};