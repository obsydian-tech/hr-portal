import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, test as base, expect, HR_HOME } from './support/fixtures';
import { EXPIRED_BODY, GuestFake, Watch, talentFlowOrigin, type GuestAnswer, type Rating } from './support/rec-ui-03/guest-fake';
import { KIT } from './support/rec-ui-03/kit';

/**
 * REC-UI-03 step 1 · The guest scoring page (Jira NH-229, epic NH-223, red: a public page reached by a link).
 * Spec: onboarding-cards/specs/REC-UI-03.md rules 4 and 5, AC-3 (phone), AC-5 to AC-8, AC-12 and AC-13 for this page, and
 * AC-14's guest part; REC-UI-00.md. The backend is REC-07's (PR 501): GET and POST /v1/scoring-links/{token}, one 410 answer
 * for an expired, used, unknown or malformed link. Where the card is silent, cards/rec-ui-03.md fixes what these tests assume
 * (decisions D-RUI-03.4 to D-RUI-03.10); the builder implements exactly that.
 *
 * The link is `/score#token=<token>` (D-RUI-03.4, as the set-password link of ONB-17): the token travels in the address
 * fragment, which no browser sends to a server or in a Referer. The page reads it, takes it out of the address
 * (`/score`, D-RUI-03.1) before it sends anything, then calls the API with it.
 *
 * Not in this lock (their backend is not built, so a test would judge a pretend server): the panel member's feedback sheet
 * (rules 1 to 3, AC-1 to AC-4: no read of one interview by its id), the hiring manager's page (rules 6 to 8, AC-9 to AC-11:
 * no tasks route, gap G-10; can_decide is REC-15 step C). Each comes as a child lock rec-ui-03.N when its backend merges.
 *
 * Every test runs at 1280 and 390 wide unless it says why not. AC-14 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- words (kit, approved group D, settled U-1, rule 7a)

const W = {
  title: (first: string, last: string) => `Interview feedback for ${first} ${last}`,
  expires: (date: string) => `This link expires ${date}.`,
  submit: 'Submit feedback',
  done: 'Thank you. Your feedback is saved with your name and the time.',
  // D-RUI-03.6 (rule 7a, U-1 pattern): one state for every refused link; load and save failures.
  notFound: 'This link could not be found.',
  loadFailed: 'Interview feedback could not be loaded.',
  tryAgain: 'Try again',
  saveFailed: 'Your change could not be saved. Try again.',
  decision: 'Decision',
  notes: 'Notes',
  optional: '(optional)',
};
const SCALE = ['1 out of 5, poor', '2 out of 5, fair', '3 out of 5, good', '4 out of 5, strong', '5 out of 5, excellent'];
const DECISIONS: Array<{ label: string; help: string; code: Rating }> = [
  { label: 'Strong no', help: 'Do not hire, and say why', code: 'STRONG_NO' },
  { label: 'No', help: 'Not this time', code: 'NO' },
  { label: 'Yes', help: 'Hire', code: 'YES' },
  { label: 'Strong yes', help: 'Hire, and move fast', code: 'STRONG_YES' },
];
// D-RUI-03.7: the Standard pack's interview types, in sentence case as the kit writes them; anything else in sentence case.
const TYPES: Array<[string, string]> = [
  ['PHONE_SCREEN', 'Phone screen'], ['TECHNICAL', 'Technical'], ['BEHAVIORAL', 'Behavioral'], ['CULTURE_FIT', 'Culture fit'], ['FINAL', 'Final'],
  ['PANEL_REVIEW', 'Panel review'],
];
/** Words that must never show on this page (REC-UI-03 AC-12, LESSONS words rules). */
const NEVER = [/Masked/i, /Provisioning/i, /Evaluation/i, /out of 10/i, /average/i, /Ask .* for a new one/i, /\{HR name\}/, /expired/i, /Batsi/i, /Claude/i];

// ---------------------------------------------------------------- the links

const tok = (tag: string) => `${tag}${'x'.repeat(Math.max(0, 32 - tag.length))}`.replace(/[^A-Za-z0-9_-]/g, '_');
const T = {
  good: tok('goodLinkBongani7Kq2'),
  second: tok('secondLinkLerato5Wp8'),
  edge: tok('edgeOfDayLink3Zr4'),
  noRole: tok('noRoleLink6Hs2'),
  loose: tok('looseAnswerLink9Td1'),
  expired: tok('expiredLink2Fv7'),
  used: tok('usedLink8Gb3'),
  unknown: tok('neverIssuedLink4Nc6'),
  malformed: 'not.a.token!',
};
const CRITERIA = [
  { key: 'forklift_safety', label: 'Forklift safety' },
  { key: 'route_planning', label: 'Route planning' },
  { key: 'communication', label: 'Communication' },
];
const ANSWER: GuestAnswer = {
  candidate_first: 'Bongani',
  candidate_last: 'Mthembu',
  role_title: 'Fleet controller',
  interview_type: 'TECHNICAL',
  interview_at: '2026-11-03T08:00:00.000Z',
  criteria: CRITERIA,
  expires_at: '2026-11-10T08:00:00.000Z',
};
const LINE = 'Fleet controller · Technical interview on 3 Nov 2026';
const EXPIRES = W.expires('10 Nov 2026');
const SECOND: GuestAnswer = {
  candidate_first: 'Lerato',
  candidate_last: 'Mokoena',
  role_title: 'Warehouse supervisor',
  interview_type: 'CULTURE_FIT',
  interview_at: '2026-11-05T12:00:00.000Z',
  criteria: [{ key: 'teamwork', label: 'Teamwork' }, { key: 'reliability', label: 'Reliability' }],
  expires_at: '2026-11-12T12:00:00.000Z',
};

// ---------------------------------------------------------------- fixtures and helpers

type Fixtures = { guest: GuestFake | null; watch: Watch; appOrigin: string };
const test = base.extend<Fixtures>({
  appOrigin: async ({ baseURL }, use) => { await use(new URL(baseURL!).origin); },
  guest: async ({ context, appOrigin }, use) => {
    if (ON_DEV) return use(null);
    const fake = new GuestFake(appOrigin);
    await fake.install(context);
    await use(fake);
    expect(fake.contractErrors, 'every answer the fake gave matches api/openapi.yaml').toEqual([]);
    expect(fake.strayHosts, 'no scoring call went to a host other than the TalentFlow API').toEqual([]);
  },
  watch: [async ({ page }, use) => {
    const w = new Watch();
    w.track(page);
    await use(w);
    expect(w.pageErrors, 'no uncaught error in the page').toEqual([]);
  }, { auto: true }],
});

const phone = () => test.info().project.name === 'phone-390';
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const once = (why: string) => test.skip(phone(), `Once, at 1280: ${why}`);

const linkFor = (token: string) => `/score#token=${encodeURIComponent(token)}`;
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const submit = (page: Page) => page.getByRole('button', { name: W.submit, exact: true });
const sliders = (page: Page) => page.getByRole('slider');
const radios = (page: Page) => page.getByRole('radio');
const notes = (page: Page) => page.getByRole('textbox', { name: /^Notes/ });

