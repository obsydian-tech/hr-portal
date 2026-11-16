// KMS on its own cannot read a message the AWS Encryption SDK made (Cognito's code), so Decrypt refuses it.
import { calls } from './world.mjs';
export class DecryptCommand { constructor(input) { this.input = input; } }
export class EncryptCommand { constructor(input) { this.input = input; } }
export class KMSClient {
  async send(cmd) {
    calls.push({ service: 'kms', op: cmd.constructor.name.replace('Command', '') + ' (direct)' });
    throw new Error('fake KMS: a Cognito code is an AWS Encryption SDK message; decrypt it with the SDK and a KMS keyring');
  }
}
