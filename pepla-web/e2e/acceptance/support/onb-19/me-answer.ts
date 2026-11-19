import { expect, type Page, type Request, type Response } from '@playwright/test';

/**
 * ONB-19.1: what GET /v1/me answered to the page a full page load opened, read so that no timing can lose it.
 *
 * Why (pepla-dev run 44392612187, develop 7f10393): AC-12 used to wait for "any GET /v1/me" and read its body after the
 * page had loaded. Today, the page open before, can still have a GET /v1/me on its way when the test opens My onboarding.
 * That answer matched, the browser left Today, and its body was gone ("Response body is not available for a response
 * that was navigated away from"). The API had answered 200; the test lost the race, not the app.
 *
 * Here only a GET /v1/me asked BY the newly opened page counts: the page a request comes from is read when the request
 * is sent, so Today's late call never matches. Its body is read inside the response handler, as soon as the answer
 * arrives, before anything else can happen. What is checked about the answer (200, a `step` that is one of the four,
 * and the page showing that step) is unchanged: this only makes sure the answer read is the one the page got.
 */
export type MeAnswer = { status: number; text: string; body: Record<string, unknown> | null };

const isMe = (r: Request) => r.method() === 'GET' && /\/v1\/me$/.test(new URL(r.url()).pathname);

/** The address path of the page that sent the request, at the moment it was sent ('' when it has none). */
function pageOf(r: Request): string {
  try {
    return new URL(r.frame().url()).pathname;
  } catch {
    return '';
  }
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Opens `path` (a full page load, as a person opens it) and returns the first answer to a GET /v1/me that the page at
 * `pagePath` asked for. Fails if that page asks for none within `timeout`.
 */
export async function openAndReadMe(page: Page, path: string, pagePath: RegExp, timeout = 30_000): Promise<MeAnswer> {
  const fromThePage = new WeakSet<Request>();
  const answers: Array<Promise<MeAnswer>> = [];
  const onRequest = (r: Request) => {
    if (isMe(r) && pagePath.test(pageOf(r))) fromThePage.add(r);
  };
  const onResponse = (res: Response) => {
    if (!fromThePage.has(res.request())) return;
    // Read now, inside the handler: nothing can come between the answer arriving and its body being read.
    const read = res.text().then((text) => ({ status: res.status(), text, body: parse(text) }));
    read.catch(() => undefined); // a later answer nobody awaits must not fail the run on its own
    answers.push(read);
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    await page.goto(path);
    await expect.poll(() => answers.length, { message: `the page at ${path} asks GET /v1/me`, timeout }).toBeGreaterThan(0);
    return await answers[0]!;
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
}
