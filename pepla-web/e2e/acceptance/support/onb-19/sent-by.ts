import type { Page, Request } from '@playwright/test';

/**
 * ONB-19.2: counts the calls one page sends, by the page that sent them.
 *
 * Why (AC-2 on a phone, flaky on develop, about 1 run in 4: "GET /v1/me/documents is asked once, got 2"): AC-2 counted
 * every GET /v1/me/documents the stand-in had logged since Today showed its heading. Today's own documents list asks
 * GET /v1/me/documents a moment AFTER that heading shows, and the stand-in logs a call only after it has read its
 * headers. When that call landed late, it counted as one of My onboarding's, so a page that asked once read as two.
 *
 * Here a call counts only when the page that sent it, read at the moment it is sent, is the page given. Today's late
 * call never counts; a page that asks twice still counts two.
 */
export type SentBy = { count: () => number; stop: () => void };

/** The address path of the page that sent the request, at the moment it was sent ('' when it has none). */
function pageOf(r: Request): string {
  try {
    return new URL(r.frame().url()).pathname;
  } catch {
    return '';
  }
}

/** Starts counting `method` calls to `api` (matched on the address path) sent by the page at `pagePath`. */
export function sentBy(page: Page, method: string, api: RegExp, pagePath: RegExp): SentBy {
  let n = 0;
  const onRequest = (r: Request) => {
    if (r.method() === method && api.test(new URL(r.url()).pathname) && pagePath.test(pageOf(r))) n++;
  };
  page.on('request', onRequest);
  return { count: () => n, stop: () => page.off('request', onRequest) };
}
