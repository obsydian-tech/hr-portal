import { DynamoDBClient, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import postmark from "postmark";
import { Logger } from '@aws-lambda-powertools/logger';

const dynamodb = new DynamoDBClient();
const cognito = new CognitoIdentityProviderClient({ region: "af-south-1" });

const logger = new Logger({ serviceName: 'createEmployee' });

const USER_POOL_ID = "af-south-1_2LdAGFnw2";
const LOGIN_URL = "https://hr-portal-beryl-three.vercel.app/login";

// Postmark client — initialised lazily so Lambda doesn't crash if env var is missing
let mailClient = null;
function getMailClient() {
  if (!mailClient && process.env.POSTMARK_API_TOKEN) {
    mailClient = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
  }
  return mailClient;
}

export const handler = async (event) => {
  logger.info('Handler invoked', { path: event.path, httpMethod: event.httpMethod });

  try {
    // 1. Get staff member ID from headers
    const headers = event.headers || {};
    const staffMemberId = headers['x-staff-id'] || headers['X-Staff-Id'];

    if (!staffMemberId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: 'Missing staff member ID',
          message: 'x-staff-id header is required'
        })
      };
    }

    // 2. Parse request body
    const body = JSON.parse(event.body);
    
    // Validate required fields
    const requiredFields = ['first_name', 'last_name', 'email', 'phone', 'department'];
    const missingFields = requiredFields.filter(field => !body[field]);
    
    if (missingFields.length > 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          error: 'Missing required fields',
          missing: missingFields
        })
      };
    }

    // 3. Generate unique employee ID
    const employeeId = await generateEmployeeId();

    // 4. Prepare employee record
    const timestamp = new Date().toISOString();
    const employee = {
      employee_id: { S: employeeId },
      first_name: { S: body.first_name },
      middle_name: { S: body.middle_name || '' },
      last_name: { S: body.last_name },
      email: { S: body.email },
      phone: { S: body.phone },
      department: { S: body.department },
      job_title: { S: body.job_title || '' },
      stage: { S: 'INVITED' }, // Always start at INVITED
      offer_accept_date: { S: body.offer_accept_date || '' },
      planned_start_date: { S: body.planned_start_date || '' },
      created_at: { S: timestamp },
      created_by: { S: staffMemberId }, // Track who created this employee
      hr_staff_id: { S: body.hr_staff_id || staffMemberId },
      hr_staff_name: { S: body.hr_staff_name || '' },
      hr_staff_email: { S: body.hr_staff_email || '' },
    };

    // 5. Save to DynamoDB
    await dynamodb.send(
      new PutItemCommand({
        TableName: 'employees',
        Item: employee
      })
    );

    logger.info('Employee created', { employeeId, staffMemberId });

    // 6. Create Cognito user for the new employee
    let cognitoUserCreated = false;
    let tempPassword = null;
    try {
      // Generate a temporary password: Naleko + last 4 of employee ID + !Emp
      const empNum = employeeId.replace('EMP-', '');
      tempPassword = `Naleko${empNum}!Emp`;

      // Create the Cognito user with employee attributes
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: body.email,
          UserAttributes: [
            { Name: "email", Value: body.email },
            { Name: "email_verified", Value: "true" },
            { Name: "given_name", Value: body.first_name },
            { Name: "family_name", Value: body.last_name },
            { Name: "custom:employee_id", Value: employeeId },
            { Name: "custom:role", Value: "employee" },
            { Name: "custom:staff_id", Value: "" },
          ],
          MessageAction: "SUPPRESS", // Don't send welcome email (fictional emails)
        })
      );

      // Set a permanent password (skip FORCE_CHANGE_PASSWORD state)
      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID,
          Username: body.email,
          Password: tempPassword,
          Permanent: true,
        })
      );

      // Add user to the 'employee' group
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: body.email,
          GroupName: "employee",
        })
      );

      cognitoUserCreated = true;
      logger.info('Cognito user created', { employeeId });
    } catch (cognitoError) {
      // Log but don't fail the entire request — employee is already in DynamoDB
      logger.error('Failed to create Cognito user', { employeeId, error: cognitoError });
    }

    // 7. Send branded welcome email via Postmark
    let emailSent = false;
    if (cognitoUserCreated && tempPassword) {
      try {
        const client = getMailClient();
        if (client) {
          const htmlBody = buildWelcomeEmail({
            firstName: body.first_name,
            lastName: body.last_name,
            employeeId,
            email: body.email,
            password: tempPassword,
            department: body.department,
            startDate: body.planned_start_date || 'TBD',
          });

          await client.sendEmail({
            From: process.env.POSTMARK_SENDER_EMAIL || "noreply@naleko.co.za",
            To: body.email,
            Subject: `Welcome to Naleko — Your Employee Portal Access`,
            HtmlBody: htmlBody,
            TextBody: buildPlainTextEmail({
              firstName: body.first_name,
              employeeId,
              email: body.email,
              password: tempPassword,
            }),
            MessageStream: "outbound",
          });

          emailSent = true;
          logger.info('Welcome email sent', { employeeId });
        } else {
          logger.warn('Postmark not configured — POSTMARK_API_TOKEN env var missing. Skipping email.');
        }
      } catch (emailError) {
        logger.error('Failed to send welcome email', { employeeId, error: emailError });
      }
    }

    // 8. Return created employee (unmarshall for clean JSON)
    const createdEmployee = Object.keys(employee).reduce((acc, key) => {
      const value = employee[key];
      acc[key] = value.S || value.N || value.BOOL || null;
      return acc;
    }, {});

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'Employee created successfully',
        employee: createdEmployee,
        cognito: {
          userCreated: cognitoUserCreated,
          tempPassword: cognitoUserCreated ? tempPassword : null,
        },
        email: {
          sent: emailSent,
        }
      })
    };

  } catch (error) {
    logger.error('Handler error', { error });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: error.message,
        details: 'Failed to create employee'
      })
    };
  }
};

