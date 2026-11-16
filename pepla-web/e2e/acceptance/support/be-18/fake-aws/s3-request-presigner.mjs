// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), unchanged.
// BE-17.1: copied unchanged from ../../be-17/fake-aws (BE-17 lock).
// The S3 URL signer: records the call and returns a made-up link that holds no credentials.
import { calls } from './world.mjs';
export async function getSignedUrl(_client, command, options = {}) {
  const { Bucket, Key, ResponseContentType, ResponseContentDisposition } = command.input ?? {};
  calls.push({ service: 's3', op: 'presign:' + (command.op ?? command.constructor?.name), key: Key, bucket: Bucket, expiresIn: options.expiresIn, contentType: ResponseContentType, disposition: ResponseContentDisposition });
  const q = new URLSearchParams({ 'X-Amz-Expires': String(options.expiresIn ?? ''), 'X-Amz-Signature': 'be17fakesignature' });
  return `https://${Bucket}.s3.af-south-1.amazonaws.com/${encodeURI(Key ?? '')}?${q}`;
}
