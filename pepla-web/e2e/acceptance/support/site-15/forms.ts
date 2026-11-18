import type { Browser, BrowserContext, Page } from '@playwright/test';
import { dsFile, kitDocument, kitMarkup, measure, openKitDocument, settle, sleep, wordsOf, type Device } from '../site-08/kit';

/**
 * SITE-15 helpers: the kit "Site form pages" (`project/ui_kits/site-form.html`) as the oracle, the gallery `/dev/site-forms`, the stand-in
 * sender's test hook, and the page-side functions the tests run on both pages. The SITE-08 kit helpers (`support/site-08/kit.ts`) are imported
 * and never edited: the kit is fetched, measured and compared with them (boxes 1px, 1% of pixels).
 */

/**
 * The design system ref the tests read the kit at: dee75b0 (coordinator, 18 Nov: dee75b0 or later). site-form.html, site-form.js, site-sections.js
 * and site.css are byte for byte the same here as at dc593c4 (SITE-09/10) and at c3788a5 (the app's sync.json ref); dee75b0 changed only the Recruitment pages.
 */
export const KIT_REF = 'dee75b046aa8330912e1fd5f5c6ee072c736997a';
let savedRef: string | undefined;
export function useKitRef(): void { savedRef = process.env['SITE_KIT_REF']; process.env['SITE_KIT_REF'] = process.env['SITE_15_KIT_REF'] || KIT_REF; }
export function restoreKitRef(): void { if (savedRef === undefined) delete process.env['SITE_KIT_REF']; else process.env['SITE_KIT_REF'] = savedRef; }

/** Spec decision 3: the clock is frozen on Mon 16 Nov 2026, 09:00 South African time, so the next five working days are the kit's (Mon 16 to Fri 20 Nov). */
export const FROZEN = new Date('2026-11-16T09:00:00+02:00');
export const ROUTE = '/dev/site-forms';
export const BANNED = /lorem|placeholder|masked|claude|pepla/gi;

// ------------------------------------------------------------------------------------------------ the "free" lines (Iggie 17 Nov)

/**
 * The lines that say "free", taken out of the kit before it is used as the oracle (spec "Iggie's answers": they are not shown until Iggie sends
 * reworded lines; the design system kit is to lose them first). Each cut is the whole element or sentence, so nothing is left half a sentence:
 *   1. the fact "Free company account" (Get started),
 *   2. the sentence "The company account is free." at the start of the Get started lead,
 *   3. the Book a demo confirmation line "Ready to begin before the demo? Create a free company account. Modules are switched on after the onboarding call.",
 *   4. the Book a demo next step "The next step: If the company wants to go ahead, the Administrator creates a free company account and books the onboarding call."
 *      (not one of the three lines Iggie named, but AC-1 allows no "free" anywhere; see cards/site-15.md).
 * A kit that no longer holds a line (the design system change landed) is left as it is. Any "free" left after the cuts fails loudly.
 */
export const FREE_CUTS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'fact "Free company account"', re: /<li class="pp-site-hero__chip">Free company account<\/li>/g },
  { name: 'lead sentence "The company account is free."', re: /The company account is free\. /g },
  { name: 'Book a demo confirmation line "Create a free company account"', re: /<p class="pp-site-confirm__alt">Ready to begin before the demo\? <a href="#">Create a free company account<\/a>\. Modules are switched on after the onboarding call\.<\/p>/g },
  { name: 'Book a demo next step "The next step"', re: /<li class="pp-site-next__item"><span><span class="pp-site-next__title">The next step<\/span>If the company wants to go ahead, the Administrator creates a free company account and books the onboarding call\.<\/span><\/li>/g },
];
export function cutFree(html: string): string {
  let out = html;
  for (const c of FREE_CUTS) out = out.replace(c.re, '');
  const left = out.replace(/<[^>]+>/g, ' ').match(/.{0,60}\bfree\b.{0,40}/gi);
  if (left) throw new Error(`site-15: the kit at ${process.env['SITE_KIT_REF']} still says "free" after the cuts: ${left.join(' | ')}. The kit changed: update FREE_CUTS (a child lock).`);
  return out;
}

// ------------------------------------------------------------------------------------------------ the examples

export type Kind = 'get-started' | 'book-a-demo';
export type State = 'empty' | 'with errors' | 'filled in' | 'sent';
export type FormExample = { name: string; device: Device; screen: string; id: string; kind: Kind; state: State; stage: string };

