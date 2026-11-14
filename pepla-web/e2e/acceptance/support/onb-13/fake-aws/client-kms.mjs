// KMS that "decrypts" the fake ciphertext: base64 of "kms:" + the plain text. Every call is recorded.
import { calls } from './world.mjs';
export class DecryptCommand { constructor(input) { this.input = input; } }
export class EncryptCommand { constructor(input) { this.input = input; } }
export class KMSClient {
  async send(cmd) {
    if (!(cmd instanceof DecryptCommand)) throw new Error('fake KMS: only Decrypt is expected when reading');
    calls.push({ service: 'kms', op: 'Decrypt' });
    const text = Buffer.from(cmd.input.CiphertextBlob).toString('utf8');
    if (!text.startsWith('kms:')) throw new Error('fake KMS: not a ciphertext this key made');
    return { Plaintext: new TextEncoder().encode(text.slice(4)) };
  }
}
