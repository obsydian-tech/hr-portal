import type { Browser, Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import journeys from '../../playwright.config';
import { HELP_NEW_EMPLOYEES, HELP_PEOPLE } from '../../fixtures/help-company';
import { HELP_TODAY } from '../../support/help';
import { CognitoFake } from './cognito-fake';
import { SignInPage } from './fixtures';

/**
 * Runs a journey test (e2e/journeys/*.e2e.ts) from inside an acceptance test,
 * the way CI runs it, and collects what it produced, so a card about a journey
 * or its help pictures can be checked from the outside.
 *
 * - The journey runs as its own Playwright process with the journeys config,
 *   pointed at the app this acceptance run already serves (E2E_BASE_URL).
 * - Between the journey and the app sits a small local proxy. It can add one
 *   script to the page: a recorder (captions, typing, clicks, a revealed
 *   password), a request that must not be allowed to leave the browser, or a
 *   rename of a field or button. The app itself is never changed.
 * - Help runs write into pepla-web/help/media. The harness copies what the
 *   journey wrote and puts the folder back as it was.
 *
 * Nothing here calls an AI service or any AWS service.
 */

export const WEB = resolve(__dirname, '..', '..', '..');
export const REPO = resolve(WEB, '..');
export const MEDIA = join(WEB, 'help', 'media');
const APP = process.env['E2E_BASE_URL'] ?? 'http://localhost:4310'; // acceptance playwright.config.ts
export const WIDTHS = ['desktop', 'phone'] as const;
export type Width = (typeof WIDTHS)[number];

export const SCRATCH = mkdtempSync(join(tmpdir(), 'journey-harness-'));

// ---------------------------------------------------------------- tools

/** Programs a check needs on the machine. Returns the missing ones. */
export function missingTools(...names: string[]): string[] {
  return names.filter((n) => {
    try {
      execFileSync(n, n === 'compare' ? ['-version'] : n === 'python3' ? ['--version'] : ['-version'], { stdio: 'ignore' });
      return false;
    } catch {
      return true;
    }
  });
}

// ---------------------------------------------------------------- the journeys' own settings

type ProjectUse = {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  locale?: string;
  timezoneId?: string;
  colorScheme?: 'light' | 'dark';
};

/** Viewport, scale and so on of a journeys project ('desktop' or 'phone'), from e2e/playwright.config.ts. */
export function projectUse(width: Width): ProjectUse {
  const project = journeys.projects?.find((p) => p.name === width);
  if (!project) throw new Error(`e2e/playwright.config.ts has no "${width}" project`);
  const use = { ...journeys.use, ...project.use } as Record<string, unknown>;
  return {
    viewport: use['viewport'] as ProjectUse['viewport'],
    deviceScaleFactor: (use['deviceScaleFactor'] as number | undefined) ?? 1,
    isMobile: Boolean(use['isMobile']),
    hasTouch: Boolean(use['hasTouch']),
    locale: use['locale'] as string | undefined,
    timezoneId: use['timezoneId'] as string | undefined,
    colorScheme: use['colorScheme'] as ProjectUse['colorScheme'],
  };
}

// ---------------------------------------------------------------- the proxy in front of the app

export type PageEvent = { page: string; seq: number; width: number; type: 'caption' | 'input' | 'click' | 'reveal' | 'length'; name: string };

export type FrontMode =
  | { kind: 'plain' }
  | { kind: 'record' }
  /** The page asks a host that is neither the app nor Cognito. */
  | { kind: 'escape' }
  /** Visible words on labels and buttons are swapped, e.g. { 'Sign in': 'Continue' }. */
  | { kind: 'rename'; words: Record<string, string> };

export const ESCAPE_URL = 'https://journey-probe.invalid/escape';

const RECORDER = `(() => {
  const id = Math.random().toString(36).slice(2);
  let seq = 0;
  const clean = (s) => String(s || '').replace(/\\*|\\(optional\\)/g, '').replace(/\\s+/g, ' ').trim();
  const send = (type, name) => fetch('/__journey/event', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: id, seq: seq++, width: window.innerWidth, type, name: clean(name) }) }).catch(() => {});
  const labelOf = (el) => (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('aria-label') || '';
  let lastInput = '';
  let lastLength = -1;
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const name = clean(labelOf(t));
    if (name !== lastInput) { lastInput = name; send('input', name); }
    if (t.type === 'password' && t.value.length !== lastLength) { lastLength = t.value.length; send('length', String(t.value.length)); }
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button, a, [role=button]') : null;
    if (!b) return;
    lastInput = '';
    send('click', b.getAttribute('aria-label') || b.textContent);
  }, true);
  let lastCaption = '';
  setInterval(() => {
    const c = document.getElementById('__help_caption');
    const shown = c && c.style.display !== 'none' ? clean(c.textContent) : '';
    if (shown && shown !== lastCaption) send('caption', shown);
    lastCaption = shown;
  }, 40);
  new MutationObserver((list) => {
    for (const m of list) {
      const t = m.target;
      if (t instanceof HTMLInputElement && m.attributeName === 'type' && m.oldValue === 'password' && t.type !== 'password') send('reveal', labelOf(t));
      if (t instanceof HTMLElement && m.attributeName === 'aria-pressed' && t.getAttribute('aria-pressed') === 'true'
          && /show|hide/i.test(t.getAttribute('aria-label') || '')) send('reveal', t.getAttribute('aria-label'));
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['type', 'aria-pressed'], attributeOldValue: true });
})();`;

const ESCAPER = `fetch(${JSON.stringify(ESCAPE_URL)}, { mode: 'no-cors' }).catch(() => {});`;

const renamer = (words: Record<string, string>) => `(() => {
  const words = ${JSON.stringify(words)};
  const fix = () => {
    for (const el of document.querySelectorAll('label, button, legend, .pp-field__label')) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const t = n.nodeValue.trim();
        if (Object.prototype.hasOwnProperty.call(words, t)) n.nodeValue = n.nodeValue.replace(t, words[t]);
      }
    }
  };
  new MutationObserver(fix).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
})();`;

export type Front = { url: string; events: PageEvent[]; close: () => Promise<void> };

/** A local proxy in front of the app, adding the script for `mode` to every HTML page. */
export async function startFront(mode: FrontMode): Promise<Front> {
  const target = new URL(APP);
  const port = Number(target.port || 80);
  const events: PageEvent[] = [];
  const script =
    mode.kind === 'record' ? RECORDER : mode.kind === 'escape' ? ESCAPER : mode.kind === 'rename' ? renamer(mode.words) : '';

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/__journey/event') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          events.push(JSON.parse(body) as PageEvent);
        } catch {
          /* ignore a broken beacon */
        }
        res.writeHead(204).end();
      });
      return;
    }
    const headers = { ...req.headers };
    delete headers['accept-encoding'];
    const up = httpRequest({ host: target.hostname, port, method: req.method, path: req.url, headers }, (answer) => {
      const type = String(answer.headers['content-type'] ?? '');
      if (!script || !type.includes('text/html')) {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      answer.on('data', (c: Buffer) => chunks.push(c));
      answer.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8').replace(/<head[^>]*>/i, (m) => `${m}<script>${script}</script>`);
        const h = { ...answer.headers };
        delete h['content-length'];
        delete h['content-encoding'];
        res.writeHead(answer.statusCode ?? 200, h);
        res.end(html);
      });
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });

  // Live reload and other websockets go straight through.
  server.on('upgrade', (req, socket, head) => {
    const up = connect(port, target.hostname, () => {
      const lines = Object.entries(req.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
      up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });

  await new Promise<void>((done) => server.listen(0, done));
  const { port: own } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${own}`,
    events,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

// ---------------------------------------------------------------- running a journey

export type JourneyResult = { title: string; project: string; status: string; error: string };
export type Run = { code: number; output: string; results: JourneyResult[] };

function childEnv(extra: Record<string, string>, help: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Leave out the settings of this test run's own worker.
    if (/^(TEST_|PWTEST_|PW_TS_|PLAYWRIGHT_JSON_)/.test(k) || k === 'ACCEPTANCE_TARGET' || k === 'HELP_SHOTS') continue;
    env[k] = v;
  }
  if (help) env['HELP_SHOTS'] = '1';
  return { ...env, ...extra };
}

/** Runs one journey file, normal or help mode, against `base`. */
export async function runJourney(file: string, opts: { help: boolean; base: string; tag: string }): Promise<Run> {
  const json = join(SCRATCH, `${opts.tag}.json`);
  rmSync(json, { force: true });
  const env = childEnv({ E2E_BASE_URL: opts.base, PLAYWRIGHT_JSON_OUTPUT_NAME: json }, opts.help);
  const args = ['playwright', 'test', '-c', 'e2e/playwright.config.ts', '--reporter=json', file.replace(/[.]/g, '\\.')];
  let output = '';
  const code = await new Promise<number>((done) => {
    const child = spawn('npx', args, { cwd: WEB, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    child.on('close', (c) => done(c ?? 1));
  });
  let results: JourneyResult[] = [];
  if (existsSync(json)) results = collect(JSON.parse(readFileSync(json, 'utf8')), file);
  return { code, output: output.slice(-4000), results };
}

type Suite = { file?: string; suites?: Suite[]; specs?: Spec[] };
type Spec = { title: string; file: string; tests: { projectName: string; status: string; results: { error?: { message?: string } }[] }[] };

function collect(report: { suites?: Suite[] }, file: string): JourneyResult[] {
  const out: JourneyResult[] = [];
  const walk = (s: Suite) => {
    for (const spec of s.specs ?? []) {
      if (!spec.file.endsWith(file)) continue;
      for (const t of spec.tests) {
        const error = t.results.map((r) => r.error?.message ?? '').filter(Boolean).join('\n');
        out.push({ title: spec.title, project: t.projectName, status: t.status, error });
      }
    }
    for (const child of s.suites ?? []) walk(child);
  };
  for (const s of report.suites ?? []) walk(s);
  return out;
}

/** "expected" (passed) or "flaky" (passed on retry) for every project, and both projects ran. */
export function passedOnBoth(run: Run): boolean {
  return WIDTHS.every((w) => {
    const mine = run.results.filter((r) => r.project === w);
    return mine.length > 0 && mine.every((r) => r.status === 'expected' || r.status === 'flaky');
  });
}

/** Every test of the journey failed, on both projects. */
export function failedOnBoth(run: Run): boolean {
  return WIDTHS.every((w) => {
    const mine = run.results.filter((r) => r.project === w);
    return mine.length > 0 && mine.every((r) => r.status === 'unexpected');
  });
}

// ---------------------------------------------------------------- help media

/** Every file under help/media with its size and change time, for "wrote nothing". */
export function mediaSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out[relative(MEDIA, p)] = `${s.size}:${s.mtimeMs}`;
    }
  };
  walk(MEDIA);
  return out;
}

export type HelpRun = Run & { dir: string; events: PageEvent[] };

/**
 * Runs the journey in help mode through the recorder and keeps a copy of what
 * it wrote to help/media/<width>/<folder>/. The folder is put back as it was.
 */
export async function helpRun(file: string, folder: string, tag: string): Promise<HelpRun> {
  const front = await startFront({ kind: 'record' });
  const backup = join(SCRATCH, `${tag}-backup`);
  const dir = join(SCRATCH, tag);
  rmSync(dir, { recursive: true, force: true });
  for (const w of WIDTHS) {
    const live = join(MEDIA, w, folder);
    if (existsSync(live)) {
      cpSync(live, join(backup, w), { recursive: true });
      rmSync(live, { recursive: true, force: true });
    }
  }
  try {
    const run = await runJourney(file, { help: true, base: front.url, tag });
    for (const w of WIDTHS) {
      const live = join(MEDIA, w, folder);
      mkdirSync(join(dir, w), { recursive: true });
      if (existsSync(live)) cpSync(live, join(dir, w, folder), { recursive: true });
    }
    return { ...run, dir, events: front.events.slice() };
  } finally {
    for (const w of WIDTHS) {
      const live = join(MEDIA, w, folder);
      rmSync(live, { recursive: true, force: true });
      if (existsSync(join(backup, w))) cpSync(join(backup, w), live, { recursive: true });
    }
    rmSync(backup, { recursive: true, force: true });
    await front.close();
  }
}

/** Width and height stored in a PNG file. */
export function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  if (b.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Length in seconds and kinds of stream (video, audio) of a video file. */
export function videoInfo(file: string): { seconds: number; streams: string[] } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], {
    encoding: 'utf8',
  });
  const j = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  return { seconds: Number(j.format?.duration ?? NaN), streams: (j.streams ?? []).map((s) => s.codec_type) };
}

/** One frame of a video as a PNG: the first, or one from just before the end. */
export function videoFrame(file: string, at: 'first' | 'last'): Buffer {
  const seek = at === 'last' ? ['-sseof', '-0.4'] : [];
  return execFileSync('ffmpeg', ['-v', 'error', ...seek, '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------- comparing pictures

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Share of pixels that differ between two pictures (0 to 1), decoded in the
 * browser so no image library is needed.
 *
 * `b` is drawn at `a`'s size. `region` is in CSS pixels of a page `cssWidth`
 * wide. With `content`, only pixels where `b` differs from its own background
 * (its top-left pixel) are counted: "how much of what b shows is also in a".
 */
export async function pictureDiff(
  page: Page,
  a: Buffer,
  b: Buffer,
  opts: { threshold?: number; region?: Box; cssWidth?: number; content?: boolean } = {},
): Promise<number> {
  return page.evaluate(
    async ({ a, b, threshold, region, cssWidth, content }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((ok, no) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = () => no(new Error('picture did not decode'));
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = ia.naturalWidth;
      const h = ia.naturalHeight;
      const pixels = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const pa = pixels(ia);
      const pb = pixels(ib);
      const s = cssWidth ? w / cssWidth : 1;
      const x0 = region ? Math.max(0, Math.floor(region.x * s)) : 0;
      const y0 = region ? Math.max(0, Math.floor(region.y * s)) : 0;
      const x1 = region ? Math.min(w, Math.ceil((region.x + region.width) * s)) : w;
      const y1 = region ? Math.min(h, Math.ceil((region.y + region.height) * s)) : h;
      const bg = [pb[0]!, pb[1]!, pb[2]!];
      let counted = 0;
      let differ = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          if (content && Math.max(Math.abs(pb[i]! - bg[0]!), Math.abs(pb[i + 1]! - bg[1]!), Math.abs(pb[i + 2]! - bg[2]!)) <= threshold) continue;
          counted++;
          const d = Math.max(Math.abs(pa[i]! - pb[i]!), Math.abs(pa[i + 1]! - pb[i + 1]!), Math.abs(pa[i + 2]! - pb[i + 2]!));
          if (d > threshold) differ++;
        }
      }
      return counted ? differ / counted : 0;
    },
    {
      a: `data:image/png;base64,${a.toString('base64')}`,
      b: `data:image/png;base64,${b.toString('base64')}`,
      threshold: opts.threshold ?? 16,
      region: opts.region ?? null,
      cssWidth: opts.cssWidth ?? null,
      content: Boolean(opts.content),
    },
  );
}

// ---------------------------------------------------------------- reference pictures for "HR signs in"

export const HELP_HR = (() => {
  const p = HELP_PEOPLE.find((x) => x.key === 'hr')!;
  const [givenName, ...rest] = p.name.split(' ');
  return { email: p.email, name: p.name, givenName: givenName!, familyName: rest.join(' ') };
})();

export type SignInReference = {
  width: Width;
  cssWidth: number;
  pictures: [Buffer, Buffer, Buffer];
  /** Where the important parts sit, in CSS pixels, per picture. */
  regions: [Record<string, Box>, Record<string, Box>, Record<string, Box>];
};

/**
 * The three sign-in help pictures as they should look, taken here with the
 * same settings as the journeys (size, scale, clock, locale), the same fake
 * Cognito and the help company's HR person, and checked against the card
 * (AC-4) before they are used. HR home answers the employees API with
 * Sunbird Bakery's new employees (HELP-01.2, ONB-02 Decision 1). `passwordLength` is the length of the made-up
 * password the journey typed, so the dots match.
 */
export async function signInReference(browser: Browser, width: Width, passwordLength: number): Promise<SignInReference> {
  const use = projectUse(width);
  const context = await browser.newContext({ ...use, baseURL: APP });
  try {
    const fake = new CognitoFake([{ email: HELP_HR.email, givenName: HELP_HR.givenName, familyName: HELP_HR.familyName, groups: ['hr_staff'] }]);
    await fake.install(context);
    await answerHelpEmployees(context);
    const page = await context.newPage();
    await page.clock.setFixedTime(HELP_TODAY);
    const signIn = new SignInPage(page);
    const shot = async () => {
      await page.waitForLoadState('networkidle');
      return page.screenshot({ animations: 'disabled', caret: 'hide' });
    };
    const box = async (loc: import('@playwright/test').Locator): Promise<Box> => {
      const text = await loc.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      });
      return text.width > 0 && text.height > 0 ? text : (await loc.boundingBox())!;
    };

    // 01: the empty sign-in page.
    await signIn.open();
    for (const part of [signIn.mark, signIn.email, signIn.password, signIn.submit, signIn.forgot]) await part.waitFor({ state: 'visible' });
    if ((await signIn.email.inputValue()) !== '' || (await signIn.password.inputValue()) !== '') throw new Error('reference 01: fields not empty');
    const r1 = { mark: await box(signIn.mark), email: await box(signIn.email), password: await box(signIn.password), submit: await box(signIn.submit), forgot: await box(signIn.forgot) };
    const p1 = await shot();

    // 02: email and password filled in, password as dots, no message.
    await signIn.email.fill(HELP_HR.email);
    await signIn.password.fill('x'.repeat(passwordLength));
    if ((await signIn.password.getAttribute('type')) !== 'password') throw new Error('reference 02: password is readable');
    if ((await page.locator('.pp-field__error, pp-section-message, [role=alert]').count()) > 0) throw new Error('reference 02: shows a message');
    const r2 = { email: await box(signIn.email), password: await box(signIn.password), submit: await box(signIn.submit) };
    const p2 = await shot();

    // 03: HR home with the greeting.
    await signIn.submit.click();
    const greeting = page.getByRole('heading', { name: `Welcome back, ${HELP_HR.givenName}`, exact: true });
    await greeting.waitFor({ state: 'visible' });
    if (!new URL(page.url()).pathname.startsWith('/hr')) throw new Error(`reference 03: not on HR home (${page.url()})`);
    // HELP-01.2: HR home lists Sunbird Bakery's new employees (ONB-02).
    for (const p of HELP_NEW_EMPLOYEES) await page.getByText(`${p.first_name} ${p.last_name}`, { exact: true }).first().waitFor({ state: 'visible' });
    const r3 = { greeting: await box(greeting) };
    const p3 = await shot();

    return { width, cssWidth: use.viewport.width, pictures: [p1, p2, p3], regions: [r1, r2, r3] };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- HR home's new employees (HELP-01.2, ONB-02)

/** GET <employees API>/v1/employees, on any host but the app's. */
export const EMPLOYEES_API = (url: URL): boolean => /\/v1\/employees$/.test(url.pathname) && url.origin !== new URL(APP).origin;

/**
 * Answers the employees API in the browser with Sunbird Bakery's new
 * employees from e2e/fixtures/help-company.ts, in one page, as the real API
 * answers. Checks first that the list holds only the help company's people,
 * with its HR person as HR partner, so the HR home picture can show no one else.
 */
export async function answerHelpEmployees(context: import('@playwright/test').BrowserContext): Promise<void> {
  const names = new Set<string>(HELP_PEOPLE.map((p) => p.name));
  for (const p of HELP_NEW_EMPLOYEES) {
    const name = `${p.first_name} ${p.last_name}`;
    if (!names.has(name)) throw new Error(`HELP_NEW_EMPLOYEES: ${name} is not one of Sunbird Bakery's people (HELP_PEOPLE)`);
    if (p.hr_staff_name !== HELP_HR.name) throw new Error(`HELP_NEW_EMPLOYEES: ${name}'s HR partner is not ${HELP_HR.name}`);
    if (!p.email.endsWith('@example.com')) throw new Error(`HELP_NEW_EMPLOYEES: ${name}'s email is not an example.com address`);
  }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, OPTIONS' };
  await context.route(EMPLOYEES_API, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() !== 'GET' || !/^Bearer \S+$/.test(req.headers()['authorization'] ?? '')) {
      return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) });
    }
    const items = HELP_NEW_EMPLOYEES.map((p) => ({ ...p, middle_name: '', phone: '', job_title: '', id_number_last4: '', hr_staff_email: HELP_HR.email }));
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ items, count: items.length }) });
  });
}