const kebab = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** The gallery id of an example (spec decision 1): `form-<kit example>-<device>`, e.g. `form-get-started-empty-desktop`. */
export const formId = (name: string, device: Device): string => `form-${kebab(name)}-${device}`;

/** Every example of the kit page, in the kit's order, with its stage markup after the "free" cuts. */
export function formExamples(device?: Device): FormExample[] {
  const text = dsFile('project/ui_kits/site-form.html');
  const out: FormExample[] = [];
  for (const part of text.split(/(?=<section data-screen=")/)) {
    const m = /^<section data-screen="([^"]+)" data-device="(desktop|phone)">\s*([\s\S]*?)\s*<\/section>\s*$/.exec(part);
    if (!m) continue;
    const name = m[1]!.replace(/\s*\((desktop|phone)\)$/, '');
    const k = /^(Get started|Book a demo), (empty|with errors|filled in|sent)$/.exec(name);
    if (!k) throw new Error(`site-15: unexpected kit example "${m[1]}"`);
    const d = m[2] as Device;
    out.push({ name, device: d, screen: m[1]!, id: formId(name, d), kind: k[1] === 'Get started' ? 'get-started' : 'book-a-demo', state: k[2] as State, stage: kitMarkup(cutFree(m[3]!)) });
  }
  if (out.length !== 11) throw new Error(`site-15: the kit has ${out.length} form examples, the tests expect 11`);
  return device ? out.filter((e) => e.device === device) : out;
}
export const exampleOf = (device: Device, name: string): FormExample => {
  const e = formExamples(device).find((x) => x.name === name);
  if (!e) throw new Error(`site-15: the kit has no "${name} (${device})"`);
  return e;
};
export const appStage = (ex: Pick<FormExample, 'screen'>): string => `section[data-example="${ex.screen}"] [data-example-body] .pp-site-stage`;
export const KIT_STAGE = '.pp-site-stage';

// ------------------------------------------------------------------------------------------------ the stand-in sender's hook

/**
 * The contract between the tests and the gallery's stand-in `SiteFormSender` (cards/site-15.md): on every `send(kind, values)` the stand-in reads
 * `window.__ppSiteFormStandIn` if it is there, pushes `{ kind, values }` onto its `calls`, waits `delayMs` (0 when absent) and answers `answer`
 * ('sent' when absent). Without the object it answers 'sent' at once. It makes no network call and stores nothing.
 */
export type StandIn = { answer?: 'sent' | 'failed'; delayMs?: number; calls: Array<{ kind: string; values: unknown }> };
export const standInScript = ([answer, delayMs]: [string, number]): void => {
  (window as unknown as { __ppSiteFormStandIn: StandIn }).__ppSiteFormStandIn = { answer: answer as 'sent' | 'failed', delayMs, calls: [] };
};
export const standInCalls = (p: Page): Promise<StandIn['calls']> => p.evaluate(() => (window as unknown as { __ppSiteFormStandIn?: StandIn }).__ppSiteFormStandIn?.calls ?? []);

// ------------------------------------------------------------------------------------------------ opening the two pages

/** Opens /dev/site-forms with the clock frozen (decision 3). With `only` (section ids), every other section is taken out, so a phone window is not zoomed out by the wide desktop stages. */
export async function gotoForms(page: Page, only?: string[]): Promise<void> {
  const res = await page.goto(ROUTE);
  if (!res || res.status() >= 400) throw new Error(`${ROUTE} answered ${res?.status()}`);
  await page.locator('section[data-example]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => { throw new Error(`${ROUTE} shows no form example (no section[data-example]): the gallery is not built`); });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForLoadState('networkidle');
  if (only) {
    const missing = await page.evaluate((keep) => keep.filter((id) => !document.getElementById(id)), only);
    if (missing.length) throw new Error(`${ROUTE} has no example with the id ${missing.join(', ')}`);
    await page.evaluate((keep) => document.querySelectorAll('section[data-example]').forEach((s) => { if (!keep.includes(s.id)) s.remove(); }), only);
  }
  await fontsAndResize(page);
}
/** SITE-08.1 / SITE-10 T6: wait for every web font the text uses, then make the page lay out again (a resize), then two frames and 150ms. */
export async function fontsAndResize(p: Page): Promise<void> {
  await p.evaluate(async () => {
    const specs = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || !n.parentElement) continue;
      const s = getComputedStyle(n.parentElement);
      specs.add(`${s.fontStyle} ${s.fontWeight} 16px ${s.fontFamily}`);
    }
    await Promise.all([...specs].map((spec) => document.fonts.load(spec).catch(() => [])));
    await document.fonts.ready;
  });
  const v = p.viewportSize();
  if (v) { await p.setViewportSize({ width: v.width + 1, height: v.height }); await p.setViewportSize(v); }
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(150);
}

