// SSM Parameter Store with the one parameter the sender may read: the Postmark token.
import { calls, awsError } from './world.mjs';
export class GetParameterCommand { constructor(input) { this.input = input; } }
export class SSMClient {
  async send(cmd) {
    const name = cmd.input?.Name;
    calls.push({ service: 'ssm', op: 'GetParameter', name });
    if (!(cmd instanceof GetParameterCommand)) throw new Error('fake SSM: only GetParameter');
    if (name !== '/naleko/postmark/api_token') throw awsError('AccessDeniedException', `not allowed: ${name}`);
    return { Parameter: { Name: name, Type: 'SecureString', Value: process.env.ONB24_POSTMARK_TOKEN } };
  }
}
