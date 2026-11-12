import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * True for a direct-to-S3 request: an S3 host, or a presigned URL (it carries
 * its own signature in the query). These must never get our Bearer token:
 * S3 rejects a request with two kinds of auth (400), and the user's sign-in
 * token must not leave our own APIs.
 */
export function isDirectS3Request(url: string): boolean {
  try {
    const u = new URL(url, 'http://localhost');
    return u.searchParams.has('X-Amz-Signature') || /(^|\.)s3[.-][a-z0-9.-]*amazonaws\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * HTTP interceptor that attaches the Cognito ID token
 * as a Bearer token on every outgoing API request,
 * except direct uploads to S3 (see isDirectS3Request).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (isDirectS3Request(req.url)) {
    return next(req);
  }

  const auth = inject(AuthService);

  return from(auth.getIdToken()).pipe(
    switchMap((token) => {
      if (token) {
        const authReq = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
        return next(authReq);
      }
      return next(req);
    })
  );
};
