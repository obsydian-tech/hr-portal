// The S3 URL signer: records the call and returns a made-up link that holds no credentials.
import { calls } from './world.mjs';
export async function getSignedUrl(_client, command, options = {}) {
  const { Bucket, Key, ResponseContentType, ResponseContentDisposition } = command.input ?? {};
  calls.push({ service: 's3', op: 'presign:' + (command.op ?? command.constructor?.name), key: Key, bucket: Bucket, expiresIn: options.expiresIn, contentType: ResponseContentType, disposition: ResponseContentDisposition });
  const q = new URLSearchParams({ 'X-Amz-Expires': String(options.expiresIn ?? ''), 'X-Amz-Signature': 'onb14fakesignature' });
  return `https://${Bucket}.s3.af-south-1.amazonaws.com/${encodeURI(Key ?? '')}?${q}`;
}
