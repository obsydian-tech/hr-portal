// KMS whose ciphertext is base64 of "kms:" + the plain text, so Decrypt undoes Encrypt. Every call is recorded.
import { calls } from './world.mjs';
export class DecryptCommand { constructor(input) { this.input = input; } }
export class EncryptCommand { constructor(input) { this.input = input; } }
export class KMSClient {
  async send(cmd) {
    if (cmd instanceof EncryptCommand) {
      calls.push({ service: 'kms', op: 'Encrypt' });
      const plain = Buffer.from(cmd.input.Plaintext).toString('utf8');
      return { CiphertextBlob: new Uint8Array(Buffer.from('kms:' + plain, 'utf8')), KeyId: cmd.input.KeyId };
    }
    if (cmd instanceof DecryptCommand) {
      calls.push({ service: 'kms', op: 'Decrypt' });
      const text = Buffer.from(cmd.input.CiphertextBlob).toString('utf8');
      if (!text.startsWith('kms:')) throw new Error('fake KMS: not a ciphertext this key made');
      return { Plaintext: new TextEncoder().encode(text.slice(4)) };
    }
    throw new Error('fake KMS: only Encrypt and Decrypt are supported');
  }
}
