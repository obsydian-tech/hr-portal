// The AWS Encryption SDK, as the sender uses it: buildClient(...).decrypt(keyring, code). The fake message is
// base64 of "ONB24-ESDK:" + JSON { context, plain } (the test makes it, as Cognito would). A decrypt records
// the keyring's key ids and the message's encryption context, as KMS would see them.
import { calls } from './world.mjs';
export const CommitmentPolicy = { FORBID_ENCRYPT_ALLOW_DECRYPT: 'FORBID_ENCRYPT_ALLOW_DECRYPT', REQUIRE_ENCRYPT_ALLOW_DECRYPT: 'REQUIRE_ENCRYPT_ALLOW_DECRYPT', REQUIRE_ENCRYPT_REQUIRE_DECRYPT: 'REQUIRE_ENCRYPT_REQUIRE_DECRYPT' };
export class KmsKeyringNode {
  constructor(opts = {}) {
    this.generatorKeyId = opts.generatorKeyId;
    this.keyIds = opts.keyIds ?? [];
    this.discovery = !!opts.discovery;
  }
}
async function decrypt(keyring, ciphertext) {
  if (!(keyring instanceof KmsKeyringNode)) throw new Error('fake ESDK: decrypt needs a KmsKeyringNode');
  const raw = typeof ciphertext === 'string' ? Buffer.from(ciphertext, 'base64') : Buffer.from(ciphertext);
  const text = raw.toString('utf8');
  if (!text.startsWith('ONB24-ESDK:')) throw new Error('fake ESDK: not a message the pool made');
  const { context, plain } = JSON.parse(text.slice('ONB24-ESDK:'.length));
  const keys = [keyring.generatorKeyId, ...keyring.keyIds].filter(Boolean);
  calls.push({ service: 'kms', op: 'Decrypt', keys, discovery: keyring.discovery, context });
  if (!keyring.discovery && !keys.includes(process.env.ONB24_PII_KEY_ARN)) throw new Error('fake ESDK: the keyring does not hold the key that encrypted the code');
  return { plaintext: Buffer.from(plain, 'utf8'), messageHeader: { encryptionContext: context } };
}
export function buildClient() {
  return { decrypt, encrypt: async () => { throw new Error('fake ESDK: the sender never encrypts'); } };
}
export default { buildClient, KmsKeyringNode, CommitmentPolicy };