export type Pair = { ctx: BrowserContext; app: Page; kit: Page; ex: FormExample; a: string; k: string };
export type PairOpts = { answer?: 'sent' | 'failed'; delayMs?: number; reduced?: boolean; /** the kit example to open beside it, when not the same one (a live form judged against the kit's picture of the state it reaches) */ kitEx?: FormExample; clock?: Date; timezoneId?: string };
/**
 * A fresh context with the gallery (this example only, clock frozen, the stand-in hook set) and the kit example beside it, the kit stage as wide
 * as the gallery's. The kit runs its own preview scripts (site-sections.js for the arrivals, site-form.js for the form).
 */
export async function openPair(browser: Browser, baseURL: string, page: Page, ex: FormExample, o: PairOpts = {}): Promise<Pair> {
  const phone = ex.device === 'phone';
  const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1, locale: 'en-ZA', timezoneId: o.timezoneId ?? 'Africa/Johannesburg', reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(standInScript, [o.answer ?? 'sent', o.delayMs ?? 0] as [string, number]);
  const app = await ctx.newPage();
  await app.clock.setFixedTime(o.clock ?? FROZEN);
  await gotoForms(app, [ex.id]);
  const width = await app.locator(appStage(ex)).first().evaluate((el) => el.getBoundingClientRect().width).catch(() => undefined);
  const kit = await ctx.newPage();
  await kit.setViewportSize(page.viewportSize()!);
  await openKitDocument(kit, new URL(baseURL).origin, kitDocument((o.kitEx ?? ex).stage, ['site-sections.js', 'site-form.js'], { device: ex.device, stageWidth: width ? Math.round(width) : undefined }));
  await fontsAndResize(kit);
  return { ctx, app, kit, ex, a: appStage(ex), k: KIT_STAGE };
}
export async function using<T>(p: Promise<Pair>, fn: (p: Pair) => Promise<T>): Promise<T> {
  const pair = await p;
  try { return await fn(pair); } finally { await pair.ctx.close(); }
}

// ------------------------------------------------------------------------------------------------ words

/** In the page: every text node and accessible name of `scope` that is rendered (an element that is `hidden` or display:none is left out, with its insides). `skip` leaves out elements. */
export function shownWords([scope, skip]: [string, string]): { texts: string[]; names: string[] } {
  const root = document.querySelector(scope);
  if (!root) return { texts: [`NO ELEMENT ${scope}`], names: [] };
  const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  const texts = new Set<string>();
  const names = new Set<string>();
  const walk = (el: Element) => {
    if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName)) return;
    if ((el as HTMLElement).hidden || getComputedStyle(el).display === 'none') return;
    if (skip && el.matches(skip)) return;
    for (const a of ['aria-label', 'alt', 'title', 'placeholder']) { const v = clean(el.getAttribute(a)); if (v) names.add(v); }
    const by = el.getAttribute('aria-labelledby');
    if (by) { const v = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')); if (v) names.add(v); }
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { const v = clean(n.textContent); if (v) texts.add(v); } else if (n.nodeType === 1) walk(n as Element);
    }
  };
  walk(root);
  return { texts: [...texts].sort(), names: [...names].sort() };
}
void wordsOf;

/** The banned words and any "free" in the rendered example: text, attributes (href included), classes. */
export function bannedOf(scope: string): string[] {
  const root = document.querySelector(scope);
  if (!root) return [`NO ELEMENT ${scope}`];
  const c = root.cloneNode(true) as HTMLElement;
  c.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
  const html = c.outerHTML;
  return [...(html.match(/lorem|placeholder|masked|claude|pepla/gi) ?? []), ...(html.replace(/<[^>]+>/g, ' ').match(/\bfree\b/gi) ?? []), ...((root.textContent ?? '').match(/free/gi) ?? [])];
}

// ------------------------------------------------------------------------------------------------ the form, as both pages show it

export type Control = { label: string; tag: string; type: string; value: string; invalid: boolean; required: boolean; ariaRequired: boolean; errors: string[]; describedBy: string[]; labelTied: boolean; labelVisible: boolean };
export type FormFacts = { form: boolean; confirm: boolean; confirmTitle: string; controls: Control[]; pressed: string[]; focus: string; busy: boolean };

