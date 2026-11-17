// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// S3 for the document routes. Nothing is read or written: a short-lived link is made by the signer
// (s3-request-presigner.mjs), which records the call. Any S3 call sent through the client is recorded
// and refused, so a handler that downloads the file to answer fails the run.
import { calls } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class GetObjectCommand extends Command { get op() { return 'GetObject'; } }
export class HeadObjectCommand extends Command { get op() { return 'HeadObject'; } }
export class PutObjectCommand extends Command { get op() { return 'PutObject'; } }
export class S3Client {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 's3', op: cmd.op, key: cmd.input?.Key });
    throw new Error(`fake S3: the document routes make a signed link and never call ${cmd.op}`);
  }
  destroy() {}
}