/**
 * Opens a link the way a guest does from the email: a fresh page load (never a jump inside the page already open), and waits
 * until the page has settled on a form, the one refusal state or the load failure.
 */
async function open(page: Page, token: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(linkFor(token));
  await expect(heading(page).or(page.getByText(W.notFound, { exact: true })).or(page.getByText(W.loadFailed, { exact: true })).first()).toBeVisible();
}

async function openForm(page: Page, token: string, answer: GuestAnswer = ANSWER): Promise<void> {
  await open(page, token);
  await expect(heading(page)).toHaveText(W.title(answer.candidate_first, answer.candidate_last));
  await expect(sliders(page)).toHaveCount(answer.criteria.length);
}

/** The label a radio is shown with, and its helper line (from aria-describedby). */
async function radioTexts(page: Page): Promise<Array<{ label: string; help: string; checked: boolean }>> {
  return radios(page).evaluateAll((els) => els.map((el) => {
    const input = el as HTMLInputElement;
    const help = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    const full = (input.labels?.[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return { label: full.replace(help, '').trim(), help, checked: input.checked };
  }));
}

/** Each slider's label, its value words as shown next to it, and as read out. */
async function sliderTexts(page: Page): Promise<Array<{ label: string; shown: string; spoken: string | null }>> {
  return sliders(page).evaluateAll((els) => els.map((el) => {
    const input = el as HTMLInputElement;
    const field = input.closest('.pp-slider') ?? input.parentElement!;
    return {
      label: (input.labels?.[0]?.textContent ?? '').trim(),
      shown: (field.querySelector('output')?.textContent ?? '').trim(),
      spoken: input.getAttribute('aria-valuetext'),
    };
  }));
}

async function setScore(page: Page, label: string, value: number): Promise<void> {
  const s = page.getByRole('slider', { name: label, exact: true });
  await s.fill(String(value));
}

async function decide(page: Page, label: string): Promise<void> {
  const i = DECISIONS.findIndex((d) => d.label === label);
  await radios(page).nth(i).check({ force: true });
}

/** Fills every criterion and the Decision. */
async function fillAll(page: Page, scores: number[], decision: string, criteria = CRITERIA): Promise<void> {
  for (const [i, c] of criteria.entries()) await setScore(page, c.label, scores[i]!);
  await decide(page, decision);
}

/** Everything the page stores, for the token check. */
async function everythingStored(page: Page): Promise<string> {
  const inPage = await page.evaluate(async () => {
    const values: string[] = [];
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) { const k = store.key(i) ?? ''; values.push(k, store.getItem(k) ?? ''); }
    }
    values.push(document.cookie, JSON.stringify(history.state ?? null));
    try { values.push(...((await indexedDB.databases()).map((d) => d.name ?? ''))); } catch { /* none */ }
    try { values.push(...(await caches.keys())); } catch { /* none */ }
    return values.join('\n');
  });
  const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('\n');
  return `${inPage}\n${cookies}`;
}

/**
 * AC-8 on every path, not only the happy one: the address is /score, and the token (raw or encoded) is in no console line or
 * page error, no storage, cookie or history state, not in the markup, and in no request but the scoring calls' own path.
 */
async function expectNoTokenAnywhere(page: Page, watch: Watch, token: string, where: string): Promise<void> {
  const u = new URL(page.url());
  expect([u.pathname, u.search, u.hash], `${where}: the address is /score, no query, no fragment`).toEqual(['/score', '', '']);
  await watch.settled();
  const stored = await everythingStored(page);
  const html = await page.content();
  for (const f of [...new Set([token, encodeURIComponent(token)])]) {
    expect(watch.console.filter((l) => l.includes(f)), `${where}: no console line or page error has the token`).toEqual([]);
    expect(stored, `${where}: no storage, cookie, cache name or history state has the token`).not.toContain(f);
    expect(html, `${where}: the markup holds no token`).not.toContain(f);
    for (const r of watch.requests) {
      const url = new URL(r.url);
      const own = /^\/v1\/scoring-links\/[^/]+$/.test(url.pathname) && ['GET', 'POST', 'OPTIONS'].includes(r.method);
      if (!own) expect(r.url, `${where}: only the scoring calls carry the token (${r.method} ${r.url})`).not.toContain(f);
      expect(url.search, `${where}: no token in the query of ${r.method} ${r.url}`).not.toContain(f);
      for (const [name, value] of Object.entries(r.headers)) expect(value, `${where}: no token in header ${name} of ${r.method} ${r.url}`).not.toContain(f);
      expect(r.postData ?? '', `${where}: no token in the body of ${r.method} ${r.url}`).not.toContain(f);
    }
  }
}

/** The page's visible state, for the identical-refusal check: text, and the markup with the token's own run noise taken out. */
async function snapshot(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerHTML.replace(/\s+/g, ' '));
}

