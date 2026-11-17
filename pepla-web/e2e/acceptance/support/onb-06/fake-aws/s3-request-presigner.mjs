// ONB-06: the S3 URL signer. Records the call with everything the signature would bind (bucket, key, content
// type, content length, expiry) and returns a made-up link that holds no credentials. The link carries the
// bound type and length as the real signer's SignedHeaders would, so a test can read them off the link too.
import { calls } from './world.mjs';
export async function getSignedUrl(_client, command, options = {}) {
  const input = command.input ?? {};
  const { Bucket, Key, ContentType, ContentLength } = input;
  calls.push({
    service: 's3',
    op: 'presign:' + (command.op ?? command.constructor?.name),
    bucket: Bucket,
    key: Key,
    expiresIn: options.expiresIn,
    contentType: ContentType,
    contentLength: ContentLength,
    // Anything the handler asked the signer to leave unsigned (a length left out of the signature binds nothing).
    unsignable: [...(options.unsignableHeaders ?? [])],
    unhoistable: [...(options.unhoistableHeaders ?? [])],
    otherInput: Object.keys(input).filter((k) => !['Bucket', 'Key', 'ContentType', 'ContentLength'].includes(k)),
  });
  const signed = ['host', ...(ContentType ? ['content-type'] : []), ...(ContentLength !== undefined ? ['content-length'] : [])].sort();
  const q = new URLSearchParams({ 'X-Amz-Expires': String(options.expiresIn ?? ''), 'X-Amz-SignedHeaders': signed.join(';'), 'X-Amz-Signature': 'onb06fakesignature' });
  return `https://${Bucket}.s3.af-south-1.amazonaws.com/${encodeURI(Key ?? '')}?${q}`;
}