/**
 * In the page: the form inside `scope` as a person meets it. Each control by its label (visible label tied by `for`/`id` or by wrapping),
 * its value, `aria-invalid`, `required`, `aria-required`, the shown error lines linked by `aria-describedby`; the chips and slots that are on
 * (aria-pressed or aria-checked "true"); what has focus; whether the form or the confirmation shows; whether the send button is busy.
 */
export function formFacts(scope: string): FormFacts {
  const root = document.querySelector(scope)!;
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const shown = (el: Element | null): boolean => !!el && !(el as HTMLElement).hidden && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
  const form = root.querySelector('form');
  const confirm = Array.from(root.querySelectorAll('.pp-site-confirm')).find(shown) ?? null;
  const labelOf = (c: Element): Element | null => (c.id ? root.querySelector(`label[for="${c.id}"]`) : null) ?? c.closest('label');
  const controls: Control[] = form ? Array.from(form.querySelectorAll('input, select, textarea')).map((c) => {
    const lab = labelOf(c);
    const ids = (c.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const errs = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e && e.classList.contains('pp-field__error') && shown(e)).map((e) => clean(e.textContent));
    const ownText = lab ? clean(Array.from(lab.childNodes).filter((n) => !(n.nodeType === 1 && (n as Element).tagName === 'A')).map((n) => n.textContent).join(' ')) : '';
    return {
      label: ownText, tag: c.tagName.toLowerCase(), type: (c as HTMLInputElement).type ?? '',
      value: c.tagName === 'SELECT' ? clean((c as HTMLSelectElement).selectedOptions[0]?.textContent) : (c as HTMLInputElement).type === 'checkbox' ? String((c as HTMLInputElement).checked) : (c as HTMLInputElement).value,
      invalid: c.getAttribute('aria-invalid') === 'true', required: (c as HTMLInputElement).required, ariaRequired: c.getAttribute('aria-required') === 'true',
      errors: errs, describedBy: ids.map((id) => clean(document.getElementById(id)?.textContent)), labelTied: !!lab, labelVisible: !!lab && shown(lab),
    };
  }) : [];
  const on = (b: Element) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' || (b as HTMLInputElement).checked === true && (b as HTMLInputElement).type === 'radio';
  const pressed = form ? Array.from(form.querySelectorAll('.pp-site-chip, .pp-site-slot')).filter(on).map((b) => clean(b.querySelector('.pp-site-chip__label, .pp-site-slot__label')?.textContent ?? b.textContent)) : [];
  const a = document.activeElement;
  const focus = !a || a === document.body ? 'body' : a.matches('input, select, textarea') ? `control:${clean(labelOf(a) ? Array.from(labelOf(a)!.childNodes).filter((n) => !(n.nodeType === 1 && (n as Element).tagName === 'A')).map((n) => n.textContent).join(' ') : '')}` : a.matches('h1,h2,h3') ? `heading:${clean(a.textContent)}` : a.classList.contains('pp-site-confirm') ? `confirm:${clean(a.querySelector('h2')?.textContent)}` : `${a.tagName.toLowerCase()}:${clean(a.textContent).slice(0, 40)}`;
  const submit = form?.querySelector('button[type="submit"], .pp-site-form-card__submit');
  return { form: shown(form), confirm: !!confirm, confirmTitle: clean(confirm?.querySelector('h2')?.textContent), controls, pressed, focus, busy: submit?.getAttribute('aria-busy') === 'true' };
}

// ------------------------------------------------------------------------------------------------ actions, the same on both pages

export type Values = { name?: string; role?: string; email?: string; company?: string; size?: string; chips?: string[]; day?: string; time?: string; note?: string; agree?: boolean };
/** The form's controls by their visible label (the kit's labels). */
const LABEL = { name: 'Full name', role: 'Role', email: 'Email', company: 'Company name', size: 'Number of employees', note: 'Anything else we should know' } as const;