// ================================================================ AC-5 Guest page content (rule 4)
test.describe('AC-5 Guest page content', () => {
  test.beforeEach(noBackendOnly);

  test('AC-5 A valid link shows the title, the role and interview line, the expiry line, one slider per criterion of the link in its order, the four Decisions with their helper lines, Notes and Submit feedback', async ({ page, guest, watch }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await expect(heading(page)).toHaveText(W.title('Bongani', 'Mthembu'));
    await expect(page.getByText(LINE, { exact: true })).toBeVisible();
    await expect(page.getByText(EXPIRES, { exact: true })).toBeVisible();
    const s = await sliderTexts(page);
    expect(s.map((x) => x.label), 'one slider per criterion of the link, in the answer\'s order, labelled with its label').toEqual(CRITERIA.map((c) => c.label));
    for (const slider of await sliders(page).all()) {
      await expect(slider).toHaveAttribute('min', '1');
      await expect(slider).toHaveAttribute('max', '5');
      await expect(slider).toHaveAttribute('step', '1');
    }
    await expect(page.getByText(W.decision, { exact: true })).toBeVisible();
    expect((await radioTexts(page)).map((r) => ({ label: r.label, help: r.help })), 'Decision: the four options in order, each with the kit\'s helper line').toEqual(DECISIONS.map((d) => ({ label: d.label, help: d.help })));
    await expect(notes(page)).toBeVisible();
    await expect(page.getByText(W.optional, { exact: true })).toBeVisible();
    await expect(submit(page)).toBeVisible();
    // Not on the guest page: the panel sheet's decider line and Cancel (the answer names no decider), and nothing to sign in with.
    await expect(page.getByText(/^Scores are advice\./)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await watch.settled();
    expect(watch.console.filter((l) => /error/i.test(l)), 'no console error').toEqual([]);
  });

  test('AC-5 The criteria are the link\'s own: another link with other criteria shows those, never a default set', async ({ page, guest }) => {
    guest!.add(T.second, SECOND);
    await openForm(page, T.second, SECOND);
    expect((await sliderTexts(page)).map((x) => x.label)).toEqual(['Teamwork', 'Reliability']);
    await expect(page.getByText('Warehouse supervisor · Culture fit interview on 5 Nov 2026', { exact: true })).toBeVisible();
    await expect(page.getByText(W.expires('12 Nov 2026'), { exact: true })).toBeVisible();
    for (const c of CRITERIA) await expect(page.getByText(c.label, { exact: true })).toHaveCount(0);
  });

  test('AC-5 Each scale word is the approved one: moving a slider to 1 to 5 shows "n out of 5, word" next to it and reads it out', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    for (let v = 1; v <= 5; v++) {
      await setScore(page, 'Route planning', v);
      const row = (await sliderTexts(page)).find((x) => x.label === 'Route planning')!;
      expect([row.shown, row.spoken], `value ${v}`).toEqual([SCALE[v - 1], SCALE[v - 1]]);
    }
  });

  test('AC-5 Every interview type reads as words: the Standard pack\'s five in sentence case, and an unknown code in sentence case, never a raw code', async ({ page, guest }) => {
    for (const [code, words] of TYPES) {
      const t = tok(`type${code.replace(/_/g, '')}`);
      guest!.add(t, { ...ANSWER, interview_type: code });
      await openForm(page, t);
      await expect(page.getByText(`Fleet controller · ${words} interview on 3 Nov 2026`, { exact: true }), code).toBeVisible();
      await expect(page.getByText(new RegExp(code)), `${code} never shows as a code`).toHaveCount(0);
    }
  });

  test('AC-5 With no role title the line starts at the interview type, with no empty part or stray separator', async ({ page, guest }) => {
    guest!.add(T.noRole, { ...ANSWER, role_title: null });
    await openForm(page, T.noRole);
    await expect(page.getByText('Technical interview on 3 Nov 2026', { exact: true })).toBeVisible();
    await expect(page.getByText(/^\s*·|null|undefined/)).toHaveCount(0);
  });

  test.describe('dates are Johannesburg dates, wherever the guest is', () => {
    test.use({ timezoneId: 'America/New_York' });
    test('AC-5 An interview at 01:30 and a link ending at 00:30 Johannesburg time show Johannesburg\'s day, for a guest whose clock is in New York', async ({ page, guest }) => {
      guest!.add(T.edge, { ...ANSWER, interview_at: '2026-11-02T23:30:00.000Z', expires_at: '2026-11-09T22:30:00.000Z' });
      await openForm(page, T.edge);
      await expect(page.getByText(LINE, { exact: true }), 'the interview day in Johannesburg (2 Nov in UTC and New York)').toBeVisible();
      await expect(page.getByText(EXPIRES, { exact: true }), 'the last day in Johannesburg (9 Nov in UTC and New York)').toBeVisible();
    });
  });

  test('AC-5 The page shows only the listed fields: an answer that also carried an email, a phone, an ID number, a salary, a company id, an HR name or other votes shows none of them', async ({ page, guest }) => {
    const extra = {
      candidate_email: 'bongani.mthembu@example.test',
      candidate_phone: '082 555 0199',
      id_number: '9001015800087',
      salary: 'R 485 000',
      tenant_id: 'tnt-a-4c1e9b27',
      hr_name: 'Thandi Dube',
      votes: [{ voter: 'Sipho Ndlovu', rating: 'YES', scores: { forklift_safety: 4 } }],
      other_candidate: 'Lerato Mokoena',
    };
    guest!.addLoose(T.loose, { ...ANSWER, ...extra });
    await openForm(page, T.loose);
    const text = await page.locator('body').innerText();
    const html = await page.content();
    for (const v of ['bongani.mthembu@example.test', '082 555 0199', '0825550199', '9001015800087', 'R 485 000', '485', 'tnt-a-4c1e9b27', 'Thandi', 'Sipho', 'Lerato']) {
      expect(text, `the page shows no "${v}"`).not.toContain(v);
      expect(html, `the page holds no "${v}" anywhere in its markup`).not.toContain(v);
    }
  });

  test('AC-5 No shell: no side navigation, top bar, account menu, Modules button, Ask Batsi, search or notifications', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    for (const name of ['Modules', 'Ask Batsi', 'Open menu']) await expect(page.getByRole('button', { name, exact: true }), name).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Your account/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(0);
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expect(await page.locator('.pp-app-shell, .pp-side-navigation, .pp-top-navigation, .pp-avatar, pp-app-shell, pp-side-navigation, pp-top-navigation').count(), 'no shell part').toBe(0);
  });

  test('AC-5 A second link opened in the same tab, without a page load, never shows the first link\'s candidate or criteria', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await setScore(page, 'Forklift safety', 4);
    // The guest opens a second link (refused) in the same tab: the fragment changes, the page does not load again.
    await page.evaluate((t) => { location.hash = `token=${t}`; }, T.expired);
    await expect(page.getByText(W.notFound, { exact: true })).toBeVisible();
    const text = await page.locator('body').innerText();
    for (const v of ['Bongani', 'Mthembu', 'Fleet controller', 'Forklift safety', '10 Nov 2026']) expect(text, `nothing of the first link: ${v}`).not.toContain(v);
    await expect(sliders(page)).toHaveCount(0);
    await expect(submit(page)).toHaveCount(0);
    expect(guest!.gets().map((g) => g.token), 'the second link was asked for').toEqual([T.good, T.expired]);
    // And the other way round: a refused link, then a good one, shows the good one.
    await page.evaluate((t) => { location.hash = `token=${t}`; }, T.good);
    await expect(heading(page)).toHaveText(W.title('Bongani', 'Mthembu'));
    await expect(page.getByText(W.notFound, { exact: true })).toHaveCount(0);
    expect((await sliderTexts(page)).length).toBe(3);
  });
});

// ================================================================ AC-3 phone part, AC-5: at 390 wide
test.describe('AC-3 The guest page at both widths', () => {
  test.beforeEach(noBackendOnly);

  test('AC-3 At 1280 and 390 wide the heading, every slider, the Decisions, Notes and Submit feedback are visible, not covered or clipped, and the page does not scroll sideways', async ({ page, guest }) => {
    const width = page.viewportSize()!.width;
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    const parts: Locator[] = [heading(page), page.getByText(LINE, { exact: true }), page.getByText(EXPIRES, { exact: true }), ...(await sliders(page).all()), ...(await radios(page).all()), notes(page), submit(page)];
    for (const el of parts) {
      await el.scrollIntoViewIfNeeded();
      await expect(el).toBeInViewport({ ratio: 0.99 });
      const box = (await el.boundingBox())!;
      expect(box.x, 'starts inside the screen').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'ends inside the screen').toBeLessThanOrEqual(width + 0.5);
      // Not covered: the element (or a part of it) is what the page shows at its own centre.
      const own = await el.evaluate((node) => {
        // A cover that lets clicks through (pointer-events: none) still hides what is under it: count it as a cover.
        const all = document.createElement('style');
        all.textContent = '* { pointer-events: auto !important; }';
        document.head.appendChild(all);
        try {
        const r = node.getBoundingClientRect();
        const target = node instanceof HTMLInputElement && node.type === 'radio' ? (node.labels?.[0] ?? node) : node;
        const tr = target.getBoundingClientRect();
        const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
        return !!hit && (target.contains(hit) || hit.contains(target) || (node instanceof HTMLInputElement && node.labels?.[0]?.contains(hit) === true)) && r.width > 0;
        } finally { all.remove(); }
      });
      expect(own, 'nothing covers it').toBe(true);
    }
    // No sideways scroll: neither the document nor the scrolling box the page sits in is wider than the screen.
    const wide = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth,
      ...[...document.querySelectorAll('body *')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowX)).map((e) => e.scrollWidth - e.clientWidth + Math.min(e.clientWidth, w))), width);
    expect(wide, 'no sideways scroll').toBeLessThanOrEqual(width);
  });

  test('AC-3 On a phone the guest can score with touch and the keyboard: a tap on a Decision tile picks it, the arrow keys move a slider by one', async ({ page, guest }) => {
    test.skip(!phone(), 'Phone only.');
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    const s = page.getByRole('slider', { name: 'Communication', exact: true });
    await s.fill('3');
    await s.focus();
    await page.keyboard.press('ArrowRight');
    expect((await sliderTexts(page)).find((x) => x.label === 'Communication')!.shown).toBe(SCALE[3]);
    const id = await radios(page).nth(3).getAttribute('id');
    await page.locator(`label[for="${id}"]`).tap();
    expect((await radioTexts(page)).map((r) => r.checked)).toEqual([false, false, false, true]);
  });
});