// ---------------------------------------------------------------- the retake script, in a throwaway repo

/** A throwaway git repo shaped like this one (pepla-web/help/media), to run scripts/ci/help-retake.py in. */
export function retakeRepo(name: string): { root: string; media: string; commit: (msg: string) => string; script: (...args: string[]) => string } {
  const root = join(SCRATCH, name);
  rmSync(root, { recursive: true, force: true });
  const media = join(root, 'pepla-web', 'help', 'media');
  for (const w of WIDTHS) {
    mkdirSync(join(media, w), { recursive: true });
    writeFileSync(join(media, w, '.gitkeep'), '');
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'journey-harness');
  git('config', 'user.email', 'journey-harness@example.com');
  git('config', 'commit.gpgsign', 'false');
  const commit = (msg: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
    return git('rev-parse', 'HEAD');
  };
  commit('base');
  const script = (...args: string[]) =>
    execFileSync('python3', [join(REPO, 'scripts', 'ci', 'help-retake.py'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: SCRATCH },
    });
  return { root, media, commit, script };
}

/** Copies help/media/<width>/<folder>/ of a help run into a retake repo. */
export function placeRun(run: HelpRun, folder: string, media: string): void {
  for (const w of WIDTHS) {
    const from = join(run.dir, w, folder);
    const to = join(media, w, folder);
    rmSync(to, { recursive: true, force: true });
    if (existsSync(from)) cpSync(from, to, { recursive: true });
  }
}

