import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { compareScopes, deviceOf, settle, sleep, type Device } from './support/site-08/kit';
import { BANNED, FROZEN, KIT_STAGE, ROUTE, appStage, bannedOf, exampleOf, fill, fontsAndResize, formExamples, formFacts, gotoForms, kitValues, layoutFacts, lookDiffs, looksOf, motionOf, openPair, scrollThrough, pressSend, restoreKitRef, sendButton, shownWords, standInCalls, standInScript, useKitRef, using, type FormExample, type Kind, type Pair, type Values } from './support/site-15/forms';
import { builtSite, filesOf } from './support/site-15/build';
import { FORMS_DIR, allowed, changedFiles, isThisCard, outside, refused, stripComments } from './support/site-15/files';

/**
 * SITE-15 · Book a demo and Get started forms, screens only (Jira NH-220, epic NH-202, amber). One test per acceptance criterion, written from the
 * card before the code. Spec: /mnt/project-files/onboarding-cards/specs/SITE-15.md. Notes and the builder contract: ./cards/site-15.md. No backend.
 *
 * The forms live in the gallery `/dev/site-forms` (spec decision 1), one `section[data-example="<kit example> (<device>)"][id="form-<example>-<device>"]`
 * per example of the design system kit "Site form pages" (`project/ui_kits/site-form.html` at KIT_REF), each holding the example's stage in
 * `[data-example-body] .pp-site-stage`. The kit is the oracle, with the lines that say "free" taken out (support/site-15/forms.ts FREE_CUTS). The
 * live forms are judged by doing the same thing on the gallery and on the kit (its markup and its own preview script) and comparing what each shows.
 * The clock is frozen on Mon 16 Nov 2026 09:00 SAST (decision 3). Every test runs at 1280 and 390 wide, on the examples of that device; AC-7 and
 * AC-9 run once. Run with `E2E_BASE_URL` pointing at a running `ng serve`.
 */

const once = (why: string) => test.skip(test.info().project.name === 'phone-390', `Runs once, in desktop-1280: ${why}`);

// Both pages are drawn the same way on every machine: no sub-pixel (LCD) text and no font hinting (SITE-02 AC-2).
test.use({ launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] } });
test.beforeAll(() => { useKitRef(); });
test.afterAll(() => { restoreKitRef(); });

type Env = { page: Page; browser: import('@playwright/test').Browser; baseURL: string };
const KINDS: Array<{ kind: Kind; empty: string; sent: string; title: string }> = [
  { kind: 'get-started', empty: 'Get started, empty', sent: 'Get started, sent', title: 'The company account is created.' },
  { kind: 'book-a-demo', empty: 'Book a demo, empty', sent: 'Book a demo, sent', title: 'The demo is booked.' },
];
/** The values a person types to reach the kit's "sent" picture: the kit's own sample values ("Get started, filled in"), the chips the sent example shows, the kit's picked day and time. */
async function kitSentValues(p: Pair): Promise<Values> {
  const v = await p.kit.evaluate(kitValues, KIT_STAGE);
  return { name: 'Jane Smith', email: 'jane.smith@example.com', company: 'Example Company', ...(p.ex.kind === 'get-started' ? { role: 'HR manager', size: '51 to 200' } : {}), chips: v.chips, agree: true };
}
const blur = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
/** Both stages, motion stopped and fonts in, compared with the SITE-08 measure: every box within 1px, at most 1% of pixels differ. */
async function expectParity(p: Pair, label: string): Promise<void> {
  await blur(p.app); await blur(p.kit);
  await settle(p.app); await settle(p.kit);
  await fontsAndResize(p.app); await fontsAndResize(p.kit);
  // The header sticks: both pages are measured from the top, as a person first sees them.
  for (const pg of [p.app, p.kit]) await pg.evaluate(() => window.scrollTo(0, 0));
  // A closed select's options have no box of their own (Chrome reports the window's corner), so they are left out of the boxes; the select itself is measured.
  const r = await compareScopes(p.app, p.kit, label, p.a, p.k, 'option');
  expect(r.kitElements, `${label}: the kit example was measured`).toBeGreaterThan(40);
  expect(r.unmatched, `${label}: kit elements missing on the page (tag, pp- classes, own text, in order)`).toEqual([]);
  expect(r.moved, `${label}: elements more than 1px from the kit`).toEqual([]);
  expect(r.pixelRatio, `${label}: share of pixels that differ from the kit`).toBeLessThanOrEqual(0.01);
  const looks = lookDiffs(await p.app.evaluate(looksOf, p.a), await p.kit.evaluate(looksOf, p.k));
  expect(looks, `${label}: elements painted differently from the kit (colour, background, border, font, shadow)`).toEqual([]);
}
const facts = (p: Page, scope: string) => p.evaluate(formFacts, scope);
/** What a person sees of each control: its label, whether it is marked invalid, the error lines it shows. */
const errorView = (f: ReturnType<typeof formFacts>) => f.controls.map((c) => `${c.label}: ${c.invalid ? 'invalid' : 'ok'} [${c.errors.join(' | ')}]`);
const envOf = (page: Page, browser: Env['browser'], baseURL: string | undefined): Env => ({ page, browser, baseURL: baseURL! });
const pairOf = (e: Env, ex: FormExample, o: Parameters<typeof openPair>[4] = {}) => openPair(e.browser, e.baseURL, e.page, ex, o);

