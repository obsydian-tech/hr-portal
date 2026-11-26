// REC-05: copied from ../../rec-14/fake-aws/s3-request-presigner.mjs (code added only: an upload link also records what the PUT is
// held to: its ContentType, ContentLength, ContentDisposition and Metadata, as the command was given them).
// The S3 URL signer: records the call and returns a made-up link that holds no credentials.
import { calls } from './world.mjs';
export async function getSignedUrl(_client, command, options = {}) {
  const { Bucket, Key, ResponseContentType, ResponseContentDisposition, ContentType, ContentLength, ContentDisposition, Metadata } = command.input ?? {};
  calls.push({
    service: 's3', op: 'presign:' + (command.op ?? command.constructor?.name), key: Key, bucket: Bucket, expiresIn: options.expiresIn, contentType: ResponseContentType, disposition: ResponseContentDisposition,
    putContentType: ContentType, putContentLength: ContentLength, putDisposition: ContentDisposition, putMetadata: Metadata, signableHeaders: options.signableHeaders ? [...options.signableHeaders] : undefined,
  });
  const q = new URLSearchParams({ 'X-Amz-Expires': String(options.expiresIn ?? ''), 'X-Amz-Signature': 'be17fakesignature' });
  return `https://${Bucket}.s3.af-south-1.amazonaws.com/${encodeURI(Key ?? '')}?${q}`;
}
