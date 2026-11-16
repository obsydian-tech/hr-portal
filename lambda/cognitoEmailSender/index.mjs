// ONB-24 (THROWAWAY, not committed): Cognito custom email sender. Sends the forgot-password code by Postmark.
import { KmsKeyringNode, buildClient, CommitmentPolicy } from '@aws-crypto/client-node';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import postmark from 'postmark';

const logger = new Logger({ serviceName: 'cognitoEmailSender' });
const metrics = new Metrics({ namespace: 'Naleko', serviceName: 'cognitoEmailSender' });
const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);
const keyring = new KmsKeyringNode({ keyIds: [process.env.KMS_KEY_ARN] });
const dynamo = new DynamoDBClient({});
const BLACKHOLE = /@blackhole\.postmarkapp\.com$/i;

const textBody = (code) => `Your code to reset your Naleko People password is ${code}. It works for 1 hour. If you did not ask for this, ignore this email. Your password has not changed.`;
const htmlBody = (code) => `<p>Your code to reset your Naleko People password is <strong>${code}</strong>.</p><p>It works for 1 hour.</p><p>If you did not ask for this, ignore this email. Your password has not changed.</p>`;

export const handler = async (event) => {
  const source = event.triggerSource;
  const sub = event.request?.userAttributes?.sub;
  logger.info('Custom email sender', { triggerSource: source, sub });
  if (source !== 'CustomEmailSender_ForgotPassword') return;
  const email = event.request.userAttributes.email;
  const { plaintext } = await decrypt(keyring, Buffer.from(event.request.code, 'base64'));
  const code = Buffer.from(plaintext).toString('utf8');
  try {
    const client = new postmark.ServerClient(process.env.POSTMARK_API_TOKEN);
    const r = await client.sendEmail({
      From: process.env.POSTMARK_SENDER_EMAIL,
      To: email,
      Subject: 'Your Naleko People code',
      TextBody: textBody(code),
      HtmlBody: htmlBody(code),
      Tag: 'password-reset',
      MessageStream: 'outbound',
    });
    logger.info('Reset email sent', { sub, messageId: r.MessageID });
  } catch (e) {
    logger.error('Reset email failed', { sub, error: e?.code ?? e?.name ?? 'Error' });
    metrics.addMetric('ResetEmailFailed', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
    throw new Error('Reset email failed');
  }
  if (process.env.RESET_TEST_SINK_TABLE && BLACKHOLE.test(email)) {
    await dynamo.send(new PutItemCommand({
      TableName: process.env.RESET_TEST_SINK_TABLE,
      Item: { email: { S: email }, code: { S: code }, expiresAt: { N: String(Math.floor(Date.now() / 1000) + 900) } },
    }));
  }
};