export function scopeOf(p: Page, scope: string) { return p.locator(scope).first(); }
/** Fills what `v` names, as a person does (typing, choosing, pressing), inside `scope`. */
export async function fill(p: Page, scope: string, v: Values): Promise<void> {
  const s = scopeOf(p, scope);
  for (const k of ['name', 'email', 'company', 'note'] as const) if (v[k] !== undefined) await s.getByLabel(LABEL[k], { exact: k !== 'note' }).first().fill(v[k]!);
  for (const k of ['role', 'size'] as const) if (v[k] !== undefined) await s.getByLabel(LABEL[k], { exact: true }).first().selectOption({ label: v[k]! });
  for (const c of v.chips ?? []) await s.locator('.pp-site-chip').filter({ hasText: c }).first().click();
  if (v.day) await s.locator('.pp-site-slots__row').nth(0).locator('.pp-site-slot').filter({ hasText: v.day }).first().click();
  if (v.time) await s.locator('.pp-site-slots__row').nth(1).locator('.pp-site-slot').filter({ hasText: v.time }).first().click();
  if (v.agree !== undefined) { const box = s.locator('input[type="checkbox"]').first(); if ((await box.isChecked()) !== v.agree) await box.click({ position: { x: 4, y: 4 }, force: true }); }
}
export const sendButton = (p: Page, scope: string) => scopeOf(p, scope).locator('form button[type="submit"], form .pp-site-form-card__submit').first();
export async function pressSend(p: Page, scope: string): Promise<void> { await sendButton(p, scope).click(); }