/**
 * Build branded HTML welcome email
 */
function buildWelcomeEmail({ firstName, lastName, employeeId, email, password, department, startDate }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Naleko</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">

          <!-- Header with gradient -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#2a1a4e 60%,#4a3f8a 100%);border-radius:16px 16px 0 0;padding:40px 40px 32px;text-align:center;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding-bottom:20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="background:rgba(122,212,228,0.15);border-radius:12px;padding:12px 20px;">
                          <span style="color:#7ad4e4;font-size:24px;font-weight:700;letter-spacing:0.02em;">&#9670; HR Portal</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin:0 0 8px;color:#ffffff;font-size:28px;font-weight:700;line-height:1.3;">
                      Welcome to Naleko, ${firstName}!
                    </h1>
                    <p style="margin:0;color:#b7acff;font-size:16px;line-height:1.5;">
                      Your employee account has been set up and is ready to go.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;">

              <!-- Greeting -->
              <p style="margin:0 0 20px;color:#1a1a2e;font-size:16px;line-height:1.6;">
                Hi <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#47464c;font-size:15px;line-height:1.6;">
                We're excited to have you join the team${department ? ' in <strong>' + department + '</strong>' : ''}!
                Your HR portal account has been created, and you can now log in to begin your onboarding process.
              </p>

              <!-- Credentials Card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:12px;padding:24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-bottom:16px;border-bottom:1px solid #e9ecef;">
                          <span style="color:#4a3f8a;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">
                            Your Login Credentials
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top:16px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr>
                              <td style="padding:8px 0;">
                                <span style="color:#78767d;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Employee ID</span><br/>
                                <span style="color:#1a1a2e;font-size:18px;font-weight:700;font-family:'Courier New',monospace;letter-spacing:0.06em;">${employeeId}</span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:8px 0;">
                                <span style="color:#78767d;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Email</span><br/>
                                <span style="color:#1a1a2e;font-size:16px;font-weight:600;">${email}</span>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:8px 0;">
                                <span style="color:#78767d;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Password</span><br/>
                                <span style="color:#1a1a2e;font-size:18px;font-weight:700;font-family:'Courier New',monospace;background:#fff3cd;padding:2px 8px;border-radius:4px;">${password}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Tip -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#f0f7ff;border-left:4px solid #4a3f8a;border-radius:0 8px 8px 0;padding:14px 18px;">
                    <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.5;">
                      <strong>Tip:</strong> You can log in using either your <strong>Employee ID</strong> (${employeeId}) or your <strong>email address</strong>.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="${LOGIN_URL}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#1a1a2e,#4a3f8a);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:10px;letter-spacing:0.02em;">
                      Log In to HR Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              ${startDate && startDate !== 'TBD' ? `
              <!-- Start Date -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:linear-gradient(135deg,rgba(122,212,228,0.1),rgba(74,63,138,0.08));border-radius:12px;padding:18px 24px;text-align:center;">
                    <span style="color:#78767d;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Planned Start Date</span><br/>
                    <span style="color:#1a1a2e;font-size:20px;font-weight:700;">${startDate}</span>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- What's Next -->
              <h3 style="margin:0 0 16px;color:#1a1a2e;font-size:16px;font-weight:700;">What to do next</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:8px 0;color:#47464c;font-size:14px;line-height:1.5;">
                    <span style="display:inline-block;width:28px;height:28px;background:#4a3f8a;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;margin-right:12px;vertical-align:middle;">1</span>
                    <span style="vertical-align:middle;">Log in with your credentials above</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#47464c;font-size:14px;line-height:1.5;">
                    <span style="display:inline-block;width:28px;height:28px;background:#4a3f8a;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;margin-right:12px;vertical-align:middle;">2</span>
                    <span style="vertical-align:middle;">Upload your required documents (SA ID, bank confirmation, qualifications)</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#47464c;font-size:14px;line-height:1.5;">
                    <span style="display:inline-block;width:28px;height:28px;background:#4a3f8a;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-size:13px;font-weight:700;margin-right:12px;vertical-align:middle;">3</span>
                    <span style="vertical-align:middle;">Our team will verify your documents — you'll see progress in real time</span>
                  </td>
                </tr>
              </table>

              <!-- Security note -->
              <p style="margin:0;color:#78767d;font-size:13px;line-height:1.5;border-top:1px solid #e9ecef;padding-top:20px;">
                &#128274; For security, do not share your password with anyone. If you have any questions, contact your HR representative.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#1a1a2e;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 8px;color:#7ad4e4;font-size:14px;font-weight:600;">
                Naleko HR Portal
              </p>
              <p style="margin:0;color:#78767d;font-size:12px;line-height:1.5;">
                This is an automated message. Please do not reply to this email.<br/>
                &copy; ${new Date().getFullYear()} Naleko. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Plain-text fallback for email clients that don't support HTML
 */
function buildPlainTextEmail({ firstName, employeeId, email, password }) {
  return `Welcome to Naleko, ${firstName}!

Your employee account has been created and is ready to go.

YOUR LOGIN CREDENTIALS
━━━━━━━━━━━━━━━━━━━━━
Employee ID: ${employeeId}
Email:       ${email}
Password:    ${password}

Tip: You can log in using either your Employee ID or your email address.

LOG IN HERE: ${LOGIN_URL}

WHAT TO DO NEXT
1. Log in with your credentials above
2. Upload your required documents (SA ID, bank confirmation, qualifications)
3. Our team will verify your documents — you'll see progress in real time

For security, do not share your password with anyone.
If you have questions, contact your HR representative.

— Naleko HR Portal
`;
}

/**
 * Generate next sequential employee ID
 * Format: EMP-0000001, EMP-0000002, etc.
 */
async function generateEmployeeId() {
  try {
    // Get all existing employee IDs
    const result = await dynamodb.send(
      new ScanCommand({
        TableName: 'employees',
        ProjectionExpression: 'employee_id'
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return 'EMP-0000001'; // First employee
    }

    // Extract numeric parts and find max
    const ids = result.Items.map(item => {
      const employeeId = unmarshall(item).employee_id;
      const numericPart = parseInt(employeeId.replace('EMP-', ''));
      return numericPart;
    });

    const maxId = Math.max(...ids);
    const nextId = maxId + 1;

    // Pad with zeros (7 digits total)
    return `EMP-${String(nextId).padStart(7, '0')}`;

  } catch (error) {
    logger.error('Error generating employee ID', { error });
    // Fallback to timestamp-based ID if scan fails
    return `EMP-${Date.now()}`;
  }
}