// ================================================================ AC-6 Guest submit (rule 4, AC-1's sheet rules for this page)
test.describe('AC-6 Guest submit', () => {
  test.beforeEach(noBackendOnly);

  test('AC-6 Nothing is chosen at the start, and Submit feedback stays disabled until every criterion and the Decision have a value', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    expect((await radioTexts(page)).map((r) => r.checked), 'no Decision is preselected').toEqual([false, false, false, false]);
    await expect(submit(page), 'nothing set').toBeDisabled();
    await decide(page, 'Yes');
    await expect(submit(page), 'only the Decision').toBeDisabled();
    await setScore(page, 'Forklift safety', 4);
    await setScore(page, 'Route planning', 3);
    await expect(submit(page), 'one criterion left').toBeDisabled();
    // A criterion set to the value the slider starts on still has to be set by the guest: 1 is a score like any other.
    await setScore(page, 'Communication', 1);
    await expect(submit(page), 'all set').toBeEnabled();
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    expect(guest!.posts()[0]!.body.scores).toEqual({ forklift_safety: 4, route_planning: 3, communication: 1 });
    // The disabled button really sends nothing: a fresh link, Decision only, a click (forced) sends no request.
    guest!.add(T.second, SECOND);
    await openForm(page, T.second, SECOND);
    await decide(page, 'No');
    await submit(page).click({ force: true }).catch(() => undefined);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(300);
    expect(guest!.posts().filter((p) => p.token === T.second), 'no POST while a criterion has no value').toHaveLength(0);
    // Every criterion set and no Decision: still disabled, and still nothing sent.
    guest!.add(T.edge, SECOND);
    await openForm(page, T.edge, SECOND);
    await setScore(page, 'Teamwork', 5);
    await setScore(page, 'Reliability', 2);
    await expect(submit(page), 'every criterion set, no Decision').toBeDisabled();
    await submit(page).click({ force: true }).catch(() => undefined);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(300);
    expect(guest!.posts().filter((p) => p.token === T.edge), 'no POST while the Decision has no value').toHaveLength(0);
  });

  test('AC-6 Submit sends one POST to the link with exactly { scores, rating, comment }: whole numbers 1 to 5 for exactly the link\'s criteria, the Decision\'s code, the notes as typed', async ({ page, guest, appOrigin }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await fillAll(page, [5, 2, 4], 'Strong yes');
    await notes(page).fill('Knows the Durban routes well. Needs coaching on the fleet system reports.');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    const posts = guest!.posts();
    expect(posts, 'one POST').toHaveLength(1);
    const p = posts[0]!;
    expect(new URL(p.url).origin, 'to the TalentFlow API').toBe(talentFlowOrigin());
    expect(p.path, 'to this link').toBe(`/v1/scoring-links/${T.good}`);
    expect(p.headers['content-type'] ?? '', 'a JSON body').toMatch(/^application\/json/);
    expect(p.body, 'the contract body and nothing else (no voter, no name, no token, no company)').toEqual({
      scores: { forklift_safety: 5, route_planning: 2, communication: 4 },
      rating: 'STRONG_YES',
      comment: 'Knows the Durban routes well. Needs coaching on the fleet system reports.',
    });
    void appOrigin;
  });

  test('AC-6 Each Decision sends its own code', async ({ page, guest }) => {
    for (const d of DECISIONS) {
      const t = tok(`decision${d.code.replace(/_/g, '')}`);
      guest!.add(t, ANSWER);
      await openForm(page, t);
      await fillAll(page, [3, 3, 3], d.label);
      await submit(page).click();
      await expect(page.getByText(W.done, { exact: true })).toBeVisible();
      expect(guest!.posts().find((x) => x.token === t)!.body.rating, d.label).toBe(d.code);
    }
  });

  test('AC-6 No vote gate: Strong no with every criterion at 5, and Strong yes with every criterion at 1, both submit', async ({ page, guest }) => {
    const cases: Array<[string, number]> = [['Strong no', 5], ['Strong yes', 1]];
    for (const [label, v] of cases) {
      const t = tok(`gate${label.replace(/ /g, '')}${v}`);
      guest!.add(t, ANSWER);
      await openForm(page, t);
      await fillAll(page, [v, v, v], label);
      await expect(submit(page)).toBeEnabled();
      await submit(page).click();
      await expect(page.getByText(W.done, { exact: true })).toBeVisible();
      expect(guest!.posts().find((x) => x.token === t)!.body).toMatchObject({ scores: { forklift_safety: v, route_planning: v, communication: v } });
    }
  });

  test('AC-6 Notes are optional and take at most 2,000 characters: none sends no text, and 2,001 typed never reaches the server as more than 2,000', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await fillAll(page, [2, 2, 2], 'No');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    const first = guest!.posts()[0]!.body;
    expect(first.comment === undefined || first.comment === '', 'empty Notes send no text').toBe(true);
    guest!.add(T.second, SECOND);
    await openForm(page, T.second, SECOND);
    await setScore(page, 'Teamwork', 4);
    await setScore(page, 'Reliability', 4);
    await decide(page, 'Yes');
    await notes(page).fill('a'.repeat(2001));
    expect((await notes(page).inputValue()).length, 'the box holds at most 2,000 characters').toBeLessThanOrEqual(2000);
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true }).or(page.getByText(W.saveFailed, { exact: true }))).toBeVisible();
    for (const p of guest!.posts().filter((x) => x.token === T.second)) expect(String(p.body.comment ?? '').length, 'never more than 2,000 sent').toBeLessThanOrEqual(2000);
  });

  test('AC-6 After success the line is exactly the approved one, the form is gone, and a second visit to the same link shows the one refusal state from a fresh request', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await fillAll(page, [4, 4, 4], 'Yes');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    await expect(sliders(page)).toHaveCount(0);
    await expect(radios(page)).toHaveCount(0);
    await expect(notes(page)).toHaveCount(0);
    await expect(submit(page)).toHaveCount(0);
    expect(guest!.stateOf(T.good)).toBe('used');
    // The guest opens the email link again.
    await open(page, T.good);
    await expect(page.getByText(W.notFound, { exact: true })).toBeVisible();
    await expect(sliders(page)).toHaveCount(0);
    await expect(page.getByText(W.done, { exact: true })).toHaveCount(0);
    expect(guest!.gets().filter((g) => g.token === T.good), 'the second visit asked the server again (nothing kept from the first)').toHaveLength(2);
  });

  test('AC-6 One click, one POST: while the submit is on its way the button cannot send again, and a double click sends once', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await fillAll(page, [3, 4, 5], 'Yes');
    guest!.hold();
    await submit(page).dblclick();
    await expect.poll(() => guest!.posts().length).toBe(1);
    await submit(page).click({ timeout: 1000 }).catch(() => undefined);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(300);
    expect(guest!.posts(), 'still one POST while the first is on its way').toHaveLength(1);
    guest!.release();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    expect(guest!.posts()).toHaveLength(1);
  });

  const FAILURES: Array<[string, Parameters<GuestFake['nextPost']>[0]]> = [
    ['a gateway error (500)', { status: 500, body: { message: 'Internal Server Error' } }],
    ['a throttle (429)', { status: 429, body: { message: 'Too Many Requests' } }],
    ['INVALID_SCORES (400)', { status: 400, body: { error: 'Bad request', code: 'INVALID_SCORES' } }],
    ['the link used up in another tab (410)', { status: 410, body: EXPIRED_BODY }],
    ['a dropped connection', 'abort'],
  ];
  for (const [label, failure] of FAILURES) {
    test(`AC-6 A failed submit (${label}) keeps every value in the form, shows the save failure line, leaks the token nowhere, and the guest can send again`, async ({ page, guest, watch }) => {
      guest!.add(T.good, ANSWER);
      await openForm(page, T.good);
      await fillAll(page, [2, 5, 3], 'No');
      await notes(page).fill('Late for the interview.');
      guest!.nextPost(failure);
      await submit(page).click();
      await expect(page.getByText(W.saveFailed, { exact: true })).toBeVisible();
      await expect(page.getByText(W.done, { exact: true })).toHaveCount(0);
      expect((await sliderTexts(page)).map((x) => x.shown), 'the scores are kept').toEqual([SCALE[1], SCALE[4], SCALE[2]]);
      expect((await radioTexts(page)).map((r) => r.checked), 'the Decision is kept').toEqual([false, true, false, false]);
      await expect(notes(page)).toHaveValue('Late for the interview.');
      await expect(submit(page)).toBeEnabled();
      await expectNoTokenAnywhere(page, watch, T.good, `after a failed submit (${label})`);
      // Sending again works once the server answers.
      await submit(page).click();
      await expect(page.getByText(W.done, { exact: true })).toBeVisible();
      expect(guest!.posts(), 'two POSTs: the failed one and the retry').toHaveLength(2);
      expect(guest!.posts()[1]!.body).toEqual(guest!.posts()[0]!.body);
    });
  }
});

