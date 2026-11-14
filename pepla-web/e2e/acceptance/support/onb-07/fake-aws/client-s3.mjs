// S3 holding the uploaded files of world.s3 ("bucket/key" -> base64). GetObject and HeadObject are
// recorded; a missing object is NoSuchKey, as S3 answers.
import { world, calls, awsError } from './world.mjs';
class Command { constructor(input) { this.input = input; } }
export class GetObjectCommand extends Command { get op() { return 'GetObject'; } }
export class HeadObjectCommand extends Command { get op() { return 'HeadObject'; } }
export class PutObjectCommand extends Command { get op() { return 'PutObject'; } }
export class S3Client {
  constructor() { this.config = {}; }
  async send(cmd) {
    const { Bucket, Key } = cmd.input;
    calls.push({ service: 's3', op: cmd.op, key: Key });
    const b64 = (world.s3 ?? {})[`${Bucket}/${Key}`];
    if (cmd.op === 'PutObject') throw new Error('fake S3: reading a document never writes a file');
    if (b64 === undefined) throw awsError(cmd.op === 'HeadObject' ? 'NotFound' : 'NoSuchKey', 'The specified key does not exist.');
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    if (cmd.op === 'HeadObject') return { ContentLength: bytes.length, ContentType: 'application/pdf' };
    return {
      ContentLength: bytes.length,
      ContentType: 'application/pdf',
      Body: {
        transformToByteArray: async () => bytes,
        transformToString: async (enc) => Buffer.from(bytes).toString(enc ?? 'utf8'),
        async *[Symbol.asyncIterator]() { yield bytes; },
      },
    };
  }
  destroy() {}
}
