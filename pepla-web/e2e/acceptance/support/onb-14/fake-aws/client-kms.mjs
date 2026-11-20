// KMS whose ciphertext is base64 of "kms:" + the plain text, so Decrypt undoes Encrypt. Every call is recorded, with the key
// it was asked to use. world.key 'fail': Decrypt throws with service text in the message (it must never reach an answer or a log).
import { calls, world } from './world.mjs';
export class DecryptCommand { constructor(input) { this.input = input; } }
export class EncryptCommand { constructor(input) { this.input = input; } }
export class GenerateDataKeyCommand { constructor(input) { this.input = input; } }
export class KMSClient {
  async send(cmd) {
    if (cmd instanceof EncryptCommand) {
      calls.push({ service: 'kms', op: 'Encrypt', keyId: cmd.input.KeyId });
      const plain = Buffer.from(cmd.input.Plaintext).toString('utf8');
      return { CiphertextBlob: new Uint8Array(Buffer.from('kms:' + plain, 'utf8')), KeyId: cmd.input.KeyId };
    }
    if (cmd instanceof GenerateDataKeyCommand) { calls.push({ service: 'kms', op: 'GenerateDataKey', keyId: cmd.input.KeyId }); throw new Error('fake KMS: GenerateDataKey is not supported'); }
    if (cmd instanceof DecryptCommand) {
      calls.push({ service: 'kms', op: 'Decrypt', keyId: cmd.input.KeyId });
      if (world.key === 'fail') { const e = new Error('AccessDenied: arn:aws:kms:af-south-1:000000000000:key/onb-14-fake is not authorized for kms:Decrypt (request 4d1e)'); e.name = 'AccessDeniedException'; throw e; }
      const text = Buffer.from(cmd.input.CiphertextBlob).toString('utf8');
      if (!text.startsWith('kms:')) throw new Error('fake KMS: not a ciphertext this key made');
      return { Plaintext: new TextEncoder().encode(text.slice(4)) };
    }
    throw new Error('fake KMS: only Encrypt and Decrypt are supported');
  }
}