// ================================================================ AC-7 One refusal (rule 4, C-10)
test.describe('AC-7 One refusal', () => {
  test.beforeEach(noBackendOnly);

  test('AC-7 Expired, used, unknown and malformed links show the same single state, with the same markup and the same calls, and never an HR name or "expired"', async ({ page, guest, watch, appOrigin }) => {
    guest!.add(T.expired, ANSWER, 'expired');
    guest!.add(T.used, ANSWER, 'used');
    const cases: Array<[string, string]> = [['expired', T.expired], ['used', T.used], ['unknown', T.unknown], ['malformed', T.malformed]];
    const seen: Array<{ label: string; html: string; text: string; calls: string[] }> = [];
    for (const [label, t] of cases) {
      const from = watch.requests.length;
      await open(page, t);
      await expect(page.getByText(W.notFound, { exact: true }), label).toBeVisible();
      await expect(sliders(page), label).toHaveCount(0);
      await expect(submit(page), label).toHaveCount(0);
      const text = await page.locator('body').innerText();
      for (const re of NEVER) expect(text, `${label}: no ${re}`).not.toMatch(re);
      for (const v of ['Bongani', 'Fleet controller', '10 Nov 2026', 'Forklift']) expect(text, `${label}: nothing of the link (${v})`).not.toContain(v);
      await expectNoTokenAnywhere(page, watch, t, label);
      const calls = watch.requests.slice(from)
        .filter((r) => new URL(r.url).origin !== appOrigin && !/fonts\.(googleapis|gstatic)\.com$/.test(new URL(r.url).hostname))
        .map((r) => `${r.method} ${r.url.split(encodeURIComponent(t)).join('<T>').split(t).join('<T>')}`);
      seen.push({ label, html: (await snapshot(page)).split(encodeURIComponent(t)).join('<T>').split(t).join('<T>'), text, calls });
    }
    for (const s of seen.slice(1)) {
      expect(s.text, `${s.label} reads exactly as ${seen[0]!.label}`).toBe(seen[0]!.text);
      expect(s.html, `${s.label} has the same markup as ${seen[0]!.label}`).toBe(seen[0]!.html);
      expect(s.calls, `${s.label} makes the same calls as ${seen[0]!.label}`).toEqual(seen[0]!.calls);
    }
    expect(seen[0]!.calls.filter((c) => c.startsWith('GET ')), 'each case asked the server once').toHaveLength(1);
    expect(guest!.gets().map((g) => g.status), 'the server gave the one 410 answer each time').toEqual([410, 410, 410, 410]);
  });

  test('AC-7 /score with no token, an empty token, or a refreshed page shows the same state and sends no scoring request', async ({ page, guest }) => {
    for (const address of ['/score', '/score#', '/score#token=']) {
      await page.goto(address);
      await expect(page.getByText(W.notFound, { exact: true }), address).toBeVisible();
      await expect(sliders(page)).toHaveCount(0);
    }
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    const before = guest!.gets().length;
    await page.reload();
    await expect(page.getByText(W.notFound, { exact: true }), 'a refresh shows the refusal state: the link works from the email only (D-RUI-03.1)').toBeVisible();
    await page.waitForTimeout(500);
    expect(guest!.gets().length, 'no request without a token').toBe(before);
    expect(guest!.gets().map((g) => g.token)).toEqual([T.good]);
  });

  test('AC-7 An old-style link (/score?token=… or /score/<token>) shows the refusal and sends no scoring request; with a query and a fragment, only the fragment\'s link loads', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    guest!.add(T.second, SECOND);
    for (const address of [`/score?token=${T.good}`, `/score/${T.good}`]) {
      await page.goto('about:blank');
      await page.goto(address);
      await expect(page.getByText(W.notFound, { exact: true }), address).toBeVisible();
      await expect(sliders(page), address).toHaveCount(0);
    }
    await page.waitForTimeout(500);
    expect(guest!.gets(), 'no scoring request for an old-style link (D-RUI-03.11)').toEqual([]);
    await page.goto('about:blank');
    await page.goto(`/score?token=${T.good}#token=${T.second}`);
    await expect(heading(page)).toHaveText(W.title(SECOND.candidate_first, SECOND.candidate_last));
    expect(guest!.gets().map((g) => g.token), 'only the fragment\'s link was asked for').toEqual([T.second]);
    const u = new URL(page.url());
    expect([u.pathname, u.search, u.hash], 'the address is /score, no query, no fragment').toEqual(['/score', '', '']);
  });

  test('AC-7 A load that fails for another reason (a gateway error, a throttle, a dropped connection) is not the refusal: it says it could not be loaded, leaks the token nowhere, and Try again loads the link', async ({ page, guest, watch }) => {
    const modes: Array<Parameters<GuestFake['nextGet']>[0]> = [{ status: 503, body: { message: 'Service Unavailable' } }, { status: 429, body: { message: 'Too Many Requests' } }, 'abort'];
    for (const mode of modes) {
      const t = tok(`loadFail${typeof mode === 'string' ? mode : mode.status}`);
      guest!.add(t, ANSWER);
      guest!.nextGet(mode);
      await open(page, t);
      await expect(page.getByText(W.loadFailed, { exact: true })).toBeVisible();
      await expect(page.getByText(W.notFound, { exact: true })).toHaveCount(0);
      await expectNoTokenAnywhere(page, watch, t, `load failure (${typeof mode === 'string' ? mode : mode.status})`);
      await page.getByRole('button', { name: W.tryAgain, exact: true }).click();
      await expect(heading(page)).toHaveText(W.title('Bongani', 'Mthembu'));
      await expectNoTokenAnywhere(page, watch, t, 'after Try again');
      expect(guest!.gets().filter((g) => g.token === t), 'Try again asked once more, with the same token').toHaveLength(2);
      expect(page.url(), 'the token never came back into the address').not.toContain(t);
    }
  });
});

