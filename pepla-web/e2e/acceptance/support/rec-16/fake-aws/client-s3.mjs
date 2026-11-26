// REC-05: copied from ../../rec-14/fake-aws/client-s3.mjs (code added only). HeadObject now answers from the world's S3 objects
// (world.s3.objects, key -> { size, contentType }), as S3 does: the object's size and type, or a 404 NotFound error when there is no
// such key in that bucket (world.s3.bucket). Every other S3 call sent through the client is still recorded and refused, so a handler
// that downloads or writes the file itself fails the run (the signed offer is put by the browser through the signed link).
import { calls, world } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class GetObjectCommand extends Command { get op() { return 'GetObject'; } }
export class HeadObjectCommand extends Command { get op() { return 'HeadObject'; } }
export class PutObjectCommand extends Command { get op() { return 'PutObject'; } }
export class S3Client {
  constructor(config = {}) { this.config = config; }
  async send(cmd) {
    calls.push({ service: 's3', op: cmd.op, key: cmd.input?.Key, bucket: cmd.input?.Bucket });
    if (cmd.op === 'HeadObject') {
      const objects = world.s3?.objects ?? {};
      const hit = cmd.input?.Bucket === world.s3?.bucket ? objects[cmd.input?.Key] : undefined;
      if (!hit) {
        const e = new Error('NotFound');
        e.name = 'NotFound';
        e.$fault = 'client';
        e.$metadata = { httpStatusCode: 404 };
        throw e;
      }
      return { ContentLength: hit.size, ContentType: hit.contentType, $metadata: { httpStatusCode: 200 } };
    }
    throw new Error(`fake S3: the document routes make a signed link and never call ${cmd.op}`);
  }
  destroy() {}
}
