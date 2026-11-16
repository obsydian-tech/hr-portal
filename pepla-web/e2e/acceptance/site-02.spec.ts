import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { STILL, compareExample, serveKit } from './support/site-02/example-parity';
import {
  ARRIVAL,
  ARRIVAL_ID,
  PARTS,
  PEPLA_WEB,
  body,
  exampleId,
  frames,
  gotoGallery,
  kitExamples,
  scrollExample,
  section,
  sleep,
  wordsOf,
} from './support/site-02/site';

/**
 * SITE-02 · Angular site components, one per design system part, 1:1 with the kits (Jira NH-204, epic NH-202).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/SITE-02.md. Notes and the gallery contract: ./cards/site-02.md.
 *
 * Everything runs against /dev/site with no backend, at 1280 and 390 wide unless a test says why not.
 * Nothing here calls an AI service. These files are locked once accepted: see ./README.md.
 */

const ON_DEV = process.env['ACCEPTANCE_TARGET'] === 'pepla-dev';
const noBackendOnly = () => test.skip(ON_DEV, 'SITE-02 is judged in the no-backend run only: nothing in this card runs on pepla-dev.');
const once = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Runs once, in desktop-1280: ${why}`);
const phoneOnly = () => test.skip(test.info().project.name !== 'phone-390', 'The criterion is about 390 wide: runs in phone-390.');
const desktopOnly = () => test.skip(test.info().project.name !== 'desktop-1280', 'The criterion is about 1280 wide: runs in desktop-1280.');
const isPhone = () => test.info().project.name === 'phone-390';

const SRC = join(PEPLA_WEB, 'src');
const OLD_NAME = /pepla/i;

/** The kit examples that show phone width (everything else is desktop). */
const phoneExample = (name: string) => /phone/i.test(name);

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

// Both pages are drawn the same way on every machine: no sub-pixel (LCD) text and no font hinting. A page whose text sits on a
// see-through layer is drawn with grey edges and one that does not with coloured ones on a runner whose fonts allow it, which
// shows as a few percent of "different" pixels with every box in place.
test.use({ launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] } });

test.describe('SITE-02 Angular site components, 1:1 with the design system kits', () => {
  test.beforeEach(() => noBackendOnly());

  // -------------------------------------------------------------- AC-1
  test('AC-1 /dev/site shows every kit example of the 13 parts and invents no words', async ({ page }) => {
    const examples = kitExamples();
    expect(examples.length, 'the 13 kit example files hold examples').toBeGreaterThanOrEqual(29);
    expect(new Set(examples.map((e) => e.part)).size, 'every one of the 13 parts has at least one kit example').toBe(PARTS.length);
    const kitPage = await page.context().newPage();
    try {
      await gotoGallery(page);
      await kitPage.setContent('<!doctype html><html><body></body></html>');

      // One section per kit example, in the contract's ids, and one extra last section for the arrival.
      const names = await page.locator('section[data-example]').evaluateAll((all) => all.map((s) => ({ name: s.getAttribute('data-example'), id: s.id })));
      const missing = examples.filter((e) => !names.some((n) => n.id === e.id && n.name === e.name)).map((e) => `${e.id} ("${e.name}")`);
      expect(missing, 'every kit example has a section[data-example] with its id (part and name)').toEqual([]);
      const extra = names.filter((n) => !examples.some((e) => e.id === n.id)).map((n) => n.id);
      expect(extra, 'the only section that is not a kit example is the arrival').toEqual([ARRIVAL_ID]);
      expect(names[names.length - 1]!.id, 'the arrival section is the last one').toBe(ARRIVAL_ID);
      expect(names[names.length - 1]!.name).toBe(ARRIVAL);

      // Every word in a section's body is in the kit example of the same name.
      const bad: string[] = [];
      for (const e of examples) {
        const sec = section(page, e.part, e.name);
        await expect(sec.locator('h2').first(), `${e.id}: its own h2 names the example`).toHaveText(e.name);
        const bodyEl = sec.locator('[data-example-body]');
        await expect(bodyEl, `${e.id}: has one [data-example-body]`).toHaveCount(1);
        const mine = await bodyEl.evaluate(wordsOf);
        const kit = await kitPage.evaluate(
          ([html, fn]) => {
            document.body.innerHTML = html;
            const root = document.body.querySelector('section[data-example]')!;
            // eslint-disable-next-line no-new-func
            return (new Function(`return (${fn})`)() as (r: Element) => { texts: string[]; names: string[] })(root);
          },
          [e.html, wordsOf.toString()] as const,
        );
        const allowed = new Set([...kit.texts, ...kit.names]);
        for (const w of [...mine.texts, ...mine.names]) if (!allowed.has(w)) bad.push(`${e.id}: "${w}"`);
      }
      expect(bad, 'every text and accessible name in an example is in the kit example of the same name').toEqual([]);

      // Nothing made up, nothing old.
      const html = await page.content();
      expect(html, 'no lorem').not.toMatch(/lorem|ipsum|placeholder text/i);
      const title = await page.title();
      expect(title, 'the tab title has no old name').not.toMatch(OLD_NAME);
      const attrs = await page.evaluate(() => Array.from(document.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).filter((a) => /^(href|src|class|id|aria-label|alt|title|data-.*)$/.test(a.name)).map((a) => `${el.tagName.toLowerCase()}[${a.name}]=${a.value}`)));
      expect(attrs.filter((a) => OLD_NAME.test(a)), 'no "pepla" in any attribute, class or href').toEqual([]);
      expect(await page.locator('body').innerText(), 'no "pepla" in the visible text').not.toMatch(OLD_NAME);
    } finally {
      await kitPage.close();
    }
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 every example matches its kit example (boxes within 1px, 1% pixels) and a planted fault fails it', async ({ page }) => {
    once('the comparison sets its own window width: 1440 for desktop examples, 390 for phone examples');
    test.setTimeout(600_000);
    const examples = kitExamples();
    // Motion is stopped on the gallery from the first moment, as it is on the kit page (whose freeze is in its head), so no loop has
    // been promoted to its own layer before the pictures are taken (a slower machine otherwise draws the two pages differently).
    await page.context().addInitScript((css) => {
      const add = () => { const st = document.createElement('style'); st.setAttribute('data-test-still', ''); st.textContent = css; (document.head ?? document.documentElement).appendChild(st); };
      if (document.head) add(); else new MutationObserver((_m, o) => { if (document.head) { o.disconnect(); add(); } }).observe(document, { childList: true, subtree: true });
    }, STILL);
    const kitPage = await page.context().newPage();
    const failed: string[] = [];
    try {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await gotoGallery(page);
        for (const e of examples.filter((x) => phoneExample(x.name) === (width === 390))) {
          const r = await compareExample(page, kitPage, e);
          if (!r.pass) failed.push(`${e.id} @${width}: ${[...r.unmatched.map((u) => `missing ${u}`), ...r.moved, r.pixelRatio > 0.01 ? `${(r.pixelRatio * 100).toFixed(2)}% of pixels differ` : ''].filter(Boolean).slice(0, 6).join(' | ')}`);
        }
      }
      expect(failed, 'every kit example is matched by its gallery example').toEqual([]);

      // Planted faults, each of which must be caught on the example it is planted in.
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoGallery(page);
      const plants: Array<{ what: string; part: Parameters<typeof exampleId>[0]; name: string; mutate: (p: Page, scope: string) => Promise<void> }> = [
        { what: 'a 4px margin on the hero title', part: 'hero', name: 'Hero, desktop width', mutate: (p, s) => p.locator(s).locator('.pp-site-hero__title').first().evaluate((el) => { (el as HTMLElement).style.marginTop = '4px'; }) },
        { what: 'a missing shine copy', part: 'shine', name: 'Accent line (a block)', mutate: (p, s) => p.locator(s).locator('.pp-site-shine__copy').first().evaluate((el) => el.remove()) },
        { what: 'a changed word in the footer', part: 'footer', name: 'Desktop: brand, five lists and the legal row', mutate: (p, s) => p.locator(s).locator('footer a, footer button, footer li').first().evaluate((el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n: Node | null; while ((n = w.nextNode())) { if (n.textContent?.trim()) { n.textContent = `${n.textContent}x`; break; } } }) },
        { what: 'a wrong class on the band note', part: 'band', name: 'Closing band, desktop width', mutate: (p, s) => p.locator(s).locator('.pp-site-band__note').first().evaluate((el) => { el.className = 'pp-site-band__lead'; }) },
      ];
      for (const plant of plants) {
        const ex = examples.find((x) => x.part === plant.part && x.name === plant.name)!;
        await gotoGallery(page);
        const r = await compareExample(page, kitPage, ex, plant.mutate);
        expect(r.pass, `planted: ${plant.what} makes the comparison fail`).toBe(false);
        await kitPage.unroute(/.*/);
      }
    } finally {
      await kitPage.close();
    }
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 the header is 72px, transparent at the top, frosted after 24px without moving anything, and shows the right controls at each width', async ({ page, browser }) => {
    const phone = isPhone();
    const ex = phone ? 'Phone: logo, Book a demo hidden under 520px, menu button' : 'At the top of the page (desktop)';
    await gotoGallery(page, [exampleId('header', ex)]);
    const frame = body(page, 'header', ex).locator('.pp-site-frame');
    const header = frame.locator('header.pp-site-header');
    await frame.scrollIntoViewIfNeeded();
    const state = () => header.evaluate((el) => {
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      const pageEl = el.closest('.pp-site-frame__page') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { height: r.height, top: r.top, scrolled: el.classList.contains('pp-site-header--scrolled'), bg: cs.backgroundColor, beforeOpacity: Number(before.opacity), backdrop: before.backdropFilter, scrollHeight: pageEl.scrollHeight };
    });
    const visible = async (loc: Locator) => (await loc.count()) > 0 && (await loc.first().evaluate((el) => (el as HTMLElement).checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getBoundingClientRect().width > 0));
    const controls = async () => ({
      logo: await visible(header.getByRole('link', { name: 'Naleko People home', exact: true })),
      menu: await visible(header.getByRole('navigation', { name: 'Main', exact: true })),
      login: await visible(header.getByRole('link', { name: 'Log in', exact: true })),
      started: await visible(header.getByRole('link', { name: 'Get started', exact: true })),
      demo: await visible(header.getByRole('link', { name: 'Book a demo', exact: true })),
      burger: await visible(header.getByRole('button', { name: 'Open menu', exact: true })),
    });

    // At the top: 72px, transparent, no frosted layer.
    const top = await state();
    expect(top.height, 'the header is 72px tall').toBe(72);
    expect(top.scrolled, 'no scrolled class at the top').toBe(false);
    expect(top.bg, 'the header is transparent at the top').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(top.beforeOpacity, 'no frosted layer at the top').toBe(0);

    // After 24px: the class, the frosted layer, and nothing moved.
    await scrollExample(frame, 20);
    await frames(page);
    expect((await state()).scrolled, 'at 20px of scroll the header is not scrolled yet').toBe(false);
    await scrollExample(frame, 120);
    await expect.poll(async () => (await state()).scrolled, { message: 'after 120px of scroll the header has pp-site-header--scrolled' }).toBe(true);
    await sleep(600);
    const scrolled = await state();
    expect(scrolled.beforeOpacity, 'the frosted layer is showing').toBe(1);
    expect(scrolled.backdrop, 'the frosted layer blurs what is behind').not.toBe('none');
    expect(scrolled.height, 'the header box does not change height').toBe(72);
    expect(scrolled.top, 'the header box does not move').toBe(top.top);
    expect(scrolled.scrollHeight, "the page's scrollHeight does not change (no reflow)").toBe(top.scrollHeight);
    await scrollExample(frame, 0);
    await expect.poll(async () => (await state()).scrolled, { message: 'scrolled back to the top the class is gone' }).toBe(false);

    // Controls at this width.
    const c = await controls();
    if (phone) {
      expect(c, 'at 390 the header shows the logo and the menu button only').toEqual({ logo: true, menu: false, login: false, started: false, demo: false, burger: true });
    } else {
      expect(c, 'at 1280 the header shows logo, menu, Log in, Get started, Book a demo').toEqual({ logo: true, menu: true, login: true, started: true, demo: true, burger: false });
      // 1100 (separate check): the header lays out by its own width, so a frame 1100 wide stands in for a 1100 window.
      await frame.evaluate((el) => { (el as HTMLElement).style.width = '1100px'; (el as HTMLElement).style.transform = 'none'; });
      await frames(page);
      expect(await controls(), 'at 1100 the header shows the logo, Book a demo and the menu button').toEqual({ logo: true, menu: false, login: false, started: false, demo: true, burger: true });
      await frame.evaluate((el) => { (el as HTMLElement).style.width = ''; (el as HTMLElement).style.transform = ''; });
    }

    // Names.
    await expect(header.getByRole('link', { name: 'Naleko People home', exact: true }), 'the logo link is named "Naleko People home"').toHaveCount(1);
    await expect(header.getByRole('navigation', { name: 'Main', exact: true, includeHidden: true }).first(), 'the nav is named "Main"').toBeAttached();
    await expect(header.getByRole('button', { name: 'Open menu', exact: true, includeHidden: true }), 'the menu button is named "Open menu"').toHaveCount(1);

    // The skip link: first tab stop, visible only while focused, moves focus to main.
    const skip = header.getByRole('link', { name: 'Skip to content', exact: true, includeHidden: true });
    const before = await skip.evaluate((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { clipped: r.width < 2 || r.height < 2 || cs.clip !== 'auto' || cs.opacity === '0' || r.bottom <= (el.closest('.pp-site-frame')!.getBoundingClientRect().top) }; });
    expect(before.clipped, 'the skip link is not visible until it has focus').toBe(true);
    await frame.evaluate((el) => { (el.querySelector('.pp-site-frame__page') as HTMLElement).tabIndex = -1; (el.querySelector('.pp-site-frame__page') as HTMLElement).focus(); });
    await page.keyboard.press('Tab');
    await expect(skip, 'the skip link is the first tab stop').toBeFocused();
    const shown = await skip.evaluate((el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 20; });
    expect(shown, 'the skip link shows while focused').toBe(true);
    await page.keyboard.press('Enter');
    const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
    expect(focusedId, 'Enter moves focus to the page main').not.toBe('');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).closest('.pp-site-frame, main') !== null), 'the focus is in the main content').toBe(true);

    // At 390 no visible control is under another bar: the frame's own content never covers the header's controls.
    if (phone) {
      const boxes = await header.locator('a:not(.pp-site-header__skip), button').evaluateAll((all) => all.filter((el) => (el as HTMLElement).checkVisibility() && el.getBoundingClientRect().width > 0).map((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(), covered: !(hit && (hit === el || el.contains(hit))) }; }));
      expect(boxes.filter((b) => b.covered), 'every visible header control is on top (not under another bar)').toEqual([]);
    }
    void browser;
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 the menu opens, switches and closes with a mouse, a keyboard and a touch, and holds the kit words', async ({ page, browser, baseURL }) => {
    desktopOnly();
    await gotoGallery(page, [exampleId('header', 'At the top of the page (desktop)')]);
    const frame = body(page, 'header', 'At the top of the page (desktop)').locator('.pp-site-frame');
    await frame.scrollIntoViewIfNeeded();
    const nav = frame.locator('nav.pp-site-menu');
    const trigger = (name: string) => nav.getByRole('button', { name, exact: true });
    const panelOf = async (name: string) => nav.locator(`#${await trigger(name).getAttribute('aria-controls')}`);
    const panels = nav.locator('.pp-site-menu__panel');
    const inertFlags = () => panels.evaluateAll((all) => all.map((p) => p.hasAttribute('inert')));
    const isOpen = () => nav.evaluate((el) => el.classList.contains('pp-site-menu--open'));
    const dir = (p: Locator) => p.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--_dir').trim());
    const center = async (loc: Locator) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

    // Four lists (Product, Integrations, Resources and one more) and "Ask Batsi" as a link, not a list.
    const names = await nav.locator('.pp-site-menu__item > .pp-site-menu__trigger').evaluateAll((all) => all.map((el) => ({ tag: el.tagName, text: (el.textContent ?? '').trim() })));
    expect(names.map((n) => n.text).slice(0, 3), 'the menu starts Product, Ask Batsi, Integrations').toEqual(['Product', 'Ask Batsi', 'Integrations']);
    expect(names.find((n) => n.text === 'Ask Batsi')!.tag, '"Ask Batsi" is a link').toBe('A');
    expect(names.map((n) => n.text), 'Resources is in the menu').toContain('Resources');
    expect(await inertFlags(), 'closed, every panel is inert').toEqual((await inertFlags()).map(() => true));

    // Hover opens Product; other panels are inert, the open one is not.
    await page.mouse.move(...Object.values(await center(trigger('Product'))) as [number, number]);
    await expect(nav, 'pointing at Product opens the menu').toHaveClass(/pp-site-menu--open/);
    await expect(trigger('Product')).toHaveAttribute('aria-expanded', 'true');
    const product = await panelOf('Product');
    await expect(product).not.toHaveAttribute('inert', '');
    const flags = await panels.evaluateAll((all) => all.map((p) => ({ id: p.id, inert: p.hasAttribute('inert') })));
    expect(flags.filter((f) => f.id !== (undefined as unknown as string) && f.id === (flags.find((x) => !x.inert)?.id ?? '')).length, 'exactly one panel is open').toBe(1);
    expect(flags.filter((f) => !f.inert).length, 'every other panel is inert').toBe(1);

    // Moving to Integrations swaps panels; the old one leaves away from the direction of travel.
    await page.mouse.move(...Object.values(await center(trigger('Integrations'))) as [number, number], { steps: 8 });
    await expect(trigger('Integrations')).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger('Product')).toHaveAttribute('aria-expanded', 'false');
    const integrations = await panelOf('Integrations');
    expect(await dir(product), 'moving right: the old panel leaves to the left (--_dir -1)').toBe('-1');
    expect(await dir(integrations), 'the new panel has arrived (--_dir 0)').toBe('0');
    await page.mouse.move(...Object.values(await center(trigger('Product'))) as [number, number], { steps: 8 });
    await expect(trigger('Product')).toHaveAttribute('aria-expanded', 'true');
    expect(await dir(integrations), 'moving left: the old panel leaves to the right (--_dir 1)').toBe('1');

    // A 120ms pause crossing the gap does not close it.
    const trig = (await trigger('Product').boundingBox())!;
    const pan = (await product.boundingBox())!;
    await page.mouse.move(trig.x + trig.width / 2, trig.y + trig.height + 4);
    await sleep(90);
    await page.mouse.move(pan.x + 40, pan.y + 20);
    await sleep(300);
    expect(await isOpen(), 'a short pause crossing the gap, then into the panel, keeps it open').toBe(true);

    // Leaving the menu closes it after 220ms.
    await page.mouse.move(10, 10, { steps: 2 });
    await sleep(80);
    expect(await isOpen(), 'still open 80ms after the pointer left').toBe(true);
    await expect.poll(isOpen, { timeout: 500, message: 'closed after the pointer has left for 220ms' }).toBe(false);
    expect(await inertFlags(), 'closed again: every panel inert').toEqual((await inertFlags()).map(() => true));

    // Keyboard: Enter opens and moves focus to the first entry, arrows move, Escape closes and returns focus.
    await trigger('Product').focus();
    await page.keyboard.press('Enter');
    await expect(nav).toHaveClass(/pp-site-menu--open/);
    const focusedName = () => page.evaluate(() => (document.activeElement?.querySelector('.pp-site-menu__name')?.textContent ?? document.activeElement?.textContent ?? '').trim());
    expect(await focusedName(), 'Enter puts focus on the first entry').toBe('Employee Records');
    await page.keyboard.press('ArrowDown');
    expect(await focusedName(), 'ArrowDown goes to the next entry').toBe('Recruitment');
    await page.keyboard.press('ArrowUp');
    expect(await focusedName(), 'ArrowUp goes back').toBe('Employee Records');
    await page.keyboard.press('Escape');
    await expect.poll(isOpen, { message: 'Escape closes it' }).toBe(false);
    await expect(trigger('Product'), 'Escape puts focus back on the trigger').toBeFocused();
    await trigger('Integrations').focus();
    await page.keyboard.press('Space');
    await expect(trigger('Integrations'), 'Space opens a list').toHaveAttribute('aria-expanded', 'true');
    expect(await focusedName(), 'Space puts focus on the first entry').toBe('API');
    await page.keyboard.press('Escape');
    // Tab from a closed trigger reaches "Ask Batsi" (a link), because the closed panel is inert.
    await trigger('Product').focus();
    await page.keyboard.press('Tab');
    const tabbed = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: (document.activeElement?.textContent ?? '').trim() }));
    expect(tabbed, 'Tab from Product reaches the link "Ask Batsi"').toEqual({ tag: 'A', text: 'Ask Batsi' });

    // A click outside closes it.
    await trigger('Resources').focus();
    await page.keyboard.press('Enter');
    await expect(nav).toHaveClass(/pp-site-menu--open/);
    const outside = frame.locator('.pp-site-frame__content').first();
    await outside.click({ position: { x: 20, y: 200 } });
    await expect.poll(isOpen, { message: 'a click outside closes it' }).toBe(false);

    // Touch: a tap opens, a second tap closes, hovering does nothing.
    const touch = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });
    try {
      const tp = await touch.newPage();
      await gotoGallery(tp, [exampleId('header', 'At the top of the page (desktop)')]);
      const tframe = body(tp, 'header', 'At the top of the page (desktop)').locator('.pp-site-frame');
      await tframe.scrollIntoViewIfNeeded();
      expect(await tp.evaluate(() => matchMedia('(hover:hover)').matches), 'the touch context has no hover').toBe(false);
      const tnav = tframe.locator('nav.pp-site-menu');
      const ttrig = tnav.getByRole('button', { name: 'Product', exact: true });
      await ttrig.dispatchEvent('mouseenter');
      expect(await tnav.evaluate((el) => el.classList.contains('pp-site-menu--open')), 'hovering does nothing on touch').toBe(false);
      await ttrig.tap();
      await expect(tnav, 'a tap opens').toHaveClass(/pp-site-menu--open/);
      await ttrig.tap();
      await expect(tnav, 'a second tap closes').not.toHaveClass(/pp-site-menu--open/);
    } finally {
      await touch.close();
    }

    // The words in the lists are the kit's, in the kit's order, including Resources and the "Coming soon" pills.
    const kitHeader = kitExamples().find((e) => e.part === 'header' && e.name === 'At the top of the page (desktop)')!;
    const kitPage = await page.context().newPage();
    try {
      await kitPage.setContent(`<!doctype html><body>${kitHeader.html}</body>`);
      const listOf = (root: Locator) => root.locator('.pp-site-menu__panel').evaluateAll((all) => all.map((p) => Array.from(p.querySelectorAll('.pp-site-menu__name, .pp-site-menu__hint, .pp-site-menu__foot span, .pp-site-menu__foot a')).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())));
      const kitLists = await listOf(kitPage.locator('nav.pp-site-menu'));
      const mine = await listOf(nav);
      expect(mine, 'every panel lists exactly the kit words in the kit order').toEqual(kitLists);
      const pills = (root: Locator) => root.locator('.pp-site-menu__soon').evaluateAll((all) => all.map((e) => (e.textContent ?? '').trim()));
      const kitPills = await pills(kitPage.locator('nav.pp-site-menu'));
      expect(kitPills.length, 'the kit has "Coming soon" pills').toBeGreaterThan(0);
      expect(await pills(nav), 'the "Coming soon" pills are there, word for word').toEqual(kitPills);
    } finally {
      await kitPage.close();
    }
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 the menu background snaps on first opening, then slides; its inputs equal the kit script; it never sets a size; tilt and light follow the rules', async ({ page, browser, baseURL }) => {
    desktopOnly();
    test.setTimeout(180_000);
    const HEADER = 'At the top of the page (desktop)';
    const kitHeader = kitExamples().find((e) => e.part === 'header' && e.name === HEADER)!;
    const parse = (v: string | null | undefined) => (v && v.trim() ? parseFloat(v) : 0);
    const readInputs = (nav: Locator) => nav.evaluate((el) => {
      const open = el.querySelector('.pp-site-menu__panel:not([inert])') as HTMLElement | null;
      const st = (el as HTMLElement).style;
      return { x: st.getPropertyValue('--_x'), sx: st.getPropertyValue('--_sx'), sy: st.getPropertyValue('--_sy'), ax: st.getPropertyValue('--_ax'), panelX: open?.style.getPropertyValue('--_x') ?? '' };
    });
    const center = async (loc: Locator) => { const b = (await loc.boundingBox())!; return [b.x + b.width / 2, b.y + b.height / 2] as [number, number]; };
    const matrix = (loc: Locator) => loc.evaluate((el) => { const m = new DOMMatrixReadOnly(getComputedStyle(el).transform); return [m.a, m.d, m.e, m.f]; });

    await gotoGallery(page, [exampleId('header', HEADER)]);
    // Every inline style change on the menu is watched for the whole run: no width, height, left or top, ever.
    await page.evaluate(() => {
      const bad: string[] = ((window as unknown as { __sizeSet: string[] }).__sizeSet = []);
      const watch = '.pp-site-menu__panel, .pp-site-menu__morph, .pp-site-menu__arrow, nav.pp-site-menu';
      new MutationObserver((recs) => {
        for (const r of recs) {
          const el = r.target as HTMLElement;
          if (!el.matches?.(watch)) continue;
          for (const k of ['width', 'height', 'left', 'top', 'min-width', 'max-width', 'inset']) if (el.style.getPropertyValue(k)) bad.push(`${el.className} sets ${k}`);
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
    });
    const frame = body(page, 'header', HEADER).locator('.pp-site-frame');
    await frame.scrollIntoViewIfNeeded();
    const nav = frame.locator('nav.pp-site-menu');
    const trigger = (name: string) => nav.getByRole('button', { name, exact: true });
    const morph = nav.locator('.pp-site-menu__morph');
    const away = async () => { await page.mouse.move(5, 5); await sleep(500); };

    // First opening snaps; the next switch slides and resizes.
    await page.mouse.move(...(await center(trigger('Integrations'))));
    await sleep(40);
    const early = await matrix(morph);
    await sleep(900);
    const settled = await matrix(morph);
    expect(Math.abs(early[2]! - settled[2]!), 'first opening: the background is already under the trigger (x)').toBeLessThan(2);
    expect(Math.abs(early[0]! - settled[0]!), 'first opening: the background is already its size (width scale)').toBeLessThan(0.02);
    await page.mouse.move(...(await center(trigger('Product'))), { steps: 6 });
    await sleep(30);
    const mid = await matrix(morph);
    await sleep(900);
    const end = await matrix(morph);
    expect(Math.abs(mid[2]! - end[2]!) + Math.abs(mid[0]! - end[0]!) * 300 + Math.abs(mid[1]! - end[1]!) * 300, 'the next switch: the background is still sliding and resizing 30ms in').toBeGreaterThan(2);
    await away();

    // Inputs equal what the kit's own script sets, for every list.
    const kitPage = await page.context().newPage();
    try {
      await kitPage.setViewportSize({ width: 1280, height: 800 });
      const hostWidth = await frame.evaluate((el) => el.parentElement!.getBoundingClientRect().width);
      await kitPage.goto(await serveKit(kitPage, new URL(page.url()).origin, kitHeader, hostWidth));
      await kitPage.waitForLoadState('networkidle');
      await kitPage.evaluate(async () => { await document.fonts.ready; });
      const kitNav = kitPage.locator('nav.pp-site-menu');
      const lists = await kitNav.locator('.pp-site-menu__item > button.pp-site-menu__trigger').evaluateAll((all) => all.map((b) => (b.textContent ?? '').trim()));
      expect(lists.length, 'the kit menu has lists').toBeGreaterThanOrEqual(3);
      const wrong: string[] = [];
      for (const name of lists) {
        await kitPage.mouse.move(5, 5); await sleep(450);
        await kitPage.mouse.move(...(await center(kitNav.getByRole('button', { name, exact: true }))));
        await sleep(700);
        const k = await readInputs(kitNav);
        await away();
        await page.mouse.move(...(await center(trigger(name))));
        await sleep(700);
        const a = await readInputs(nav);
        for (const key of ['x', 'ax', 'panelX'] as const) if (Math.abs(parse(a[key]) - parse(k[key])) > 1) wrong.push(`${name} --_${key === 'panelX' ? 'x (panel)' : key}: kit ${k[key]}, page ${a[key]}`);
        for (const key of ['sx', 'sy'] as const) if (Math.abs(parse(a[key]) - parse(k[key])) > 0.01) wrong.push(`${name} --_${key}: kit ${k[key]}, page ${a[key]}`);
        await kitPage.mouse.move(5, 5);
      }
      expect(wrong, 'the menu inputs equal what the kit script sets for the same list').toEqual([]);
    } finally {
      await kitPage.close();
    }

    // Tilt: a mouse over the open menu leans it by at most 1.2deg and 1.5deg; closed it is 0deg.
    await page.mouse.move(...(await center(trigger('Product'))));
    await sleep(600);
    const mr = (await morph.boundingBox())!;
    await page.mouse.move(mr.x + mr.width * 0.92, mr.y + mr.height * 0.92, { steps: 4 });
    await sleep(100);
    const t1 = await nav.evaluate((el) => ({ rx: (el as HTMLElement).style.getPropertyValue('--_rx'), ry: (el as HTMLElement).style.getPropertyValue('--_ry') }));
    expect(Math.abs(parse(t1.rx)), 'the menu leans up and down with the pointer').toBeGreaterThan(0.1);
    expect(Math.abs(parse(t1.ry)), 'the menu leans across with the pointer').toBeGreaterThan(0.1);
    expect(Math.abs(parse(t1.rx)), '--_rx stays within 1.2deg').toBeLessThanOrEqual(1.2 + 0.01);
    expect(Math.abs(parse(t1.ry)), '--_ry stays within 1.5deg').toBeLessThanOrEqual(1.5 + 0.01);
    await page.mouse.move(mr.x + mr.width * 0.08, mr.y + mr.height * 0.4, { steps: 4 });
    await sleep(100);
    const t2 = await nav.evaluate((el) => ({ rx: (el as HTMLElement).style.getPropertyValue('--_rx'), ry: (el as HTMLElement).style.getPropertyValue('--_ry') }));
    expect(Math.sign(parse(t2.ry)), 'the other side leans the other way').toBe(-Math.sign(parse(t1.ry)));
    // Light: follows the pointer.
    const open = nav.locator('.pp-site-menu__panel:not([inert])');
    const light = () => open.evaluate((el) => ({ gx: getComputedStyle(el).getPropertyValue('--_gx').trim(), gy: getComputedStyle(el).getPropertyValue('--_gy').trim() }));
    const pb = (await open.boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2 + 100, pb.y + 50, { steps: 3 });
    await sleep(100);
    const l1 = await light();
    expect(Math.abs(parse(l1.gx) - 100), 'the light follows the pointer across (--_gx)').toBeLessThan(8);
    expect(Math.abs(parse(l1.gy) - 50), 'the light follows the pointer down (--_gy)').toBeLessThan(8);
    await away();
    const closed = await nav.evaluate((el) => ({ rx: (el as HTMLElement).style.getPropertyValue('--_rx'), ry: (el as HTMLElement).style.getPropertyValue('--_ry') }));
    expect([parse(closed.rx), parse(closed.ry)], 'closed, the tilt is back to 0deg').toEqual([0, 0]);
    const bad = await page.evaluate(() => (window as unknown as { __sizeSet: string[] }).__sizeSet);
    expect(bad, 'no script ever set a width, height, left or top on the menu, a panel or the background').toEqual([]);
    // Without a pointer the light rests at the top centre (a fresh page: nothing has moved over this panel yet).
    await gotoGallery(page, [exampleId('header', HEADER)]);
    await page.mouse.move(5, 5);
    await trigger('Integrations').focus();
    await page.keyboard.press('Enter');
    await sleep(500);
    const rest = await light();
    expect([parse(rest.gx), parse(rest.gy)], 'with no pointer the light rests at the top centre').toEqual([0, 0]);
    await page.keyboard.press('Escape');

    // Touch: no tilt, no hover.
    const touch = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });
    try {
      const tp = await touch.newPage();
      await gotoGallery(tp, [exampleId('header', HEADER)]);
      const tframe = body(tp, 'header', HEADER).locator('.pp-site-frame');
      await tframe.scrollIntoViewIfNeeded();
      const tnav = tframe.locator('nav.pp-site-menu');
      await tnav.getByRole('button', { name: 'Product', exact: true }).tap();
      await sleep(500);
      const tb = (await tnav.locator('.pp-site-menu__morph').boundingBox())!;
      await tnav.dispatchEvent('mousemove', { clientX: tb.x + tb.width * 0.9, clientY: tb.y + tb.height * 0.9, bubbles: true });
      await sleep(100);
      const tt = await tnav.evaluate((el) => ({ rx: (el as HTMLElement).style.getPropertyValue('--_rx'), ry: (el as HTMLElement).style.getPropertyValue('--_ry') }));
      expect([parse(tt.rx), parse(tt.ry)], 'a touch pointer never tilts the menu').toEqual([0, 0]);
    } finally {
      await touch.close();
    }

    // Reduced motion: no tilt, light still follows. Still mode: no tilt, light stops.
    for (const mode of ['reduced', 'still'] as const) {
      const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
      try {
        if (mode === 'still') await ctx.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
        const cp = await ctx.newPage();
        await gotoGallery(cp, [exampleId('header', HEADER)]);
        const cframe = body(cp, 'header', HEADER).locator('.pp-site-frame');
        await cframe.scrollIntoViewIfNeeded();
        if (mode === 'still') expect(await cp.evaluate(() => document.documentElement.hasAttribute('data-site-still')), 'precondition: still mode is on').toBe(true);
        const cnav = cframe.locator('nav.pp-site-menu');
        await cp.mouse.move(...(await center(cnav.getByRole('button', { name: 'Product', exact: true }))));
        await sleep(700);
        const cm = (await cnav.locator('.pp-site-menu__morph').boundingBox())!;
        await cp.mouse.move(cm.x + cm.width * 0.92, cm.y + cm.height * 0.92, { steps: 4 });
        await sleep(150);
        const tilt = await cnav.evaluate((el) => ({ rx: (el as HTMLElement).style.getPropertyValue('--_rx'), ry: (el as HTMLElement).style.getPropertyValue('--_ry') }));
        expect([parse(tilt.rx), parse(tilt.ry)], `${mode}: the menu does not tilt`).toEqual([0, 0]);
        const copen = cnav.locator('.pp-site-menu__panel:not([inert])');
        const cpb = (await copen.boundingBox())!;
        const g0 = await copen.evaluate((el) => `${getComputedStyle(el).getPropertyValue('--_gx')}|${getComputedStyle(el).getPropertyValue('--_gy')}`);
        await cp.mouse.move(cpb.x + cpb.width / 2 + 120, cpb.y + 60, { steps: 4 });
        await sleep(150);
        const g1 = await copen.evaluate((el) => `${getComputedStyle(el).getPropertyValue('--_gx')}|${getComputedStyle(el).getPropertyValue('--_gy')}`);
        if (mode === 'reduced') expect(g1, 'reduced motion: the light still follows the pointer').not.toBe(g0);
        else expect(g1, 'still mode: the light stops').toBe(g0);
      } finally {
        await ctx.close();
      }
    }

  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 the phone sheet opens, traps focus, closes four ways and gives focus back', async ({ page }) => {
    phoneOnly();
    await gotoGallery(page, [exampleId('sheet', 'Closed (phone)')]);
    const frame = body(page, 'sheet', 'Closed (phone)').locator('.pp-site-frame');
    await frame.scrollIntoViewIfNeeded();
    const burger = frame.getByRole('button', { name: 'Open menu', exact: true });
    const sheet = frame.locator('.pp-site-sheet');
    const panel = sheet.locator('.pp-site-sheet__panel');
    const framePage = frame.locator('.pp-site-frame__page');
    const open = async () => { await burger.tap(); await expect(sheet).toHaveClass(/pp-site-sheet--open/); };
    const active = () => page.evaluate(() => ({ name: (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim(), inPanel: !!document.activeElement?.closest('.pp-site-sheet__panel') }));

    await expect(burger, 'at 390 the burger shows').toBeVisible();
    await expect(sheet, 'closed, the sheet is inert').toHaveAttribute('inert', '');
    await open();
    await expect(sheet, 'open, the sheet is not inert').not.toHaveAttribute('inert', '');
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    await expect(panel).toHaveAttribute('aria-label', 'Menu');
    await expect(burger, 'the burger tells it is open').toHaveAttribute('aria-expanded', 'true');
    await expect(framePage, 'the page behind is inert').toHaveAttribute('inert', '');
    expect(await active(), 'focus is on the button "Close menu"').toEqual({ name: 'Close menu', inPanel: true });
    const fbox = (await frame.boundingBox())!;
    const scrolls = () => page.evaluate(() => ({ win: window.scrollY, page: (document.querySelector('section[id="sheet-closed-phone"] .pp-site-frame__page') as HTMLElement).scrollTop }));
    const was = await scrolls();
    await page.mouse.move(fbox.x + 12, fbox.y + fbox.height / 2);
    await page.mouse.wheel(0, 300);
    await sleep(300);
    expect(await scrolls(), 'the page behind does not scroll while the sheet is open (a wheel over the blanket moves nothing)').toEqual(was);

    // Tab and Shift+Tab stay inside.
    const count = await panel.locator('a[href], button').count();
    expect(count, 'the sheet has links and buttons').toBeGreaterThan(10);
    for (let i = 0; i < count + 3; i++) {
      await page.keyboard.press('Tab');
      expect((await active()).inPanel, `Tab ${i + 1} stays inside the sheet`).toBe(true);
    }
    for (let i = 0; i < count + 3; i++) {
      await page.keyboard.press('Shift+Tab');
      expect((await active()).inPanel, `Shift+Tab ${i + 1} stays inside the sheet`).toBe(true);
    }

    // At least 48px of the page stays visible beside the panel; every row is at least 44px.
    const fb = (await frame.boundingBox())!;
    const pb = (await panel.boundingBox())!;
    expect(fb.width - pb.width, 'at least 48px of the page stays visible beside the panel').toBeGreaterThanOrEqual(47.5);
    const rows = await panel.locator('.pp-site-sheet__link, .pp-site-sheet__actions a').evaluateAll((all) => all.map((a) => ({ name: (a.textContent ?? '').trim(), h: a.getBoundingClientRect().height })));
    expect(rows.length, 'the sheet has rows').toBeGreaterThan(10);
    expect(rows.filter((r) => r.h < 44), 'every row is at least 44px tall').toEqual([]);

    // Four ways out, each puts focus back on the burger.
    const closedWith = async (how: string, act: () => Promise<void>) => {
      await act();
      await expect(sheet, `${how} closes the sheet`).not.toHaveClass(/pp-site-sheet--open/);
      await expect(sheet, `${how}: the sheet is inert again`).toHaveAttribute('inert', '');
      await expect(burger, `${how} puts focus back on the burger`).toBeFocused();
    };
    await closedWith('Escape', () => page.keyboard.press('Escape'));
    await open();
    await closedWith('the close button', () => frame.getByRole('button', { name: 'Close menu', exact: true }).tap());
    await open();
    await closedWith('a tap on the blanket', async () => { await page.touchscreen.tap(fb.x + 12, fb.y + fb.height / 2); });
    await open();
    // The links go nowhere yet (SITE-06 owns the targets): the test keeps the browser on the gallery, the component's own handler still runs.
    await frame.evaluate((el) => el.addEventListener('click', (e) => { if ((e.target as Element).closest('.pp-site-sheet__link')) e.preventDefault(); }, { capture: true }));
    await closedWith('a tap on a link', () => panel.locator('.pp-site-sheet__link').first().tap());
  });

  test('AC-6 at 1280 the menu button is not shown', async ({ page }) => {
    desktopOnly();
    await gotoGallery(page, [exampleId('header', 'At the top of the page (desktop)')]);
    const frame = body(page, 'header', 'At the top of the page (desktop)').locator('.pp-site-frame');
    const shown = await frame.locator('.pp-site-header__burger').evaluate((el) => (el as HTMLElement).checkVisibility() && el.getBoundingClientRect().width > 0);
    expect(shown, 'at 1280 the burger is not shown').toBe(false);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 things arrive once as they scroll in, one stagger apart, and nothing hides without JavaScript, under reduced motion or in still mode', async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const BODY = `section[id="${ARRIVAL_ID}"] [data-example-body]`;
    await gotoGallery(page, [ARRIVAL_ID]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the arrival example fits the window: nothing scrolls sideways (its stage has no fixed 1280 width)').toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-site-reveal')), { timeout: 10_000, message: '<html> carries data-site-reveal once the page has loaded' }).toBe(true);
    await sleep(1200);

    const items = page.locator(`${BODY} .pp-site-reveal`);
    const n = await items.count();
    expect(n, 'the arrival example holds hero, section head, caps and band items with reveal on').toBeGreaterThanOrEqual(8);
    expect(await page.locator(`${BODY} .pp-site-hero .pp-site-reveal`).count(), 'the hero in the arrival example arrives too: intro, eyebrow, title, lead, actions').toBe(5);
    const space = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-300')));
    const stagger = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-site-stagger')));
    expect(space, 'the space-300 token reads as pixels').toBeGreaterThan(0);
    expect(stagger, 'the stagger token reads as milliseconds').toBeGreaterThan(0);
    const look = (i: number) => items.nth(i).evaluate((el) => { const cs = getComputedStyle(el); const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform); return { opacity: Number(cs.opacity), ty: m.f, done: el.classList.contains('pp-site-reveal--in'), delay: cs.transitionDelay, i: cs.getPropertyValue('--_i').trim(), top: el.getBoundingClientRect().top + window.scrollY, h: el.getBoundingClientRect().height }; });

    // Below the fold: transparent and moved down.
    const first = await look(0);
    expect(first.done, 'an item below the fold has not arrived').toBe(false);
    expect(first.opacity, 'it is transparent').toBe(0);
    expect(Math.round(first.ty), 'it is moved down by space-300').toBe(Math.round(space));

    // Scrolling it to 15% adds the class; it ends opaque, and once.
    const vh = (await page.viewportSize())!.height;
    await page.evaluate(([top, h, vh]) => window.scrollTo(0, top! - vh! + Math.min(h!, 400) * 0.05), [first.top, first.h, vh] as const);
    await sleep(400);
    expect((await look(0)).done, 'with 5% in view it has not arrived').toBe(false);
    await page.evaluate(([top, h, vh]) => window.scrollTo(0, top! - vh! + Math.min(h!, 400) * 0.6), [first.top, first.h, vh] as const);
    await expect.poll(async () => (await look(0)).done, { message: 'with more than 15% in view it carries pp-site-reveal--in' }).toBe(true);
    await sleep(1200);
    const arrived = await look(0);
    expect(arrived.opacity, 'it ends opaque').toBe(1);
    expect(Math.abs(arrived.ty), 'it ends in place').toBeLessThan(0.5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    await page.evaluate(([top, vh]) => window.scrollTo(0, top! - vh! / 2), [first.top, vh] as const);
    await sleep(500);
    const again = await look(0);
    expect([again.done, again.opacity], 'scrolling away and back changes nothing: it stays arrived').toEqual([true, 1]);

    // One stagger apart: --_i 0, 1, 2 start 0, 1, 2 staggers late.
    const delays: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const l = await look(i);
      const k = l.i;
      if (['0', '1', '2'].includes(k) && !(k in delays)) delays[k] = parseFloat(l.delay.split(',')[0]!) * (l.delay.includes('ms') ? 1 : 1000);
    }
    expect(Object.keys(delays).sort(), 'items with --_i 0, 1 and 2 exist').toEqual(['0', '1', '2']);
    expect(Math.abs(delays['1']! - delays['0']! - stagger), '--_i 1 starts one --motion-site-stagger after --_i 0').toBeLessThan(1);
    expect(Math.abs(delays['2']! - delays['1']! - stagger), '--_i 2 starts one --motion-site-stagger after --_i 1').toBeLessThan(1);

    // Reduced motion: they fade without the rise. Still mode: everything is visible at once.
    for (const mode of ['reduced', 'still'] as const) {
      const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: isPhone(), isMobile: isPhone(), reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
      try {
        if (mode === 'still') await ctx.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
        const p = await ctx.newPage();
        await gotoGallery(p, [ARRIVAL_ID]);
        await expect.poll(() => p.evaluate(() => document.documentElement.hasAttribute('data-site-reveal')), { timeout: 10_000, message: 'data-site-reveal is set' }).toBe(true);
        await sleep(1200);
        const its = p.locator(`${BODY} .pp-site-reveal`);
        const st = await its.evaluateAll((all) => all.map((el) => { const cs = getComputedStyle(el); return { opacity: Number(cs.opacity), transform: cs.transform, inView: el.getBoundingClientRect().top < innerHeight }; }));
        const below = st.filter((x) => !x.inView);
        expect(below.length, 'some items are below the fold').toBeGreaterThan(0);
        if (mode === 'reduced') {
          expect(below.filter((x) => x.opacity !== 0), 'reduced motion: items still start transparent').toEqual([]);
          expect(below.filter((x) => x.transform !== 'none'), 'reduced motion: they are not moved down (no rise)').toEqual([]);
        } else {
          expect(st.filter((x) => x.opacity !== 1), 'still mode: every arrival is visible at once').toEqual([]);
        }
      } finally {
        await ctx.close();
      }
    }

    // No JavaScript: the arrival never hides anything. The unit-level SSR render is the builder's: it must exist and pass.
    const ssr = join(PEPLA_WEB, 'src', 'app', 'ds', 'site', 'site.ssr.spec.ts');
    expect(existsSync(ssr), 'src/app/ds/site/site.ssr.spec.ts exists (the server render of the page frame, see cards/site-02.md)').toBe(true);
    const src = readFileSync(ssr, 'utf8');
    expect(src, 'the SSR spec renders on the server').toMatch(/platform-server/);
    expect(src, 'the SSR spec checks that no item has arrived or hides').toMatch(/pp-site-reveal--in/);
    expect(src, 'the SSR spec really renders (renderApplication) and asserts the class is absent').toMatch(/renderApplication\(/);
    expect(src, 'the SSR spec asserts no item has arrived').toMatch(/not\.(toContain|toMatch)\([^)]*pp-site-reveal--in/);
    const r = execFileSync('npx', ['ng', 'test', '--watch=false', '--include', 'src/app/ds/site/site.ssr.spec.ts'], { cwd: PEPLA_WEB, encoding: 'utf8', timeout: 5 * 60_000, env: { ...process.env, CI: '1', NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0' } });
    expect(r, 'the SSR spec ran and passed').toMatch(/pass|✓/i);
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 every loop runs on the compositor, at the specified speed, slower under reduced motion and gone in still mode', async ({ browser, baseURL, page }) => {
    test.setTimeout(120_000);
    const IDS = [
      exampleId('lights', 'Three lights behind a headline'),
      exampleId('hero', isPhone() ? 'Hero, phone width' : 'Hero, desktop width'),
      exampleId('band', isPhone() ? 'Closing band, phone width' : 'Closing band, desktop width'),
      exampleId('gradient', 'Company name, flowing'),
      exampleId('gradient', 'Hairline'),
      exampleId('header', isPhone() ? 'Phone: logo, Book a demo hidden under 520px, menu button' : 'At the top of the page (desktop)'),
      exampleId('footer', isPhone() ? 'Phone: two columns, links stacked' : 'Desktop: brand, five lists and the legal row'),
      'motion-loops', // the kit's own loops (drift, turn, sweep, pulse): every one of them is judged, not only the ones named below
    ];
    type Anim = { duration: number; delay: number; state: string; props: string[]; target: string };
    const animations = (p: Page, id: string, selector: string) => p.locator(`section[id="${id}"]`).evaluate((root, sel) => {
      const out: Array<{ duration: number; delay: number; state: string; props: string[]; target: string }> = [];
      for (const a of document.getAnimations()) {
        const eff = a.effect as KeyframeEffect | null;
        const t = eff?.target as Element | null;
        if (!eff || !t || !root.contains(t) || !(t.matches(sel) || t.closest(sel))) continue;
        const props = new Set<string>();
        for (const k of eff.getKeyframes()) for (const key of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(key)) props.add(key);
        const cssDelay = parseFloat(getComputedStyle(t, eff.pseudoElement).animationDelay.split(',')[0]!) * (getComputedStyle(t, eff.pseudoElement).animationDelay.includes('ms') ? 1 : 1000);
        out.push({ duration: Number(eff.getTiming().duration), delay: cssDelay, state: a.playState, props: [...props], target: `${t.tagName.toLowerCase()}.${t.className}${eff.pseudoElement ?? ''}` });
      }
      return out;
    }, selector) as Promise<Anim[]>;
    const SEL = {
      lights: '.pp-site-light',
      heroShine: '.pp-site-hero .pp-site-shine, .pp-site-hero .pp-site-shine__glow, .pp-site-hero .pp-site-shine__copy',
      bandShine: '.pp-site-band .pp-site-shine, .pp-site-band .pp-site-shine__glow, .pp-site-band .pp-site-shine__copy',
      bandWash: '.pp-site-band',
      flowText: '.pp-site-gradient-text--flow',
      flowLine: '.pp-site-gradient-line',
      logo: '.pp-logo__mark circle',
      footerLine: '.pp-site-gradient-line',
    };
    const collect = async (p: Page) => ({
      lights: await animations(p, IDS[0]!, SEL.lights),
      heroShine: await animations(p, IDS[1]!, SEL.heroShine),
      bandShine: await animations(p, IDS[2]!, SEL.bandShine),
      bandWash: (await animations(p, IDS[2]!, SEL.bandWash)).filter((a) => !/shine|light/.test(a.target)),
      flowText: await animations(p, IDS[3]!, SEL.flowText),
      flowLine: await animations(p, IDS[4]!, SEL.flowLine),
      logo: await animations(p, IDS[5]!, SEL.logo),
      footerLine: await animations(p, IDS[6]!, SEL.footerLine),
      loopsExample: await animations(p, IDS[7]!, '*'),
    });
    const running = (a: Anim[], ms: number) => a.filter((x) => x.state === 'running' && Math.abs(x.duration - ms) < 1);

    await gotoGallery(page, IDS);
    await sleep(500);
    const normal = await collect(page);
    const onlyCompositor: string[] = [];
    for (const [kind, list] of Object.entries(normal)) for (const a of list) if (a.state === 'running') for (const pr of a.props) if (!['transform', 'opacity'].includes(pr)) onlyCompositor.push(`${kind} ${a.target} animates ${pr}`);
    expect(onlyCompositor, 'every keyframe of every running loop animates only transform and opacity').toEqual([]);
    expect(running(normal.lights, 28000).length, 'the three lights drift on 28s').toBeGreaterThanOrEqual(3);
    expect(running(normal.heroShine, 5200).length, 'the hero shine runs on its 5.2s cycle').toBeGreaterThan(0);
    expect(running(normal.bandShine, 5200).length, 'the band shine runs on its 5.2s cycle').toBeGreaterThan(0);
    expect(running(normal.bandWash, 16000).length, 'the band wash runs on 16s').toBeGreaterThan(0);
    expect(running(normal.flowText, 14000).length, 'the flowing gradient text runs on 14s').toBeGreaterThan(0);
    expect(running(normal.flowLine, 14000).length + running(normal.footerLine, 14000).length, 'the gradient line runs on 14s').toBeGreaterThan(0);
    const logo = running(normal.logo, 6000);
    expect(logo.length, "the logo's three circles run on 6s").toBe(3);
    // The circles' delays are whatever the design system's CSS gives them in the kit (today its `animation` shorthand on the
    // circle outranks the per-circle delays, so all three start together: a design system finding, noted in cards/site-02.md).
    // The Angular mark must do exactly what the kit does.
    const kitEx = kitExamples().find((e) => exampleId(e.part, e.name) === IDS[5])!;
    const kitPage = await page.context().newPage();
    try {
      await kitPage.setViewportSize(page.viewportSize()!);
      await kitPage.goto(await serveKit(kitPage, new URL(page.url()).origin, kitEx, 1000, false));
      await kitPage.waitForLoadState('networkidle');
      const delaysOf = (p: Page, scope: string) => p.evaluate((sc) => [...document.querySelector(sc)!.querySelectorAll('.pp-site-header__logo .pp-logo__mark circle')].map((c) => `${c.getAttribute('class')} ${getComputedStyle(c).animationDelay} ${getComputedStyle(c).animationDuration}`), scope);
      expect(await delaysOf(page, `section[id="${IDS[5]}"]`), "the logo's circles run with the same duration and delay as in the kit").toEqual(await delaysOf(kitPage, 'body'));
    } finally {
      await kitPage.close();
    }

    // Reduced motion: slower, and nothing stops.
    const mkCtx = (extra: object) => browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: isPhone(), isMobile: isPhone(), ...extra });
    const reduced = await mkCtx({ reducedMotion: 'reduce' });
    try {
      const p = await reduced.newPage();
      await gotoGallery(p, IDS);
      await sleep(500);
      const r = await collect(p);
      expect(running(r.lights, 56000).length, 'reduced motion: the lights run at 56s').toBeGreaterThanOrEqual(3);
      expect(running(r.logo, 12000).length, "reduced motion: the logo's circles run at 12s").toBe(3);
      expect(running(r.flowText, 28000).length + running(r.flowText, 14000).length, 'reduced motion: the flowing text does not stop').toBeGreaterThan(0);
    } finally {
      await reduced.close();
    }
    // Still mode: none of them runs, the shine shows plain violet (no glow).
    const still = await mkCtx({});
    try {
      await still.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
      const p = await still.newPage();
      await gotoGallery(p, IDS);
      await sleep(500);
      const st = await collect(p);
      const alive = Object.entries(st).flatMap(([kind, list]) => list.filter((a) => a.state === 'running').map((a) => `${kind} ${a.target} ${a.duration}`));
      expect(alive, 'still mode: no loop runs').toEqual([]);
      const glow = await p.locator(`section[id="${IDS[1]}"] .pp-site-shine__glow`).first().evaluate((el) => getComputedStyle(el).display);
      expect(glow, 'still mode: the shine glow is gone (plain violet)').toBe('none');
    } finally {
      await still.close();
    }
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 buttons: 44 and 58px, a link or a button alike, the dot grows on hover and focus without moving anything, and a 2px focus ring', async ({ page, browser, baseURL }) => {
    const small = body(page, 'button', 'Dark and line, default size');
    await gotoGallery(page, [exampleId('button', 'Dark and line, default size'), exampleId('button', 'Large, with Ask Batsi')]);
    const large = body(page, 'button', 'Large, with Ask Batsi');
    const rows = [
      { who: 'dark, default', loc: small.getByRole('link', { name: 'Book a demo' }), h: 44 },
      { who: 'line, default', loc: small.getByRole('link', { name: 'Get started' }), h: 44 },
      { who: 'dark, large', loc: large.getByRole('link', { name: 'Book a demo' }), h: 58 },
      { who: 'line, large (a button)', loc: large.getByRole('button', { name: 'Ask Batsi' }), h: 58 },
    ];
    for (const r of rows) {
      const b = (await r.loc.boundingBox())!;
      expect(Math.round(b.height), `${r.who} is ${r.h}px tall`).toBe(r.h);
    }
    expect(await large.getByRole('button', { name: 'Ask Batsi' }).evaluate((el) => el.tagName), 'the line button works as a <button>').toBe('BUTTON');
    expect(await small.getByRole('link', { name: 'Get started' }).evaluate((el) => el.tagName), 'and as an <a>').toBe('A');
    expect(await large.getByRole('button', { name: 'Ask Batsi' }).locator('svg').count(), 'the line button with sparkles shows its icon').toBe(1);
    expect(await large.getByRole('button', { name: 'Ask Batsi' }).evaluate((el) => { const svg = el.querySelector('svg')!; return !!(svg.compareDocumentPosition(el.lastChild!) & Node.DOCUMENT_POSITION_FOLLOWING) || svg === el.firstElementChild; }), 'the icon is before the label').toBe(true);

    const dark = small.getByRole('link', { name: 'Book a demo' });
    const neighbours = async () => ({ dark: await dark.boundingBox(), line: await small.getByRole('link', { name: 'Get started' }).boundingBox(), wrap: await small.locator('> *').first().boundingBox() });
    const shot = async () => { const b = (await dark.boundingBox())!; return page.screenshot({ clip: { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) }, animations: 'disabled' }); };
    await page.mouse.move(2, 2);
    await dark.scrollIntoViewIfNeeded();
    await sleep(600);
    const still0 = await neighbours();
    const before = await shot();
    // Hover: the dot grows (pixels change inside) and nothing moves.
    const box = (await dark.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(700);
    const hovered = await shot();
    const grew = !before.equals(hovered);
    if (isPhone()) {
      expect(await neighbours(), 'on a touch pointer nothing moves').toEqual(still0);
    } else {
      expect(grew, 'on hover the dot grows: pixels change inside the button').toBe(true);
      expect(await neighbours(), "on hover the button's box and its neighbours' boxes do not move by a pixel").toEqual(still0);
      await page.mouse.move(2, 2);
      await sleep(700);
      // Keyboard focus: the same growth, no movement, a 2px ring.
      await page.keyboard.press('Shift');
      await dark.focus();
      await sleep(700);
      const focused = await shot();
      expect(before.equals(focused), 'on keyboard focus the dot grows').toBe(false);
      expect(await neighbours(), 'on focus nothing moves').toEqual(still0);
      const ring = await dark.evaluate((el) => { const cs = getComputedStyle(el); return { w: cs.outlineWidth, s: cs.outlineStyle }; });
      expect(ring, 'focus shows a 2px ring').toEqual({ w: '2px', s: 'solid' });
    }
    // Still mode: the design system holds the hover without its transition (`[data-site-still] ... transition: none`), so the
    // hover state is there at once, not 700ms later.
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: isPhone(), isMobile: isPhone() });
    try {
      await ctx.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
      const p = await ctx.newPage();
      await gotoGallery(p, [exampleId('button', 'Dark and line, default size')]);
      const d = body(p, 'button', 'Dark and line, default size').getByRole('link', { name: 'Book a demo' });
      await d.scrollIntoViewIfNeeded();
      const b = (await d.boundingBox())!;
      const clip = { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) };
      await p.mouse.move(2, 2);
      await sleep(300);
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(60);
      const early = await p.screenshot({ clip, animations: 'disabled' });
      await sleep(700);
      const late = await p.screenshot({ clip, animations: 'disabled' });
      expect(early.equals(late), 'under data-site-still the hover state is there at once: nothing animates').toBe(true);
    } finally {
      await ctx.close();
    }
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 hero, section, caps and band lay out by their own width, name themselves by their heading and scroll below the header', async ({ page }) => {
    once('each width is set on the example\'s own stage: a 390 stage on a 1280 window and a 1280 stage');
    test.setTimeout(120_000);
    const HERO = exampleId('hero', 'Hero, desktop width');
    const SECTION = exampleId('section', 'Section on white');
    const CAPS = exampleId('caps', 'Four columns, two with the Batsi tag');
    const BAND = exampleId('band', 'Closing band, desktop width');
    await gotoGallery(page, [HERO, SECTION, CAPS, BAND, ARRIVAL_ID]);
    const stage = (id: string) => page.locator(`section[id="${id}"] .pp-site-stage`).first();
    const setWidth = async (id: string, w: number) => {
      await stage(id).evaluate((el, w) => { const e = el as HTMLElement; e.style.inlineSize = `${w}px`; e.style.maxInlineSize = 'none'; e.style.minInlineSize = '0'; }, w);
      await frames(page);
    };
    const box = (loc: Locator) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; });
    const tracks = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter((t) => t.trim()).length);
    const font = (loc: Locator) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    // Hero.
    const hero = page.locator(`section[id="${HERO}"] .pp-site-hero`);
    for (const [w, two] of [[390, false], [1000, false], [1100, true], [1280, true]] as const) {
      await setWidth(HERO, w);
      const intro = await box(hero.locator('.pp-site-hero__intro > p').first());
      const chips = await box(hero.locator('.pp-site-hero__chips'));
      if (two) expect(chips.x, `hero ${w}: the intro and the chips sit in two columns`).toBeGreaterThanOrEqual(intro.r - 1);
      else expect(chips.y, `hero ${w}: the chips stack under the intro`).toBeGreaterThanOrEqual(intro.b - 1);
    }
    for (const [w, side] of [[390, false], [500, false], [560, true], [1280, true]] as const) {
      await setWidth(HERO, w);
      const actions = await box(hero.locator('.pp-site-hero__actions'));
      const a = await box(hero.locator('.pp-site-hero__actions .pp-site-button').nth(0));
      const b = await box(hero.locator('.pp-site-hero__actions .pp-site-button').nth(1));
      if (side) { expect(b.x, `hero ${w}: the buttons sit side by side`).toBeGreaterThanOrEqual(a.r - 1); expect(Math.abs(a.y - b.y), `hero ${w}: on one row`).toBeLessThan(2); }
      else { expect(b.y, `hero ${w}: the buttons stack`).toBeGreaterThanOrEqual(a.b - 1); expect(Math.abs(a.w - actions.w) + Math.abs(b.w - actions.w), `hero ${w}: each button is full width`).toBeLessThan(3); }
    }
    expect(await hero.locator('h1').count(), 'the hero has exactly one h1').toBe(1);
    expect(await hero.locator('h1 > *').count(), 'the headline has two lines (a line and the accent line)').toBe(2);
    const h1 = hero.locator('h1');
    await setWidth(HERO, 390);
    const f390 = await font(h1);
    expect(Math.abs(f390 - 46), 'the headline is 46px on a phone').toBeLessThan(0.6);
    await setWidth(HERO, 800);
    const f800 = await font(h1);
    await setWidth(HERO, 1920);
    const f1920 = await font(h1);
    expect(f800, 'the headline grows with the width').toBeGreaterThan(f390);
    expect(f1920, 'and keeps growing').toBeGreaterThanOrEqual(f800);
    expect(f1920, 'to at most 140px').toBeLessThanOrEqual(140.5);

    // Section head: one column, two from 1024.
    const head = page.locator(`section[id="${SECTION}"] .pp-site-section__head`);
    for (const [w, n] of [[390, 1], [1000, 1], [1100, 2]] as const) { await setWidth(SECTION, w); expect(await tracks(head), `section head ${w}: ${n} column${n > 1 ? 's' : ''}`).toBe(n); }

    // Caps: one column, two from 768, four from 1080; each item with a 2px top rule and an h3.
    const caps = page.locator(`section[id="${CAPS}"] .pp-site-caps`);
    for (const [w, n] of [[390, 1], [760, 1], [800, 2], [1070, 2], [1100, 4]] as const) { await setWidth(CAPS, w); expect(await tracks(caps), `caps ${w}: ${n} column${n > 1 ? 's' : ''}`).toBe(n); }
    const itemInfo = await caps.locator('.pp-site-caps__item').evaluateAll((all) => all.map((el) => ({ rule: getComputedStyle(el).borderTopWidth, h3: el.querySelectorAll('h3').length })));
    expect(itemInfo.length, 'four caps items').toBe(4);
    expect(itemInfo.filter((i) => i.rule !== '2px' || i.h3 !== 1), 'each caps item has a 2px top rule and an h3').toEqual([]);

    // Band: title from 52px, growing to 168px; the buttons stack below 520.
    const band = page.locator(`section[id="${BAND}"] .pp-site-band`);
    const title = band.locator('.pp-site-band__title');
    await setWidth(BAND, 390);
    const b390 = await font(title);
    expect(Math.abs(b390 - 52), 'the band title is 52px on a phone').toBeLessThan(0.6);
    await setWidth(BAND, 1920);
    const b1920 = await font(title);
    expect(b1920, 'the band title grows with the width').toBeGreaterThan(b390);
    expect(b1920, 'to at most 168px').toBeLessThanOrEqual(168.5);
    for (const [w, side] of [[500, false], [560, true], [1280, true]] as const) {
      await setWidth(BAND, w);
      const a = await box(band.locator('.pp-site-band__actions .pp-site-button').nth(0));
      const b = await box(band.locator('.pp-site-band__actions .pp-site-button').nth(1));
      if (side) expect(b.x, `band ${w}: the buttons sit side by side`).toBeGreaterThanOrEqual(a.r - 1);
      else expect(b.y, `band ${w}: the buttons stack`).toBeGreaterThanOrEqual(a.b - 1);
    }

    // Named by their heading, and a link target leaves the headline below the header.
    const sections = await page.locator('section[aria-labelledby]').evaluateAll((all) => all.map((el) => { const by = el.getAttribute('aria-labelledby')!; const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); return { cls: el.className, by, name: t, margin: parseFloat(getComputedStyle(el).scrollMarginTop) }; }));
    expect(sections.length, 'the hero, the band and the arrival sections are named by aria-labelledby').toBeGreaterThanOrEqual(3);
    expect(sections.filter((x) => !x.name), 'every aria-labelledby points at a heading with words').toEqual([]);
    const marks = await page.locator('.pp-site-band').evaluateAll((all) => all.map((el) => ({ cls: el.className, margin: parseFloat(getComputedStyle(el).scrollMarginTop) })));
    expect(marks.filter((m) => m.margin < 72), 'a link target leaves room for the 72px header above the band').toEqual([]);
    const anchorMargins = await page.locator('.pp-site-section, .pp-site-section__anchor').evaluateAll((all) => all.map((el) => parseFloat(getComputedStyle(el).scrollMarginTop)));
    expect(Math.max(...anchorMargins), 'a section (or its anchor) leaves room for the header too').toBeGreaterThanOrEqual(72);
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 no axe violations (WCAG A and AA) with a menu open or the sheet open, one landmark of each kind, one h1 in the hero', async ({ page }) => {
    test.setTimeout(180_000);
    const axe = async (what: string) => {
      // The shine copy is an aria-hidden gradient-filled duplicate of a title (the real words sit beside it): its fill is a gradient, so axe cannot judge it. The words themselves are still checked.
      // A looping fade (the agent lozenge pulses to 40% opacity) makes contrast depend on the moment: judge the resting look.
      await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.pp-site-shine__copy').analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `axe finds no violations ${what}`).toEqual([]);
    };
    await gotoGallery(page);
    await axe(`on /dev/site at ${page.viewportSize()!.width} wide`);

    // The page's own landmarks.
    expect(await page.locator('main').count(), 'the gallery has exactly one main').toBe(1);
    const dup = await page.evaluate(() => { const seen = new Map<string, number>(); for (const el of Array.from(document.querySelectorAll('[id]'))) seen.set(el.id, (seen.get(el.id) ?? 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); });
    expect.soft(dup, 'no id is used twice (every frame has its own main id and skip link target)').toEqual([]);
    const HEADER = body(page, 'header', 'At the top of the page (desktop)');
    expect(await page.locator(`section[id="${exampleId('header', 'At the top of the page (desktop)')}"] header`).count(), 'a frame has one header').toBe(1);
    expect(await page.locator(`section[id="${exampleId('header', 'At the top of the page (desktop)')}"]`).getByRole('navigation', { name: 'Main', exact: true, includeHidden: true }).count(), 'a frame has one nav named "Main"').toBe(1);
    const FOOTER = isPhone() ? 'Phone: two columns, links stacked' : 'Desktop: brand, five lists and the legal row';
    const fsec = page.locator(`section[id="${exampleId('footer', FOOTER)}"]`);
    expect(await fsec.locator('footer').count(), 'the footer example has one footer').toBe(1);
    await expect(fsec.locator('footer'), 'the footer is named "Site footer"').toHaveAttribute('aria-label', 'Site footer');
    expect(await fsec.getByRole('navigation', { name: 'Footer', exact: true, includeHidden: true }).count(), 'one nav named "Footer"').toBe(1);
    void HEADER;
    const heroSec = page.locator(`section[id="${exampleId('hero', isPhone() ? 'Hero, phone width' : 'Hero, desktop width')}"]`);
    expect(await heroSec.locator('h1').count(), 'exactly one h1 in the hero').toBe(1);

    // A menu open on one list (a live one), and at 390 the sheet open.
    await gotoGallery(page, [exampleId('header', isPhone() ? 'Phone: logo, Book a demo hidden under 520px, menu button' : 'At the top of the page (desktop)'), exampleId('sheet', 'Closed (phone)')]);
    if (!isPhone()) {
      const nav = page.locator('nav.pp-site-menu').first();
      await nav.getByRole('button', { name: 'Integrations', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(nav).toHaveClass(/pp-site-menu--open/);
      await sleep(600);
      await axe('with the Integrations list open');
    } else {
      const frame = body(page, 'sheet', 'Closed (phone)').locator('.pp-site-frame');
      await frame.getByRole('button', { name: 'Open menu', exact: true }).tap();
      await expect(frame.locator('.pp-site-sheet')).toHaveClass(/pp-site-sheet--open/);
      await sleep(600);
      await axe('with the sheet open at 390');
    }
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 signed-in code is untouched: no site script on /sign-in or /hr, no import of ds/site outside the site, the design system page renders as before', async ({ page, signIn, hr }) => {
    desktopOnly();
    test.setTimeout(120_000);
    // Static: who imports ds/site.
    const appDir = join(PEPLA_WEB, 'src', 'app');
    const importers: string[] = [];
    const walkTs = (dir: string) => { for (const e of readdirSync(dir)) { const f = join(dir, e); if (statSync(f).isDirectory()) walkTs(f); else if (/\.(ts|html)$/.test(e) && !/\.spec\.ts$/.test(e)) { const text = readFileSync(f, 'utf8'); if (/ds\/site\b|\/site\/index|from '\.\/site'|from '\.\.\/site'/.test(text) || (/ds[\\/]all\.ts$/.test(f) && /site/i.test(text))) importers.push(relative(appDir, f).split(sep).join('/')); } } };
    walkTs(appDir);
    const allowed = (f: string) => f.startsWith('ds/site/') || f.startsWith('features/public/') || f.startsWith('dev/') || f === 'site.routes.ts' || f === 'app.routes.ts' || f === 'app.routes.server.ts';
    expect(importers.filter((f) => !allowed(f)), 'nothing but the site itself, the public pages and the dev gallery imports ds/site').toEqual([]);
    expect(readFileSync(join(appDir, 'ds', 'all.ts'), 'utf8'), 'ds/all.ts (the gallery list) does not list a site part').not.toMatch(/ds\/site|PpSite|from '\.\/site/);
    const signedIn = readdirSync(join(appDir, 'features')).filter((d) => d !== 'public');
    expect(signedIn.length, 'there are signed-in feature folders').toBeGreaterThan(0);

    // Dynamic: no script holding site code is loaded on /sign-in or /hr.
    const loaded: Array<Promise<{ url: string; text: string }>> = [];
    page.context().on('response', (r) => {
      const js = /javascript|ecmascript/.test(r.headers()['content-type'] ?? '') || /\.m?js(\?|$)/.test(new URL(r.url()).pathname);
      if (r.request().resourceType() === 'script' || js) loaded.push(r.text().then((text) => ({ url: r.url(), text }), () => ({ url: r.url(), text: '' })));
    });
    const carriers = async (where: string) => (await Promise.all(loaded.splice(0))).filter((s) => /pp-site-|ppSite|PpSite/.test(s.text)).map((s) => `${where}: ${new URL(s.url).pathname}`);
    await signIn.open();
    await expect(signIn.heading).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await carriers('/sign-in'), 'no script that /sign-in loads holds site code').toEqual([]);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome back, ${hr.givenName}`, exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await carriers('/hr'), 'no script that /hr loads holds site code').toEqual([]);

    // The design system page still renders every component it did before (none is lost, none site-specific is added).
    await page.goto('/dev/design-system');
    await page.locator('section').first().waitFor();
    await page.waitForLoadState('networkidle');
    expect(await page.locator('section').count(), '/dev/design-system still shows its sections').toBeGreaterThanOrEqual(12);
    expect(await page.locator('[class*="pp-site-"]').count(), '/dev/design-system shows no site part').toBe(0);
  });

  // -------------------------------------------------------------- AC-13
  test('AC-13 the production build with the new components passes the public-names check, and /dev/site carries no old name', async ({ page }) => {
    desktopOnly();
    test.setTimeout(20 * 60_000);
    const script = join(PEPLA_WEB, 'scripts', 'verify-public-names.mjs');
    expect(existsSync(script), 'scripts/verify-public-names.mjs exists').toBe(true);
    const build = execFileSync('npm', ['run', 'build'], { cwd: PEPLA_WEB, encoding: 'utf8', timeout: 15 * 60_000, env: { ...process.env, NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0', NO_COLOR: '1' } });
    expect(build, 'npm run build ran the public-names check').toMatch(/verify-public-names|public names|no "pepla"/i);
    const out = join(PEPLA_WEB, 'dist', 'pepla-web', 'browser');
    const files = (function all(dir: string): string[] { return readdirSync(dir).flatMap((e) => { const f = join(dir, e); return statSync(f).isDirectory() ? all(f) : [f]; }); })(out);
    const withSite = files.filter((f) => /\.(m?js)$/.test(f) && /pp-site-gallery|Public site parts|pp-site-hero__title/.test(readFileSync(f, 'utf8')));
    expect(withSite.length, 'the production build includes the new site components (the dev gallery chunk)').toBeGreaterThan(0);
    // The shared style sheet also holds the app's own old class names (not site parts): judge only the rules that name a site part.
    const siteRuleNamed = (css: string) => css.split('}').some((rule) => /pp-site/i.test(rule) && /pepla/i.test(rule));
    const named = files.filter((f) => /\.(html|m?js|css|json|svg|webmanifest|txt|xml)$/.test(f)).filter((f) => {
      const text = readFileSync(f, 'utf8');
      if (/\.css$/.test(f)) return siteRuleNamed(text);
      return /pepla/i.test(text) && /pp-site-gallery|Public site parts|pp-site-/.test(text);
    }).map((f) => relative(out, f));
    expect(named, 'no built file that holds site components carries the old name, in any case').toEqual([]);
    const post = execFileSync('node', [script], { cwd: PEPLA_WEB, encoding: 'utf8' });
    expect(post, 'the check scanned files').toMatch(/\b[1-9]\d*\s+(?:\w+\s+)?files?\b/i);

    await gotoGallery(page);
    const html = await page.content();
    expect(html, 'the rendered /dev/site holds no "pepla" in text, attribute, class or href').not.toMatch(/pepla/i);
  });
});