/** The values a kit example holds (filled in or sent): text fields, chosen options, the chips and slots that are on, the consent box. */
export function kitValues(scope: string): Values {
  const root = document.querySelector(scope)!;
  const form = root.querySelector('form')!;
  const val = (sel: string) => (form.querySelector(sel) as HTMLInputElement | null)?.value || undefined;
  const opt = (sel: string) => { const s = form.querySelector(sel) as HTMLSelectElement | null; return s && s.value ? s.selectedOptions[0]?.textContent?.trim() : undefined; };
  const on = (row: Element | null) => Array.from(row?.querySelectorAll('[aria-pressed="true"] .pp-site-slot__label:not(.pp-site-slot__label--on)') ?? []).map((e) => e.textContent!.trim());
  const rows = form.querySelectorAll('.pp-site-slots__row');
  return {
    name: val('input[autocomplete="name"]'), email: val('input[type="email"]'), company: val('input[autocomplete="organization"]'),
    role: opt('select[name$="Role"]'), size: opt('select[name$="Size"]'),
    chips: Array.from(form.querySelectorAll('.pp-site-chip[aria-pressed="true"] .pp-site-chip__label:not(.pp-site-chip__label--on)')).map((e) => e.textContent!.trim()),
    day: on(rows[0] ?? null)[0], time: on(rows[1] ?? null)[0], agree: (form.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.checked ?? false,
  };
}

// ------------------------------------------------------------------------------------------------ parity and motion

/** Settles both pages (motion stopped, fonts in, a resize) and compares the two stages with the SITE-08 measure: every box within 1px, at most 1% of pixels. */
export { measure, settle };

/**
 * In the page: the motion the CSS gives every element of `scope` (and its ::before and ::after): the animation name, length, delay, count and
 * timing, and each transition's property, length and delay, by the element's tag, pp- classes and own text. Two pages with the same CSS and the
 * same markup give the same list; a page that makes kit motion static (animation: none), slower or faster does not (SITE-10 lock check T1).
 */
export function motionOf(scope: string): string[] {
  const root = document.querySelector(scope);
  if (!root) return [`NO ELEMENT ${scope}`];
  const out: string[] = [];
  const own = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').trim()).filter(Boolean).join(' ').slice(0, 30);
  const sig = (el: Element) => `${el.tagName.toLowerCase()}.${Array.from(el.classList).filter((c) => c.startsWith('pp-') && !/^pp-site-reveal--in$/.test(c)).sort().join('.')}${own(el) ? ` "${own(el)}"` : ''}`;
  const walk = (el: Element) => {
    if (getComputedStyle(el).display === 'none') return;
    for (const pseudo of [null, '::before', '::after'] as const) {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
      if (cs.animationName && cs.animationName !== 'none') out.push(`${sig(el)}${pseudo ?? ''} animation ${cs.animationName} ${cs.animationDuration} ${cs.animationDelay} ${cs.animationIterationCount} ${cs.animationTimingFunction} ${cs.animationDirection}`);
      const props = cs.transitionProperty.split(',').map((x) => x.trim()), durs = cs.transitionDuration.split(',').map((x) => x.trim()), dels = cs.transitionDelay.split(',').map((x) => x.trim());
      props.forEach((pr, i) => { const d = durs[i % durs.length]!, dl = dels[i % dels.length]!; if (pr !== 'none' && (parseFloat(d) > 0 || parseFloat(dl) > 0)) out.push(`${sig(el)}${pseudo ?? ''} transition ${pr} ${d} ${dl}`); });
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(root);
  return out.sort();
}

/**
 * In the page: how each element of `scope` is painted (colour, background, border colour, font, opacity, shadow), by its tag, pp- classes and own
 * text, in document order. The pixel limit (1%) lets a recoloured line of small text through (a plant did); this does not.
 */
export function looksOf(scope: string): Array<{ sig: string; look: string }> {
  const root = document.querySelector(scope);
  if (!root) return [{ sig: `NO ELEMENT ${scope}`, look: '' }];
  const out: Array<{ sig: string; look: string }> = [];
  const own = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').trim()).filter(Boolean).join(' ').slice(0, 40);
  const walk = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || el.tagName === 'OPTION') return;
    const sig = `${el.tagName.toLowerCase()}.${Array.from(el.classList).filter((c) => c.startsWith('pp-') && !/^pp-site-reveal--in$/.test(c)).sort().join('.')}${own(el) ? ` "${own(el)}"` : ''}`;
    out.push({ sig, look: [cs.color, cs.backgroundColor, cs.backgroundImage.slice(0, 80), cs.borderTopColor, cs.borderBottomColor, cs.fontFamily.split(',')[0], cs.fontSize, cs.fontWeight, cs.fontStyle, cs.textDecorationLine, cs.boxShadow.slice(0, 80)].join(' | ') });
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(root);
  return out;
}
/** Each kit element found on the page (same in-order match as the SITE-08 measure) must be painted the same. */
export function lookDiffs(app: Array<{ sig: string; look: string }>, kit: Array<{ sig: string; look: string }>): string[] {
  const pool = app.slice(1);
  const out: string[] = [];
  for (const k of kit.slice(1)) {
    const at = pool.findIndex((a) => a.sig === k.sig);
    if (at < 0) continue; // a missing element is the box check's finding
    const a = pool.splice(0, at + 1)[at]!;
    if (a.look !== k.look) out.push(`${k.sig}: kit ${k.look} / page ${a.look}`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ phone layout

/** Scrolls the page through `scope` a screen at a time (700ms each), so every part has arrived as a person scrolling would see it, then back to the top. */
export async function scrollThrough(p: Page, scope: string): Promise<void> {
  const h = await p.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return r.bottom + window.scrollY; }, scope);
  const vh = p.viewportSize()!.height;
  for (let y = 0; y < h; y += Math.round(vh * 0.6)) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await sleep(700); }
  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(700);
}

/** In the page: the facts of AC-8 for one example: the page top, the card and the next steps in one column and in that order, and every button and heading shown and not under the header. */
export function layoutFacts(scope: string) {
  const root = document.querySelector(scope)!;
  const r = (sel: string) => { const e = root.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
  const stage = root.getBoundingClientRect();
  const intro = r('.pp-site-form-page__intro'), facts = r('.pp-site-form-page__facts'), lead = r('.pp-site-form-page__lead'), card = r('.pp-site-form-page__card'), next = r('.pp-site-form-page__next'), header = r('.pp-site-header');
  const bad: string[] = [];
  const shown = (el: Element) => !(el as HTMLElement).hidden && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none';
  const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  for (const el of Array.from(root.querySelectorAll('button, h1, h2, h3, a.pp-site-button, [role="radio"], input[type="submit"]'))) {
    if (!shown(el) || el.closest('.pp-site-header, .pp-site-sheet')) continue;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const name = `${el.tagName.toLowerCase()} "${clean(el.textContent)}"`;
    let shade = 1;
    for (let n: Element | null = el; n; n = n.parentElement) shade *= Number(getComputedStyle(n).opacity);
    if (b.width < 1 || b.height < 1 || cs.visibility === 'hidden' || shade < 0.99) bad.push(`${name} is not visible (opacity ${shade.toFixed(2)})`);
    else if (b.left < stage.left - 0.5 || b.right > stage.right + 0.5) bad.push(`${name} is cut off at the side (${b.left.toFixed(0)}..${b.right.toFixed(0)} of ${stage.left.toFixed(0)}..${stage.right.toFixed(0)})`);
    else if (header && b.top < header.bottom - 0.5) bad.push(`${name} starts under the header (top ${b.top.toFixed(0)}, header ends ${header.bottom.toFixed(0)})`);
  }
  return { intro, facts, lead, card, next, header, stage, bad };
}
