// ONB-06 (S3 as ../../be-20/fake-aws/client-s3.mjs does it, with PutObjectCommand keeping what it is given).
// Nothing is read or written. A short-lived link is made by the signer (s3-request-presigner.mjs), which records
// the call. Any S3 call sent through the client is recorded and refused, so a handler that uploads or downloads
// the file itself fails the run: the file goes from the person's phone straight to S3.
import { calls } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class GetObjectCommand extends Command { get op() { return 'GetObject'; } }
export class HeadObjectCommand extends Command { get op() { return 'HeadObject'; } }
export class PutObjectCommand extends Command { get op() { return 'PutObject'; } }
export class S3Client {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 's3', op: cmd.op, key: cmd.input?.Key });
    throw new Error(`fake S3: the upload routes make a signed link and never call ${cmd.op}`);
  }
  destroy() {}
}
