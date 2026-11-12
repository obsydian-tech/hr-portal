import { isDirectS3Request } from './auth.interceptor';

describe('isDirectS3Request', () => {
  it('is true for a presigned S3 upload URL', () => {
    expect(isDirectS3Request(
      'https://my-bucket.s3.af-south-1.amazonaws.com/uploads/a.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc',
    )).toBeTrue();
  });

  it('is true for an S3 host without a signature', () => {
    expect(isDirectS3Request('https://my-bucket.s3.amazonaws.com/a.pdf')).toBeTrue();
  });

  it('is false for our API Gateway endpoints', () => {
    expect(isDirectS3Request('https://abc123.execute-api.af-south-1.amazonaws.com/v1/employees')).toBeFalse();
  });

  it('is false for relative URLs', () => {
    expect(isDirectS3Request('/assets/config.json')).toBeFalse();
  });
});