// ================================================================ AC-8 Public page hygiene (rule 5)
test.describe('AC-8 Public page hygiene', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 The token leaves the address before any request: the address is /score, and both calls were sent from /score', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    const u = new URL(page.url());
    expect([u.pathname, u.search, u.hash], 'the address is /score, no query, no fragment').toEqual(['/score', '', '']);
    await fillAll(page, [4, 4, 4], 'Yes');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    for (const c of guest!.calls) expect(c.pageUrl, `${c.method}: the page's address when the call reached the server`).not.toContain(T.good);
    const sent = await guest!.sentFrom(page);
    expect(sent.length, 'the page sent its calls').toBeGreaterThanOrEqual(1);
    for (const s of sent) expect(s.href, `the page's own address when it sent ${s.url}`).not.toContain(T.good);
    expect(await page.evaluate(() => history.length), 'no extra history entry').toBeLessThanOrEqual(2);
  });

  test('AC-8 The token is in exactly the two call paths and nowhere else: no other address, header, body, console line, storage, cookie, history state, or the page\'s markup', async ({ page, guest, watch }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await fillAll(page, [3, 3, 3], 'No');
    await notes(page).fill('Fine.');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    await watch.settled();
    const carrying = watch.requests.filter((r) => r.url.includes(T.good));
    expect(carrying.map((r) => `${r.method} ${new URL(r.url).pathname}`).filter((x) => !x.startsWith('OPTIONS ')), 'only the GET and the POST carry the token, in their path').toEqual([`GET /v1/scoring-links/${T.good}`, `POST /v1/scoring-links/${T.good}`]);
    for (const r of watch.requests) {
      expect(new URL(r.url).search, `no token in the query of ${r.method} ${r.url}`).not.toContain(T.good);
      for (const [name, value] of Object.entries(r.headers)) expect(value, `no token in header ${name} of ${r.method} ${r.url}`).not.toContain(T.good);
      expect(r.postData ?? '', `no token in the body of ${r.method} ${r.url}`).not.toContain(T.good);
    }
    expect(watch.console.filter((l) => l.includes(T.good)), 'no console line has the token').toEqual([]);
    expect(await everythingStored(page), 'no storage, cookie, cache name or history state has the token').not.toContain(T.good);
    expect(await page.content(), 'the markup holds no token').not.toContain(T.good);
  });

  test('AC-8 No Authorization header and no cookie on either call, even with a person signed in in the same browser and a cookie set for the API\'s host', async ({ page, guest, signIn, hr, cognito }) => {
    void cognito;
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(HR_HOME);
    await page.context().addCookies([{ name: 'session', value: 'hr-session-cookie', domain: new URL(talentFlowOrigin()).hostname, path: '/', secure: true, sameSite: 'None' }]);
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await fillAll(page, [4, 2, 5], 'Yes');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    expect(guest!.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    for (const c of guest!.calls) {
      expect(c.headers['authorization'], `${c.method} carries no Authorization header`).toBeUndefined();
      expect(c.headers['cookie'], `${c.method} carries no cookie`).toBeUndefined();
      expect(Object.keys(c.headers).filter((h) => /^x-|idempotency|tenant|company/i.test(h)), `${c.method} carries no header of its own`).toEqual([]);
    }
    for (const p of guest!.preflights) expect(p.headers.toLowerCase(), `the ${p.method} preflight asks for no authorization header`).not.toContain('authorization');
    // The signed-in person's page parts never show on the guest page.
    await expect(page.getByRole('button', { name: /^Your account/ })).toHaveCount(0);
  });

  test('AC-8 The page talks to nobody else: its only outside hosts are Google Fonts and the TalentFlow API, it loads no outside script, and sends nothing to Cognito or another API, signed in or not', async ({ page, guest, watch, appOrigin, signIn, hr, cognito }) => {
    void cognito;
    for (const signedIn of [false, true]) {
      if (signedIn) { await signIn.open(); await signIn.signInAs(hr); await expect(page).toHaveURL(HR_HOME); }
      const t = tok(signedIn ? 'hostsSignedIn' : 'hostsSignedOut');
      guest!.add(t, ANSWER);
      // Leave the HR home page first, so its own late calls are not counted as the guest page's.
      await page.goto('about:blank');
      await watch.settled();
      const from = watch.requests.length;
      await openForm(page, t);
      await fillAll(page, [1, 2, 3], 'No');
      await submit(page).click();
      await expect(page.getByText(W.done, { exact: true })).toBeVisible();
      await page.waitForTimeout(500);
      await watch.settled();
      const mine = watch.requests.slice(from).filter((r) => /^https?:/.test(r.url));
      const hosts = [...new Set(mine.map((r) => new URL(r.url).origin))].filter((o) => o !== appOrigin).sort();
      const allowed = [talentFlowOrigin(), 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
      expect(hosts.filter((h) => !allowed.includes(h)), `${signedIn ? 'signed in' : 'signed out'}: no outside host but Google Fonts and the TalentFlow API`).toEqual([]);
      expect(mine.filter((r) => r.resourceType === 'script' && new URL(r.url).origin !== appOrigin).map((r) => r.url), 'no outside script').toEqual([]);
      const api = mine.filter((r) => new URL(r.url).origin === talentFlowOrigin() && r.method !== 'OPTIONS').map((r) => `${r.method} ${new URL(r.url).pathname.replace(t, '<T>')}`);
      expect(api, 'exactly the two calls of the page').toEqual(['GET /v1/scoring-links/<T>', 'POST /v1/scoring-links/<T>']);
    }
  });

  test('AC-8 While the page shows, it tells search engines not to index it and the browser to send no referrer', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    for (const state of ['form', 'refusal']) {
      if (state === 'form') await openForm(page, T.good); else await open(page, T.unknown);
      const robots = await page.locator('head meta[name="robots"]').evaluateAll((m) => m.map((x) => x.getAttribute('content') ?? ''));
      expect(robots.some((c) => /\bnoindex\b/i.test(c)), `${state}: <meta name="robots" content="noindex">`).toBe(true);
      const referrer = await page.locator('head meta[name="referrer"]').evaluateAll((m) => m.map((x) => x.getAttribute('content') ?? ''));
      expect(referrer, `${state}: <meta name="referrer" content="no-referrer">`).toContain('no-referrer');
    }
  });

  test('AC-8 Nothing is cached in the browser: no service worker, and every visit asks the server', async ({ page, guest }) => {
    guest!.add(T.second, SECOND);
    await openForm(page, T.second, SECOND);
    await open(page, T.second);
    await open(page, T.second);
    expect(guest!.gets().filter((g) => g.token === T.second), 'three visits, three requests').toHaveLength(3);
    // Routing turns the browser's own cache off in these tests, so the page's request is read too: it never asks to reuse a kept answer.
    const sends = await guest!.sentFrom(page);
    expect(sends.length, 'the last visit sent its GET').toBeGreaterThan(0);
    for (const s of sends) expect(['default', 'no-store', 'no-cache', 'reload', 'xhr'], `cache mode of ${s.url}`).toContain(s.cache);
    expect(await page.evaluate(async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0)), 'no service worker').toBe(0);
  });

  test('AC-8 Text check: the files that call the scoring links log nothing, store nothing, send no sign-in, and sit outside the public site folders', async ({}, testInfo) => {
    once(testInfo.project.name);
    const APP = join(__dirname, '..', '..', 'src', 'app');
    const all: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|html)$/.test(f) && !/\.(spec|d)\.ts$/.test(f)) all.push(p); } };
    walk(APP);
    const callers = all.filter((f) => /scoring-links/.test(readFileSync(f, 'utf8')));
    expect(callers.map((f) => relative(APP, f)), 'some file calls /v1/scoring-links').not.toEqual([]);
    const folders = [...new Set(callers.map((f) => dirname(f)))];
    const files = all.filter((f) => folders.includes(dirname(f)));
    const bad: string[] = [];
    for (const f of files) {
      const rel = relative(APP, f);
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        const at = `${rel}:${i + 1}`;
        if (/\bconsole\.\w+\s*\(/.test(line)) bad.push(`console: ${at}`);
        if (/\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open|navigator\.sendBeacon)\b/.test(line)) bad.push(`storage or beacon: ${at}`);
        if (/\b(gtag|dataLayer|analytics|posthog|sentry|datadog|amplitude|mixpanel|hotjar)\b/i.test(line)) bad.push(`analytics: ${at}`);
        if (/['"`]Authorization['"`]|\bAuthorization\s*:|\bidToken\b|withCredentials\s*:\s*true|credentials\s*:\s*['"]include['"]/.test(line)) bad.push(`sign-in or credentials: ${at}`);
        if (/from\s+['"][^'"]*core\/auth\//.test(line)) bad.push(`imports the sign-in code: ${at}`);
      });
    }
    expect(bad, 'no logging, storage, analytics or sign-in in the guest page\'s files').toEqual([]);
    // D-RUI-03.5: the SITE locks treat any change under features/public or ds/site as a site pull request.
    expect(callers.map((f) => relative(APP, f)).filter((f) => /^(features\/public|ds\/site)\//.test(f)), 'the guest page is not in the public site folders').toEqual([]);
  });
});