test.describe('SITE-15 Book a demo and Get started forms (screens only)', () => {
  test.beforeEach(async ({ page }) => { if (deviceOf(page) === 'desktop') await page.setViewportSize({ width: 1280, height: 900 }); });

  // ---------------------------------------------------------------- AC-1
  test('AC-1 gallery and words: /dev/site-forms shows every example of the kit; each example\'s text and accessible names equal the kit\'s both ways (kit without the "free" lines); no "free", pepla, Masked, Claude or lorem', async ({ page, browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const e = envOf(page, browser, baseURL);
    const d = deviceOf(page);
    await page.clock.setFixedTime(FROZEN);
    await gotoForms(page);
    const all = formExamples();
    expect(all.map((x) => x.screen), 'the kit has the eleven examples the spec lists').toEqual(['Get started, empty (desktop)', 'Get started, with errors (desktop)', 'Get started, filled in (desktop)', 'Get started, sent (desktop)', 'Book a demo, empty (desktop)', 'Book a demo, sent (desktop)', 'Get started, empty (phone)', 'Get started, with errors (phone)', 'Get started, sent (phone)', 'Book a demo, empty (phone)', 'Book a demo, sent (phone)']);
    const shown = await page.evaluate(() => Array.from(document.querySelectorAll('section[data-example]')).map((s) => `${s.getAttribute('data-example')}#${s.id}#${s.querySelectorAll(':scope [data-example-body] .pp-site-stage').length}`));
    expect(shown, 'one section per kit example, in the kit\'s order, each with its id and one stage').toEqual(all.map((x) => `${x.screen}#${x.id}#1`));
    for (const ex of formExamples(d)) {
      await using(pairOf(e, ex), async (p) => {
        // Decision 4: in "sent", the confirmation shows the typed email and the picked slot; those two are judged in AC-5, not here.
        const skip = ex.state === 'sent' ? '[data-confirm-mail], [data-confirm-when]' : '';
        const app = await p.app.evaluate(shownWords, [p.a, skip] as [string, string]);
        const kit = await p.kit.evaluate(shownWords, [p.k, skip] as [string, string]);
        expect(kit.texts.length, `${ex.screen}: the kit example has text`).toBeGreaterThan(15);
        expect(app.texts.filter((t) => !kit.texts.includes(t)), `${ex.screen}: text on the page that is not on the kit example`).toEqual([]);
        expect(kit.texts.filter((t) => !app.texts.includes(t)), `${ex.screen}: text on the kit example that is not on the page`).toEqual([]);
        expect(app.names.filter((t) => !kit.names.includes(t)), `${ex.screen}: accessible names on the page that are not on the kit example`).toEqual([]);
        expect(kit.names.filter((t) => !app.names.includes(t)), `${ex.screen}: accessible names on the kit example that are not on the page`).toEqual([]);
        expect(await p.app.evaluate(bannedOf, p.a), `${ex.screen}: no "free" in any text, and no lorem, placeholder, Masked, Claude or pepla in text, attributes, classes or links`).toEqual([]);
      });
    }
    void BANNED;
  });

  // ---------------------------------------------------------------- AC-2
  test('AC-2 parity: each example within 1px and 1% of pixels of the kit (SITE-08 measure), clock frozen at Mon 16 Nov 2026 09:00 SAST; the filled-in form as the kit draws it; the kit\'s motion kept, in normal and reduced motion', async ({ page, browser, baseURL }) => {
    test.setTimeout(12 * 60_000);
    const e = envOf(page, browser, baseURL);
    const d = deviceOf(page);
    for (const ex of formExamples(d)) {
      await using(pairOf(e, ex), async (p) => {
        // The motion the CSS gives each element (the shine, the lights, arrivals, chip and slot fades): the kit's, nothing made static, slower or faster (SITE-10 T1).
        await sleep(1200);
        const a = await p.app.evaluate(motionOf, p.a), k = await p.kit.evaluate(motionOf, p.k);
        expect(k.length, `${ex.screen}: control: the kit example has motion`).toBeGreaterThan(3);
        expect(a.filter((x) => !k.includes(x)), `${ex.screen}: motion on the page that the kit does not have`).toEqual([]);
        expect(k.filter((x) => !a.includes(x)), `${ex.screen}: kit motion missing on the page (made static, or a different length)`).toEqual([]);
        await expectParity(p, ex.screen);
      });
    }
    // Reduced motion: the kit's reduced rules and nothing else (LESSONS: kit motion is never made static).
    for (const ex of formExamples(d).filter((x) => x.state === 'empty')) {
      await using(pairOf(e, ex, { reduced: true }), async (p) => {
        await sleep(1200);
        const a = await p.app.evaluate(motionOf, p.a), k = await p.kit.evaluate(motionOf, p.k);
        expect(a.filter((x) => !k.includes(x)), `${ex.screen}, reduced motion: motion on the page that the kit does not have`).toEqual([]);
        expect(k.filter((x) => !a.includes(x)), `${ex.screen}, reduced motion: kit motion missing on the page`).toEqual([]);
      });
    }
    // The live Get started form, filled in with the kit's sample values, is the kit's "filled in" picture (the kit draws it at desktop only).
    if (d === 'desktop') {
      const filled = exampleOf(d, 'Get started, filled in');
      await using(pairOf(e, exampleOf(d, 'Get started, empty'), { kitEx: filled }), async (p) => {
        const v = await p.kit.evaluate(kitValues, KIT_STAGE);
        expect(v.name, 'control: the kit\'s filled-in example holds values').toBeTruthy();
        await fill(p.app, p.a, v);
        await expectParity(p, 'Get started, empty, filled in by the test, against the kit\'s "filled in"');
      });
    }
  });

  // ---------------------------------------------------------------- AC-3
  test('AC-3 fields are real form controls: visible labels tied to controls, required and aria-required, Email is type=email and takes any address (Gmail, Outlook), Role and Number of employees are selects with the kit\'s options, modules are toggle chips, day and time are single-choice groups that arrow keys move; the days are the next five working days in South African time', async ({ page, browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const e = envOf(page, browser, baseURL);
    const d = deviceOf(page);
    for (const k of KINDS) {
      const ex = exampleOf(d, k.empty);
      await using(pairOf(e, ex), async (p) => {
        const app = await facts(p.app, p.a), kit = await facts(p.kit, p.k);
        expect(app.controls.map((c) => `${c.tag}:${c.type}:${c.label}`), `${ex.screen}: the same controls as the kit, in order, each found by its label`).toEqual(kit.controls.map((c) => `${c.tag}:${c.type}:${c.label}`));
        expect(app.controls.filter((c) => !c.labelTied || !c.labelVisible).map((c) => c.label || c.tag), `${ex.screen}: every control has a visible label tied to it (for/id or wrapping)`).toEqual([]);
        const req = kit.controls.filter((c) => c.required).map((c) => c.label);
        expect(req.length, `${ex.screen}: control: the kit marks required fields`).toBeGreaterThanOrEqual(3);
        expect(app.controls.filter((c) => req.includes(c.label) && !(c.required && c.ariaRequired)).map((c) => c.label), `${ex.screen}: each required field is required and aria-required="true"`).toEqual([]);
        expect(app.controls.filter((c) => !req.includes(c.label) && c.type !== 'checkbox' && (c.required || c.ariaRequired)).map((c) => c.label), `${ex.screen}: optional fields are not required`).toEqual([]);
        const email = p.app.locator(p.a).getByLabel('Email', { exact: true });
        expect(await email.getAttribute('type'), `${ex.screen}: Email is type="email"`).toBe('email');
        expect(await email.getAttribute('pattern'), `${ex.screen}: Email has no pattern that could refuse a domain`).toBeNull();
        // Selects, with the kit's options in order.
        const opts = (pg: Page, s: string) => pg.evaluate((sc) => Array.from(document.querySelector(sc)!.querySelectorAll('form select')).map((x) => Array.from((x as HTMLSelectElement).options).map((o) => (o.textContent ?? '').trim()).join(' / ')), s);
        expect(await opts(p.app, p.a), `${ex.screen}: the selects and their options, in the kit's order`).toEqual(await opts(p.kit, p.k));
        if (k.kind === 'get-started') expect((await opts(p.app, p.a)).length, 'Role and Number of employees are selects').toBe(2);
        // Module chips: a named group of toggle buttons, all off, optional.
        const chips = p.app.locator(p.a).locator('form .pp-site-chip');
        const n = await chips.count();
        expect(n, `${ex.screen}: the kit's chips`).toBe(await p.kit.locator('form .pp-site-chip').count());
        const chipFacts = await p.app.evaluate((sc) => Array.from(document.querySelector(sc)!.querySelectorAll('form .pp-site-chip')).map((b) => `${b.tagName}:${b.getAttribute('type')}:${b.getAttribute('aria-pressed')}:${(b.closest('fieldset')?.querySelector('legend')?.textContent ?? b.closest('[role="group"]')?.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim()}`), p.a);
        const kitChipFacts = await p.kit.evaluate((sc) => Array.from(document.querySelector(sc)!.querySelectorAll('form .pp-site-chip')).map((b) => `${b.tagName}:${b.getAttribute('type')}:${b.getAttribute('aria-pressed')}:${(b.closest('fieldset')?.querySelector('legend')?.textContent ?? '').replace(/\s+/g, ' ').trim()}`), p.k);
        expect(chipFacts, `${ex.screen}: each chip is a button with aria-pressed, off at first, in the group named by the kit's legend`).toEqual(kitChipFacts);
        // Lock check T2: what a screen reader meets. The form's controls, groups and buttons by role and accessible name, compared with the kit's (a radio with aria-checked and a radiogroup count as the kit's pressed button in a group, the other accepted pattern). A duplicated name (the kit's second, aria-hidden label shown to a screen reader), a wrong name or a plain button without pressed state differ here and nowhere else.
        const tree = async (pg: Page, sc: string) => (await pg.locator(sc).locator('form').first().ariaSnapshot()).split('\n').map((l) => l.trim()).filter((l) => /^- (button|radio|radiogroup|group|textbox|combobox|checkbox|heading|link|alert)\b/.test(l)).map((l) => l.replace(/^- radiogroup/, '- group').replace(/^- radio "(.*?)"( \[checked\])?/, (_m, n: string, c?: string) => `- button "${n}"${c ? ' [pressed]' : ''}`));
        const kitTree = await tree(p.kit, p.k);
        expect(kitTree.length, `${ex.screen}: control: the kit form has controls`).toBeGreaterThan(10);
        expect(await tree(p.app, p.a), `${ex.screen}: roles and accessible names of the form's controls, groups and buttons equal the kit's`).toEqual(kitTree);
        await chips.nth(1).click();
        expect(await chips.nth(1).getAttribute('aria-pressed'), `${ex.screen}: pressing a chip turns it on`).toBe('true');
        await chips.nth(1).click();
        expect(await chips.nth(1).getAttribute('aria-pressed'), `${ex.screen}: pressing it again turns it off`).toBe('false');
        // Day and time: each row is a group named "Day" / "Time" with one choice on; a click picks one; arrow keys move the choice and the focus.
        for (const [i, name] of [[0, 'Day'], [1, 'Time']] as const) {
          const row = p.app.locator(p.a).locator('form .pp-site-slots__row').nth(i);
          expect(await row.evaluate((r) => { const by = r.getAttribute('aria-labelledby'); return (r.getAttribute('aria-label') ?? (by ? by.split(/\s+/).map((x) => document.getElementById(x)?.textContent ?? '').join(' ') : '')).trim(); }), `${ex.screen}: the ${name} row is a group named "${name}"`).toBe(name);
          expect(await row.getAttribute('role'), `${ex.screen}: the ${name} row is a group (radiogroup or group)`).toMatch(/^(radiogroup|group)$/);
          const slots = row.locator('.pp-site-slot');
          const on = () => row.evaluate((r) => Array.from(r.querySelectorAll('.pp-site-slot')).map((b) => (b.getAttribute('aria-checked') ?? b.getAttribute('aria-pressed')) === 'true' || ((b as HTMLInputElement).type === 'radio' && (b as HTMLInputElement).checked)));
          const kitOn = await p.kit.locator(p.k).locator('form .pp-site-slots__row').nth(i).evaluate((r) => Array.from(r.querySelectorAll('.pp-site-slot')).map((b) => b.getAttribute('aria-pressed') === 'true'));
          expect(await on(), `${ex.screen}: the ${name} row starts with the kit's choice on, and only it`).toEqual(kitOn);
          const roles = await slots.evaluateAll((bs) => bs.map((b) => b.getAttribute('role') === 'radio' ? (b.hasAttribute('aria-checked') && !b.hasAttribute('aria-pressed') ? 'radio' : 'radio with aria-pressed') : b.tagName === 'BUTTON' && b.hasAttribute('aria-pressed') ? 'pressed' : `${b.tagName.toLowerCase()} ${b.getAttribute('role') ?? ''}`));
          expect(new Set(roles).size === 1 && ['radio', 'pressed'].includes(roles[0]!), `${ex.screen}: each ${name} choice is a radio (aria-checked) or, as the kit draws it, a button with aria-pressed: ${roles.join(', ')}`).toBe(true);
          // Lock check T2: one pattern or the other, whole: radiogroup with radios (aria-checked), or the kit's group of buttons (aria-pressed). A radio in a plain group, or pressed buttons in a radiogroup, is neither.
          expect(`${await row.getAttribute('role')}+${roles[0]}`, `${ex.screen}: the ${name} row is a radiogroup of radios, or the kit's group of pressed buttons, not a mix`).toMatch(/^(radiogroup\+radio|group\+pressed)$/);
          await slots.nth(2).click();
          expect(await on(), `${ex.screen}: a click on the third ${name} turns it on and the others off`).toEqual([false, false, true, false, false]);
          await slots.nth(2).focus();
          await p.app.keyboard.press('ArrowRight');
          expect(await on(), `${ex.screen}: ArrowRight moves the ${name} choice to the next one`).toEqual([false, false, false, true, false]);
          expect(await slots.nth(3).evaluate((b) => b === document.activeElement), `${ex.screen}: ArrowRight moves the focus with it`).toBe(true);
          await p.app.keyboard.press('ArrowLeft');
          await p.app.keyboard.press('ArrowLeft');
          expect(await on(), `${ex.screen}: ArrowLeft moves the ${name} choice back`).toEqual([false, true, false, false, false]);
          expect(await slots.nth(1).evaluate((b) => b === document.activeElement), `${ex.screen}: ArrowLeft moves the focus with it`).toBe(true);
        }
      });
      // Email takes any address: Gmail and Outlook are sent (no domain block, LESSONS "Email" rule); modules are optional (none pressed).
      for (const address of ['thandi.nkosi@gmail.com', 'thandi.nkosi@outlook.com']) {
        await using(pairOf(e, ex), async (p) => {
          await fill(p.app, p.a, { name: 'Thandi Nkosi', email: address, company: 'Example Company', ...(k.kind === 'get-started' ? { role: 'Administrator', size: '1 to 50' } : {}), agree: true });
          await pressSend(p.app, p.a);
          await expect.poll(async () => (await facts(p.app, p.a)).confirm, { message: `${ex.screen}: ${address} is accepted and the form is sent`, timeout: 10_000 }).toBe(true);
          expect((await standInCalls(p.app)).length, `${ex.screen}: ${address}: sent once`).toBe(1);
        });
      }
    }
    // Decision 3: the day slots are the next five working days in South African time, whatever the visitor's own time zone.
    // Sat 21 Nov 2026 00:30 SAST is still Fri 20 Nov 14:30 in Los Angeles: the days are Mon 23 to Fri 27 Nov, not from Fri 20.
    // Tue 1 Dec 2026 08:00 SAST: Tue 1 to Mon 7 Dec (a weekend is skipped).
    for (const [when, days] of [['2026-11-21T00:30:00+02:00', ['Mon 23 Nov', 'Tue 24 Nov', 'Wed 25 Nov', 'Thu 26 Nov', 'Fri 27 Nov']], ['2026-12-01T08:00:00+02:00', ['Tue 1 Dec', 'Wed 2 Dec', 'Thu 3 Dec', 'Fri 4 Dec', 'Mon 7 Dec']]] as const) {
      await using(pairOf(e, exampleOf(d, 'Book a demo, empty'), { clock: new Date(when), timezoneId: 'America/Los_Angeles' }), async (p) => {
        const shownDays = await p.app.locator(p.a).locator('form .pp-site-slots__row').nth(0).evaluate((r) => Array.from(r.querySelectorAll('.pp-site-slot')).map((b) => (b.querySelector('.pp-site-slot__label:not(.pp-site-slot__label--on)')?.textContent ?? b.textContent ?? '').trim()));
        expect(shownDays, `the day choices at ${when} (South African time), seen from Los Angeles`).toEqual([...days]);
      });
    }
  });

  // ---------------------------------------------------------------- AC-4
  test('AC-4 errors: Send with nothing filled shows each required field\'s kit message linked by aria-describedby, aria-invalid, the consent error, focus on the first field in error, nothing sent; a bad email shows its message; fixing a field clears its message on change', async ({ page, browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const e = envOf(page, browser, baseURL);
    const d = deviceOf(page);
    for (const k of KINDS) {
      const ex = exampleOf(d, k.empty);
      await using(pairOf(e, ex), async (p) => {
        await pressSend(p.app, p.a); await pressSend(p.kit, p.k);
        await sleep(300);
        const app = await facts(p.app, p.a), kit = await facts(p.kit, p.k);
        expect(kit.controls.filter((c) => c.invalid).length, `${ex.screen}: control: the kit shows errors`).toBeGreaterThanOrEqual(4);
        expect(errorView(app), `${ex.screen}, Send with nothing filled: each field marked as the kit marks it, with the kit's message linked by aria-describedby`).toEqual(errorView(kit));
        expect(app.controls.filter((c) => c.invalid && c.errors.length !== 1).map((c) => c.label), `${ex.screen}: each field in error shows exactly one message, linked by aria-describedby`).toEqual([]);
        expect(app.focus, `${ex.screen}: focus moves to the first field in error`).toBe(kit.focus);
        expect(app.focus, `${ex.screen}: the first field in error is Full name`).toBe('control:Full name');
        expect(app.confirm, `${ex.screen}: nothing claims success`).toBe(false);
        expect(app.form, `${ex.screen}: the form stays`).toBe(true);
        expect(await standInCalls(p.app), `${ex.screen}: nothing is sent`).toEqual([]);
        // A bad email shows its message; the others stay as they are.
        for (const pg of [p.app, p.kit]) await fill(pg, pg === p.app ? p.a : p.k, { email: 'name@example' });
        for (const pg of [p.app, p.kit]) await pressSend(pg, pg === p.app ? p.a : p.k);
        await sleep(200);
        const bad = await facts(p.app, p.a);
        expect(bad.controls.find((c) => c.label === 'Email')?.errors, `${ex.screen}: a bad email shows the kit's message`).toEqual(['Enter an email address, such as name@example.com.']);
        expect(errorView(bad), `${ex.screen}, a bad email: the same errors as the kit`).toEqual(errorView(await facts(p.kit, p.k)));
        // Fixing a field clears its message as soon as it changes (no Send), and leaves the others; what was typed stays.
        const steps: Array<[string, Values]> = [['Full name typed', { name: 'Thandi Nkosi' }], ['Email corrected', { email: 'thandi.nkosi@gmail.com' }], ...(k.kind === 'get-started' ? [['Role chosen', { role: 'HR manager' }] as [string, Values]] : []), ['consent ticked', { agree: true }]];
        for (const [what, v] of steps) {
          await fill(p.app, p.a, v); await fill(p.kit, p.k, v);
          await sleep(150);
          const a = await facts(p.app, p.a), kk = await facts(p.kit, p.k);
          expect(errorView(a), `${ex.screen}, ${what}: its message clears at once and the others stay, as on the kit`).toEqual(errorView(kk));
          expect(a.controls.map((c) => c.value), `${ex.screen}, ${what}: nothing typed is cleared`).toEqual(kk.controls.map((c) => c.value));
        }
        expect(await standInCalls(p.app), `${ex.screen}: still nothing sent`).toEqual([]);
      });
    }
    // The error state is the kit's "with errors" picture (Get started, both devices).
    await using(pairOf(e, exampleOf(d, 'Get started, empty'), { kitEx: exampleOf(d, 'Get started, with errors') }), async (p) => {
      await pressSend(p.app, p.a);
      await sleep(400);
      await expectParity(p, `Get started, empty, Send pressed with nothing filled, against the kit's "with errors" (${d})`);
    });
  });

  // ---------------------------------------------------------------- AC-5
  test('AC-5 sent: with valid values and consent, Send calls SiteFormSender.send once (a double press sends once), the button is busy while waiting, the confirmation replaces the form with focus on its heading and shows the typed email and picked slot; a failed send leaves the form filled and claims nothing', async ({ page, browser, baseURL }) => {
    test.setTimeout(12 * 60_000);
    const e = envOf(page, browser, baseURL);
    const d = deviceOf(page);
    for (const k of KINDS) {
      const ex = exampleOf(d, k.empty);
      const sentEx = exampleOf(d, k.sent);
      // The kit's own values give the kit's "sent" picture.
      await using(pairOf(e, ex, { kitEx: sentEx, delayMs: 4000 }), async (p) => {
        const v = await kitSentValues(p);
        await fill(p.app, p.a, v);
        const btn = sendButton(p.app, p.a);
        await btn.evaluate((b) => { (b as HTMLElement).click(); (b as HTMLElement).click(); });
        // Lock check T4: no fixed sleep decides this (a loaded machine stretched 300ms past the old 1500ms answer): wait for busy, the answer comes 4s after the press.
        await expect.poll(async () => (await facts(p.app, p.a)).busy, { message: `${ex.screen}: the button shows busy (aria-busy="true") while the send is waiting`, timeout: 2_500 }).toBe(true);
        const waiting = await facts(p.app, p.a);
        expect(waiting.busy, `${ex.screen}: the button shows busy (aria-busy="true") while the send is waiting`).toBe(true);
        expect(waiting.confirm, `${ex.screen}: no confirmation before the answer`).toBe(false);
        await btn.click({ force: true, timeout: 2_000 }).catch(() => undefined);
        await expect.poll(async () => (await facts(p.app, p.a)).confirm, { message: `${ex.screen}: the confirmation shows once the stand-in answers`, timeout: 10_000 }).toBe(true);
        await sleep(500);
        const calls = await standInCalls(p.app);
        expect(calls.length, `${ex.screen}: SiteFormSender.send is called once for a double press and a third press while waiting`).toBe(1);
        expect(calls[0]!.kind, `${ex.screen}: the send says which form it is`).toBe(k.kind);
        expect(JSON.stringify(calls[0]!.values), `${ex.screen}: the send carries what was typed`).toContain('jane.smith@example.com');
        const done = await facts(p.app, p.a);
        expect(done.form, `${ex.screen}: the form is gone`).toBe(false);
        expect(done.confirmTitle, `${ex.screen}: the confirmation heading`).toBe(k.title);
        expect([`heading:${k.title}`, `confirm:${k.title}`], `${ex.screen}: focus is on the confirmation heading`).toContain(done.focus);
        expect(done.busy, `${ex.screen}: the button is no longer busy`).toBe(false);
        await expectParity(p, `${k.empty}, filled and sent, against the kit's "${k.sent}" (${d})`);
      });
      // Decision 4: the confirmation shows the email typed and the day and time picked.
      await using(pairOf(e, ex, { kitEx: sentEx }), async (p) => {
        await fill(p.app, p.a, { name: 'Thandi Nkosi', email: 'thandi.nkosi@gmail.com', company: 'Example Company', ...(k.kind === 'get-started' ? { role: 'Other', size: 'More than 1,000' } : {}), day: 'Wed 18 Nov', time: '14:00', agree: true });
        await pressSend(p.app, p.a);
        await expect.poll(async () => (await facts(p.app, p.a)).confirm, { message: `${ex.screen}: sent`, timeout: 10_000 }).toBe(true);
        const shown = await p.app.locator(p.a).evaluate((r) => ({ mail: (r.querySelector('.pp-site-confirm [data-confirm-mail]')?.textContent ?? r.querySelector('.pp-site-confirm__lead strong')?.textContent ?? '').trim(), lead: (r.querySelector('.pp-site-confirm__lead')?.textContent ?? '').replace(/\s+/g, ' ').trim(), when: (r.querySelector('.pp-site-confirm__when')?.textContent ?? '').replace(/\s+/g, ' ').trim() }));
        expect(shown.lead, `${ex.screen}: the confirmation names the email typed`).toBe('A confirmation email goes to thandi.nkosi@gmail.com with the call invite attached.');
        expect(shown.when, `${ex.screen}: the confirmation names the day and time picked`).toBe(`${k.kind === 'get-started' ? 'Onboarding call:' : 'Demo:'} Wed 18 Nov, 14:00`);
        const skip = '[data-confirm-mail], [data-confirm-when]';
        const app = await p.app.evaluate(shownWords, [p.a, skip] as [string, string]), kit = await p.kit.evaluate(shownWords, [p.k, skip] as [string, string]);
        expect(app.texts.filter((t) => !kit.texts.includes(t)), `${ex.screen}: after sending, no words that the kit's "${k.sent}" does not have (the email and slot aside)`).toEqual([]);
        expect(kit.texts.filter((t) => !app.texts.includes(t)), `${ex.screen}: after sending, every word of the kit's "${k.sent}"`).toEqual([]);
      });
      // The stand-in answers 'failed': the form stays filled and nothing claims success (the failure words are owed: W-3).
      await using(pairOf(e, ex, { answer: 'failed', delayMs: 300 }), async (p) => {
        const v: Values = { name: 'Thandi Nkosi', email: 'thandi.nkosi@outlook.com', company: 'Example Company', ...(k.kind === 'get-started' ? { role: 'Director or owner', size: '201 to 1,000' } : {}), chips: ['Recruitment'], day: 'Thu 19 Nov', time: '11:00', agree: true };
        await fill(p.app, p.a, v);
        const before = await facts(p.app, p.a);
        await pressSend(p.app, p.a);
        await expect.poll(async () => (await standInCalls(p.app)).length, { message: `${ex.screen}, failed: the send was tried`, timeout: 5_000 }).toBe(1);
        await expect.poll(async () => (await facts(p.app, p.a)).busy, { message: `${ex.screen}, failed: the button is not left busy`, timeout: 5_000 }).toBe(false);
        await sleep(300);
        const after = await facts(p.app, p.a);
        expect((await standInCalls(p.app)).length, `${ex.screen}, failed: the send was tried once`).toBe(1);
        expect(after.confirm, `${ex.screen}, failed: no confirmation`).toBe(false);
        expect(await p.app.locator(p.a).evaluate((r, t) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').includes(t), k.title), `${ex.screen}, failed: "${k.title}" shows nowhere`).toBe(false);
        expect(after.form, `${ex.screen}, failed: the form stays`).toBe(true);
        expect(after.controls.map((c) => `${c.label}=${c.value}`), `${ex.screen}, failed: every value stays as typed`).toEqual(before.controls.map((c) => `${c.label}=${c.value}`));
        expect(after.pressed, `${ex.screen}, failed: the chips and slots stay as picked`).toEqual(before.pressed);
        expect(after.busy, `${ex.screen}, failed: the button is not left busy`).toBe(false);
      });
    }
  });

  // ---------------------------------------------------------------- AC-6
  test('AC-6 nothing leaves the browser: the gallery asks no host but the app and Google Fonts; no typed value is written to localStorage, sessionStorage, cookies or the console, or carried by any request', async ({ page, browser, baseURL }) => {
    test.setTimeout(8 * 60_000);
    const d = deviceOf(page);
    const app = new URL(baseURL!).host;
    const typed = { name: 'Sipho Dlamini-Fifteen', email: 'sipho.fifteen@gmail.com', company: 'Umthombo Fifteen Traders', note: 'Fifteen note line' };
    const SECRETS = [typed.name, typed.email, typed.company, typed.note, 'sipho.fifteen', 'Umthombo'];
    for (const answer of ['sent', 'failed'] as const) {
      const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, isMobile: d === 'phone', hasTouch: d === 'phone', deviceScaleFactor: d === 'phone' ? 2 : 1, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg' });
      const requests: Array<{ url: string; body: string; method: string; type: string }> = [];
      const live: typeof requests = [];
      const consoleLines: string[] = [];
      ctx.on('request', (r) => requests.push({ url: r.url(), body: r.postData() ?? '', method: r.method(), type: r.resourceType() }));
      await ctx.addInitScript(standInScript, [answer, 200] as [string, number]);
      try {
        const p = await ctx.newPage();
        p.on('console', (m) => consoleLines.push(m.text()));
        p.on('pageerror', (err) => consoleLines.push(String(err)));
        await p.clock.setFixedTime(FROZEN);
        for (const k of KINDS) {
          const ex = exampleOf(d, k.empty);
          await gotoForms(p, [ex.id]);
          const s = appStage(ex);
          const from = requests.length;
          await pressSend(p, s);
          await fill(p, s, { name: typed.name, email: 'sipho.fifteen@', company: typed.company, ...(k.kind === 'get-started' ? { role: 'Administrator', size: '1 to 50' } : { note: typed.note }), chips: ['Recruitment'], day: 'Fri 20 Nov', time: '15:00' });
          await pressSend(p, s);
          await fill(p, s, { email: typed.email, agree: true });
          await pressSend(p, s);
          await sleep(1200);
          live.push(...requests.slice(from));
          const f = await p.evaluate(formFacts, s);
          expect(f.confirm, `control (${k.empty}, answer ${answer}): the send ${answer === 'sent' ? 'reached the confirmation' : 'was tried and the form stayed'}`).toBe(answer === 'sent');
          expect((await standInCalls(p)).length, `control (${k.empty}, answer ${answer}): the stand-in was called once`).toBe(1);
          const stored = await p.evaluate(() => {
            const dump = (st: Storage) => Array.from({ length: st.length }, (_, i) => `${st.key(i)}=${st.getItem(st.key(i)!)}`);
            return { local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie };
          });
          const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`);
          const hit = (xs: string[]) => xs.filter((x) => SECRETS.some((sv) => decodeURIComponent(x).includes(sv)));
          expect(hit(stored.local), `${k.empty} (${answer}): nothing typed is in localStorage`).toEqual([]);
          expect(hit(stored.session), `${k.empty} (${answer}): nothing typed is in sessionStorage`).toEqual([]);
          expect(hit([stored.cookie, ...cookies]), `${k.empty} (${answer}): nothing typed is in a cookie`).toEqual([]);
        }
      } finally { await ctx.close(); }
      const hosts = [...new Set(requests.map((r) => new URL(r.url).host).filter((h) => h))];
      expect(hosts.filter((h) => h !== app && h !== 'fonts.googleapis.com' && h !== 'fonts.gstatic.com'), `(${answer}) no request to any host but the app (${app}) and Google Fonts`).toEqual([]);
      // Lock check T3: a host check lets a call to the app's own host through (a relative /api path, a POST with no typed value). From the first Send on, nothing but files is fetched: no POST or other write, no fetch, XHR, beacon, event stream, socket or page load.
      expect(live.filter((r) => !/^(GET|HEAD)$/.test(r.method) || ['fetch', 'xhr', 'ping', 'eventsource', 'websocket', 'document'].includes(r.type)).map((r) => `${r.method} ${r.type} ${r.url}`), `(${answer}) while the forms are used nothing is sent: no POST, fetch, XHR, beacon or page load`).toEqual([]);
      expect(requests.filter((r) => SECRETS.some((sv) => decodeURIComponent(r.url).includes(sv) || r.body.includes(sv))).map((r) => r.url), `(${answer}) no request carries a typed value`).toEqual([]);
      expect(consoleLines.filter((l) => SECRETS.some((sv) => l.includes(sv))), `(${answer}) nothing typed is written to the console`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-7
  test('AC-7 no public route: /book-a-demo and /get-started show the not-found page; no route file names them; the build has no page for them', async ({ page }) => {
    once('reads the routes and the build once');
    test.setTimeout(25 * 60_000);
    // The forms exist (in the gallery), so this is not judged on a site that has none (no vacuous pass on develop).
    await page.clock.setFixedTime(FROZEN);
    await gotoForms(page, [exampleOf('desktop', 'Get started, empty').id, exampleOf('desktop', 'Book a demo, empty').id]);
    expect(await page.locator('form .pp-site-form-card__submit, form button[type="submit"]').count(), `${ROUTE} holds both forms`).toBe(2);
    const view = async (path: string) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.locator('main').first().waitFor({ state: 'attached', timeout: 20_000 });
      return { path: new URL(page.url()).pathname, title: await page.title(), main: (await page.locator('main').first().innerHTML()).replace(/\s+/g, ' ').replace(/ _ng\w+(-\w+)?="[^"]*"/g, ''), forms: await page.locator('form, .pp-site-form-card, .pp-site-confirm').count() };
    };
    const missing = await view('/site-15-no-such-page');
    for (const path of ['/book-a-demo', '/get-started']) {
      const v = await view(path);
      expect(v.path, `${path} stays where it is (no redirect)`).toBe(path);
      expect(v.forms, `${path} shows no form`).toBe(0);
      expect({ title: v.title, main: v.main }, `${path} shows the not-found page (as /site-15-no-such-page does)`).toEqual({ title: missing.title, main: missing.main });
    }
    const web = join(__dirname, '..', '..');
    for (const f of ['site.routes.ts', 'app.routes.ts', 'app.routes.server.ts']) {
      const src = stripComments(readFileSync(join(web, 'src', 'app', f), 'utf8'));
      expect(src.match(/['"`/](book-a-demo|get-started)['"`/]/g) ?? [], `src/app/${f} has no book-a-demo or get-started route`).toEqual([]);
    }
    const out = builtSite();
    const files = filesOf(out);
    expect(files.length, 'the build wrote its output').toBeGreaterThan(5);
    expect(files.filter((f) => /(^|\/)(book-a-demo|get-started)(\/|\.html$|$)/.test(f)), 'the build has no prerendered page for /book-a-demo or /get-started').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-8
  test('AC-8 phone and accessibility: at 390 one column, the card right after the lead and facts, the next steps after it; every button and heading visible and not under the header; axe finds no violation on each example and on the live error and sent states; one h1', async ({ page, browser, baseURL }) => {
    test.setTimeout(12 * 60_000);
    const e = envOf(page, browser, baseURL);
    const d: Device = deviceOf(page);
    const axe = async (p: Page, scope: string) => (await new AxeBuilder({ page: p }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
    for (const ex of formExamples(d)) {
      await using(pairOf(e, ex), async (p) => {
        await scrollThrough(p.app, p.a); await scrollThrough(p.kit, p.k);
        expect(await p.app.locator(p.a).locator('h1').count(), `${ex.screen}: one h1`).toBe(1);
        const a = await p.app.evaluate(layoutFacts, p.a), k = await p.kit.evaluate(layoutFacts, p.k);
        expect(k.bad, `${ex.screen}: control: on the kit every button and heading is visible and clear of the header`).toEqual([]);
        expect(a.bad, `${ex.screen}: every button and heading is visible, inside the width and not under the header`).toEqual([]);
        if (d === 'phone') {
          expect(a.intro && a.card && a.next && a.facts && a.lead, `${ex.screen}: the page top, the card and the next steps are there`).toBeTruthy();
          const one = Math.abs(a.card!.left - a.intro!.left) <= 1 && Math.abs(a.next!.left - a.intro!.left) <= 1;
          expect(one, `${ex.screen}: one column (intro, card and next steps start at the same left edge)`).toBe(true);
          expect(a.card!.top >= a.facts!.bottom - 0.5 && a.card!.top >= a.lead!.bottom - 0.5, `${ex.screen}: the card comes after the lead and the facts`).toBe(true);
          expect(Math.abs((a.card!.top - a.facts!.bottom) - (k.card!.top - k.facts!.bottom)) <= 1, `${ex.screen}: right after them, as the kit (gap ${(a.card!.top - a.facts!.bottom).toFixed(1)}px, kit ${(k.card!.top - k.facts!.bottom).toFixed(1)}px)`).toBe(true);
          expect(a.next!.top >= a.card!.bottom - 0.5, `${ex.screen}: the next steps come after the card`).toBe(true);
          expect(await p.app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${ex.screen}: nothing scrolls sideways at 390`).toBeLessThanOrEqual(0);
        }
        expect(await axe(p.app, p.a), `${ex.screen}: axe (WCAG 2.1 A and AA) finds no violation`).toEqual([]);
      });
    }
    // The live states: errors shown, and sent.
    for (const k of KINDS) {
      await using(pairOf(e, exampleOf(d, k.empty)), async (p) => {
        await pressSend(p.app, p.a);
        await scrollThrough(p.app, p.a);
        expect(await axe(p.app, p.a), `${k.empty} with errors shown: axe finds no violation`).toEqual([]);
        expect((await p.app.evaluate(layoutFacts, p.a)).bad, `${k.empty} with errors shown: every button and heading visible and clear of the header`).toEqual([]);
        await fill(p.app, p.a, await kitSentValues(p));
        await pressSend(p.app, p.a);
        await expect.poll(async () => (await facts(p.app, p.a)).confirm, { message: `${k.empty}: sent`, timeout: 10_000 }).toBe(true);
        await sleep(300);
        expect(await axe(p.app, p.a), `${k.empty} sent: axe finds no violation`).toEqual([]);
        expect(await p.app.locator(p.a).locator('h1').count(), `${k.empty} sent: one h1`).toBe(1);
      });
    }
  });

  // ---------------------------------------------------------------- AC-9
  test('AC-9 nothing else changes: only the site folder, app.routes.ts (the gallery route) and the site tests (SITE-09 AC-12 rule without its public-page and public-route files, plus app.routes.ts for the gallery); /sign-in and /hr load no site code', async ({ page, signIn, hr }) => {
    once('reads the repository and the pages once');
    test.setTimeout(10 * 60_000);
    // The rule itself, on tables: what a builder's pull request may change, and what is always refused.
    const builder = ['src/app/ds/site/forms/site-form-sender.ts', 'src/app/ds/site/forms/form-card.ts', 'src/app/ds/site/forms/forms.gallery.ts', 'src/app/ds/site/forms/working-days.spec.ts', 'src/app/ds/site/index.ts', 'src/app/app.routes.ts', 'e2e/acceptance/site-15.spec.ts', 'e2e/acceptance/support/site-15/forms.ts', 'e2e/acceptance/cards/site-15.md', 'e2e/acceptance/site-10.spec.ts'];
    expect(outside(builder), 'the rule accepts a plausible builder file set').toEqual([]);
    const never = ['src/app/ds/all.ts', 'src/app/features/hr/hr-shell.ts', 'src/app/features/sign-in/sign-in.ts', 'src/app/core/auth.ts', 'src/app/ds/README.md', 'src/app/ds/site/../../core/auth.ts', 'src/app/app.routes.tsx', 'package.json', 'angular.json', 'src/styles.css', 'src/styles/design-system/site.css', 'scripts/verify-public-names.mjs', 'e2e/acceptance/onb-09.spec.ts', 'e2e/acceptance/.output/.last-run.json', 'e2e/acceptance/support/site-15', 'e2e/acceptance/site-015.spec.ts', 'e2e/acceptance/cards/site-15.md.bak', 'src/app/features/publicity/x.ts', 'src/app/core/site-form-sender.ts', 'src/environments/environment.ts', 'src/app/site.routes.ts', 'src/app/app.routes.server.ts', 'src/app/features/public/book-a-demo/book-a-demo.page.ts', 'src/app/features/public/public.ts'];
    expect(outside(never).length, 'the rule refuses every path of the must-reject table').toBe(never.length);
    expect(never.filter((f) => allowed(f) && !refused(f) && !/\.\./.test(f)), 'none of them is in the allow-list unless a refusal catches it').toEqual([]);
    // The state of the repository, whatever the diff (no skip here, so develop fails this): the forms, the sender interface and the gallery route.
    const web = join(__dirname, '..', '..');
    const dir = join(web, ...FORMS_DIR);
    const ts = existsSync(dir) ? (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[]).filter((f) => /\.ts$/.test(f) && !/\.spec\.ts$/.test(f)) : [];
    expect(ts.length, 'src/app/ds/site/forms/ holds at least one .ts file that is not a spec (the forms are built there)').toBeGreaterThan(0);
    const code = ts.map((f) => stripComments(readFileSync(join(dir, f), 'utf8'))).join('\n');
    expect(code, 'src/app/ds/site/forms/ declares SiteFormSender (decision 2)').toMatch(/(interface|abstract class|class|type)\s+SiteFormSender\b/);
    expect(code, 'SiteFormSender has send(kind, values) answering \'sent\' or \'failed\'').toMatch(/send\s*\(\s*\w+\s*:[^)]*,\s*\w+\s*:[^)]*\)\s*:\s*Promise<\s*['"](sent|failed)['"]\s*\|\s*['"](sent|failed)['"]\s*>/);
    // Nothing is sent in this card (spec decision 2: the real sender is the later card's): the forms folder holds no network, storage, cookie, Cognito or signed-in-code call at all, so a real sender cannot hide behind a stand-in that the gallery happens to use (lock check T3).
    const NET = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|HttpClient|@angular\/common\/http|\bWebSocket\b|\bEventSource\b|\blocalStorage\b|\bsessionStorage\b|document\.cookie|\bindexedDB\b|aws-amplify|@aws-sdk|cognito|from\s+['"](\.\.\/)+(core|features|environments)\//gi;
    expect(code.match(NET) ?? [], 'src/app/ds/site/forms/ makes no network call, writes no storage or cookie and imports no signed-in or Cognito code (the stand-in answers; the real sender is a later card)').toEqual([]);
    const routes = stripComments(readFileSync(join(web, 'src', 'app', 'app.routes.ts'), 'utf8'));
    expect(routes, 'app.routes.ts holds a lazy dev/site-forms route that loads the site stylesheet').toMatch(/path:\s*'dev\/site-forms'[^}]*loadComponent[^}]*canActivate:\s*\[\s*siteStyles\s*\]|path:\s*'dev\/site-forms'[^}]*canActivate:\s*\[\s*siteStyles\s*\][^}]*loadComponent/);
    // Signed-in pages load no site code.
    const loaded: Array<Promise<{ url: string; text: string }>> = [];
    page.context().on('response', (r) => {
      const js = /javascript|ecmascript/.test(r.headers()['content-type'] ?? '') || /\.m?js(\?|$)/.test(new URL(r.url()).pathname);
      if (r.request().resourceType() === 'script' || js) loaded.push(r.text().then((text) => ({ url: r.url(), text }), () => ({ url: r.url(), text: '' })));
    });
    const carriers = async (where: string) => (await Promise.all(loaded.splice(0))).filter((x) => /pp-site-|ppSite|PpSite|DemoClock|SiteFormSender/.test(x.text)).map((x) => `${where}: ${new URL(x.url).pathname}`);
    await signIn.open();
    await page.waitForLoadState('networkidle');
    expect(await carriers('/sign-in'), 'no script that /sign-in loads holds site code').toEqual([]);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    expect(await carriers('/hr'), 'no script that /hr loads holds site code').toEqual([]);
    // The file rule: only when this pull request changes a file of this card (another card's pull request has nothing to judge here).
    const changed = changedFiles();
    test.skip(!changed.some(isThisCard), 'this pull request changes none of the forms\' files');
    expect(outside(changed), 'this card changes only the site folder, app.routes.ts (the gallery route) and the site tests: no public page, no public route, no prerender entry').toEqual([]);
    expect(changed.filter(refused), 'ds/all.ts, the signed-in features, the public pages and the public route files are untouched').toEqual([]);
  });
});
void sleep;