// ---------------------------------------------------------------- what a pull request changes

/**
 * Files under `path` (repo-relative) that the pull request being checked
 * changes, or null when this run is not checking a pull request.
 *
 * In GitHub Actions on a pull request, HEAD is GitHub's merge of the PR into its
 * base, so HEAD^1..HEAD is exactly what merging the PR changes. Locally, the
 * branch is compared with origin/develop, including files not committed yet.
 */
export function prChanges(path: string): string[] | null {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  const lines = (s: string) => s.split('\n').filter(Boolean);
  if (process.env['GITHUB_ACTIONS'] === 'true') {
    if (process.env['GITHUB_EVENT_NAME'] !== 'pull_request') return null;
    const sha = process.env['GITHUB_SHA'] ?? git('rev-parse', 'HEAD');
    try {
      git('rev-parse', '--verify', '-q', 'HEAD^1');
    } catch {
      git('fetch', '--no-tags', '--quiet', '--depth=2', 'origin', sha);
    }
    return lines(git('diff', '--name-only', 'HEAD^1', 'HEAD', '--', path));
  }
  const base = git('merge-base', 'origin/develop', 'HEAD');
  return [...new Set([...lines(git('diff', '--name-only', base, '--', path)), ...lines(git('ls-files', '--others', '--exclude-standard', '--', path))])];
}