// ================================================================ AC-12 Words, AC-13 Kit match
test.describe('AC-12 and AC-13 Words and kit match', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));

  async function onlyPp(page: Page, where: string): Promise<void> {
    const have = known();
    const found = await page.locator('body').evaluate((el) => ({
      classes: [...new Set([...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
      styled: [...el.querySelectorAll('[style]')].filter((e) => !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      styles: el.querySelectorAll('style').length,
      tags: [...new Set([...el.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => t.includes('-') && !t.startsWith('pp-') && !t.startsWith('app-') && t !== 'router-outlet'))],
    }));
    expect(found.classes.filter((c) => !have.has(c)), `${where}: every pp-* class exists in the design system`).toEqual([]);
    expect(found.styled, `${where}: no style attribute that sets a look`).toEqual([]);
    expect(found.styles, `${where}: no style element in the page body`).toBe(0);
    expect(found.tags, `${where}: no custom element but pp-* and app-*`).toEqual([]);
    expect(await page.locator('.pp-app-shell, .pp-side-navigation, .pp-top-navigation').count(), `${where}: no shell part`).toBe(0);
  }

  test('AC-13 The app is synced to the design system ref the kit structure was captured at', async ({}, testInfo) => {
    once(testInfo.project.name);
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs the structure captured again (a child lock)').toBe(KIT.ref);
  });

  test('AC-13 The guest page matches the kit screen "Guest scoring page" (and its phone screen) and uses only design system parts', async ({ page, guest }) => {
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    const name = phone() ? 'Guest scoring page (phone)' : 'Guest scoring page';
    const kit = (KIT.screens as Record<string, { page: readonly string[] }>)[name]!.page;
    const have = new Set(await page.locator('body').evaluate((root) => [...new Set([...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))]));
    // Layout helpers may differ (the app's radio group lays out its own tiles), and --phone is the kit's preview switch
    // (pp-sign-in-page applies the phone spacing by width on its own).
    const layoutOnly = [/^pp-gap-/, /^pp-inline/, /^pp-stack/, /^pp-grid/, /^pp-text(--|$)/, /^pp-sign-in--phone$/];
    const missing = kit.filter((c) => !have.has(c) && !layoutOnly.some((re) => re.test(c)));
    expect(missing, `${name}: classes the kit has and the page lacks`).toEqual([]);
    // The expiry line is the kit's small subtle text, the title the sign-in card title, the line its company line.
    await expect(page.locator('.pp-sign-in__title')).toHaveText(W.title('Bongani', 'Mthembu'));
    await expect(page.locator('.pp-sign-in__company')).toHaveText(LINE);
    await expect(page.getByText(EXPIRES, { exact: true })).toHaveClass(/\bpp-text--small\b/);
    await expect(page.getByText(EXPIRES, { exact: true })).toHaveClass(/\bpp-text--subtle\b/);
    await expect(page.locator('.pp-radio--tile')).toHaveCount(4);
    await expect(page.locator('.pp-slider')).toHaveCount(3);
    await expect(submit(page)).toHaveClass(/\bpp-button--primary\b/);
    await onlyPp(page, name);
  });

  test('AC-13 The refusal, load failure, save failure and thank-you states use only design system parts and no shell', async ({ page, guest }) => {
    await open(page, T.unknown);
    await onlyPp(page, 'refusal');
    guest!.add(T.good, ANSWER);
    guest!.nextGet({ status: 503, body: {} });
    await open(page, T.good);
    await expect(page.getByText(W.loadFailed, { exact: true })).toBeVisible();
    await onlyPp(page, 'load failure');
    await page.getByRole('button', { name: W.tryAgain, exact: true }).click();
    await expect(heading(page)).toBeVisible();
    await fillAll(page, [3, 3, 3], 'Yes');
    guest!.nextPost({ status: 500, body: {} });
    await submit(page).click();
    await expect(page.getByText(W.saveFailed, { exact: true })).toBeVisible();
    await onlyPp(page, 'save failure');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    await onlyPp(page, 'thank you');
  });

  test('AC-12 Every state uses only its own words: the form, save failure, thank-you, refusal and load failure each show their own lines and nothing else; no old word, no "average", no 0 to 10 scale, no HR-name line, no Batsi, no ids', async ({ page, guest }) => {
    const texts: Array<[string, string]> = [];
    const body = async () => page.locator('body').innerText();
    guest!.add(T.good, ANSWER);
    await openForm(page, T.good);
    await fillAll(page, [5, 5, 5], 'Strong yes');
    texts.push(['form', await body()]);
    guest!.nextPost({ status: 500, body: {} });
    await submit(page).click();
    await expect(page.getByText(W.saveFailed, { exact: true })).toBeVisible();
    texts.push(['save failure', await body()]);
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    texts.push(['thank you', await body()]);
    await open(page, T.unknown);
    texts.push(['refusal', await body()]);
    guest!.add(T.second, SECOND);
    guest!.nextGet({ status: 503, body: {} });
    await open(page, T.second);
    await expect(page.getByText(W.loadFailed, { exact: true })).toBeVisible();
    texts.push(['load failure', await body()]);
    for (const [where, text] of texts) {
      for (const re of NEVER) expect(text, `${where}: no ${re}`).not.toMatch(re);
      expect(text, `${where}: no criterion key or rating code`).not.toMatch(/forklift_safety|route_planning|STRONG_|\bYES\b|\bNO\b/);
    }
    // Each state's words, all of them: the kit's, the approved group D lines and the rule 7a lines (D-RUI-03.6), nothing else.
    // The logo's own maker line (pp-logo draws "by Naleko", in capitals by its style) is the design system's, not this page's.
    const logo = /^(Naleko People ?)?by Naleko$/i;
    const brand = ['Naleko', 'People', 'Naleko People'];
    const formWords = [
      ...brand, W.title('Bongani', 'Mthembu'), LINE, EXPIRES, ...CRITERIA.map((c) => c.label), ...SCALE,
      W.decision, ...DECISIONS.flatMap((d) => [d.label, d.help, `${d.label}${d.help}`, `${d.label} ${d.help}`]), 'Notes', W.optional, 'Notes (optional)', 'Notes(optional)', W.submit,
    ];
    const closed: Record<string, { allowed: string[]; must: string[] }> = {
      'form': { allowed: formWords, must: [W.title('Bongani', 'Mthembu'), W.submit] },
      'save failure': { allowed: [...formWords, W.saveFailed], must: [W.saveFailed, W.submit] },
      'thank you': { allowed: [...brand, W.title('Bongani', 'Mthembu'), LINE, W.done], must: [W.done] },
      'refusal': { allowed: [...brand, W.notFound], must: [W.notFound] },
      'load failure': { allowed: [...brand, W.loadFailed, W.tryAgain], must: [W.loadFailed, W.tryAgain] },
    };
    for (const [where, text] of texts) {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const { allowed, must } = closed[where]!;
      expect(lines.filter((l) => !allowed.includes(l) && !logo.test(l)), `${where}: no words beyond its own lines`).toEqual([]);
      for (const m of must) expect(lines, `${where}: shows "${m}"`).toContain(m);
    }
  });
});

// ================================================================ AC-14 pepla-dev (guest part)
test.describe('AC-14 pepla-dev', () => {
  test('AC-14 The guest page against pepla-dev: a fresh guest link scores once, the second visit and company B\'s link show the same single state, the real answers carry no cache, and the page loads nothing from an outside host but Google Fonts and the API @pepla-dev', async ({ page, appOrigin }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-5 to AC-8.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(5 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const hrLogin = { email: env('E2E_HR_EMAIL'), password: env('E2E_HR_PASSWORD') };
    expect(hrLogin.email && hrLogin.password, 'the HR (Recruiter) test login is set').toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const api = talentFlowOrigin();
    expect(api, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const appEnv = readFileSync(join(__dirname, '..', '..', 'src', 'environments', 'environment.ts'), 'utf8');
    const base = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: hrLogin.email, PASSWORD: hrLogin.password } }),
    });
    expect(r.status(), 'HR signs in at Cognito').toBe(200);
    const idToken = ((await r.json()) as any).AuthenticationResult.IdToken as string;
    // REC-07's dev seed (cards/rec-07.md, "REC-07 dev seed"): a candidate and an interview of company A, and a link for B's interview.
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-07', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const made = await page.request.post(`${base}/v1/candidates/${encodeURIComponent(ids['candidate']!)}/scoring-links`, {
      headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      data: JSON.stringify({ interview_id: ids['interview'], guest_email: 'rec-ui-03-dev-guest@example.test' }),
    });
    expect(made.status(), `HR makes a fresh guest link (${made.status()})`).toBe(201);
    const token = ((await made.json()) as any).token as string;
    // The real read: its headers store nothing in the browser.
    const read = await page.request.get(`${base}/v1/scoring-links/${encodeURIComponent(token)}`);
    expect(read.status()).toBe(200);
    const h = read.headers();
    expect(h['cache-control'] ?? '', 'no Cache-Control that lets the browser keep it').not.toMatch(/\b(public|max-age=[1-9]|immutable|s-maxage)/i);
    expect([h['expires'], h['last-modified'], h['etag']], 'no Expires, Last-Modified or ETag').toEqual([undefined, undefined, undefined]);

    const watch = new Watch();
    watch.track(page);
    await page.goto(linkFor(token));
    await expect(heading(page)).toHaveText(/^Interview feedback for /);
    expect(new URL(page.url()).pathname).toBe('/score');
    const n = await sliders(page).count();
    expect(n, 'the seeded interview\'s criteria').toBeGreaterThan(0);
    for (const s of await sliders(page).all()) await s.fill('4');
    await decide(page, 'Yes');
    await submit(page).click();
    await expect(page.getByText(W.done, { exact: true })).toBeVisible();
    await open(page, token);
    await expect(page.getByText(W.notFound, { exact: true }), 'the second visit').toBeVisible();
    const usedText = await page.locator('body').innerText();
    await open(page, ids['crossCompanyToken']!);
    await expect(page.getByText(W.notFound, { exact: true }), 'company B\'s link').toBeVisible();
    expect(await page.locator('body').innerText(), 'the same single state').toBe(usedText);
    await watch.settled();
    const hosts = [...new Set(watch.requests.filter((x) => /^https?:/.test(x.url)).map((x) => new URL(x.url).origin))].filter((o) => o !== appOrigin);
    expect(hosts.filter((o) => ![api, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(o)), 'no outside host but Google Fonts and the API').toEqual([]);
    for (const x of watch.requests.filter((q) => q.url.startsWith(api))) {
      expect(x.headers['authorization'], `${x.method} ${x.url}: no Authorization`).toBeUndefined();
    }
  });
});
