# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ang-01.spec.ts >> ANG-01 Board asks first, and the Modules button >> AC-16 The sync brings today's phone rules in: smaller phone tabs with no icons and an edge fade, full-width page header actions, stacked tables
- Location: e2e/acceptance/ang-01.spec.ts:570:7

# Error details

```
Error: the ref is not develop's older sync (1cee4a5)

expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
```

# Test source

```ts
  473 |       const s = await theSection(page, name);
  474 |       const b = launcher(s.locator('pp-top-navigation'));
  475 |       await expect(b, `"${name}" has the Modules button`).toBeVisible();
  476 |       const start = await launcherClicks(s);
  477 |       if (phone()) await b.tap(); else await b.click();
  478 |       await expect.poll(() => launcherClicks(s), `"${name}": a ${phone() ? 'tap' : 'click'} adds one`).toBe(start + 1);
  479 |       await b.focus();
  480 |       await page.keyboard.press('Enter');
  481 |       await expect.poll(() => launcherClicks(s), `"${name}": Enter adds one`).toBe(start + 2);
  482 |       await b.focus();
  483 |       await page.keyboard.press('Space');
  484 |       await expect.poll(() => launcherClicks(s), `"${name}": Space adds one`).toBe(start + 3);
  485 |     }
  486 | 
  487 |     const focused = () => page.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e ? (e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '') : ''; });
  488 |     if (!phone()) {
  489 |       const bar = (await theSection(page, SECTIONS.launcher)).locator('pp-top-navigation');
  490 |       await launcher(bar).focus();
  491 |       await page.keyboard.press('Tab');
  492 |       await expect(bar.getByRole('searchbox'), 'desktop: Tab from Modules goes to search').toBeFocused();
  493 |       await page.keyboard.press('Shift+Tab');
  494 |       await expect(launcher(bar), 'and Shift+Tab from search comes back to Modules').toBeFocused();
  495 |     } else {
  496 |       const bar = (await theSection(page, SECTIONS.launcherPhone)).locator('pp-top-navigation');
  497 |       const menu = bar.getByRole('button', { name: 'Open menu', exact: true });
  498 |       await menu.focus();
  499 |       await page.keyboard.press('Tab');
  500 |       await expect(launcher(bar), `phone: Tab from the menu button goes to Modules (focus is on "${await focused()}")`).toBeFocused();
  501 |       await page.keyboard.press('Shift+Tab');
  502 |       await expect(menu, 'and Shift+Tab from Modules goes back to the menu button').toBeFocused();
  503 |     }
  504 |   });
  505 | 
  506 |   // -------------------------------------------------------------- AC-13
  507 |   test('AC-13 No axe violations on either top bar section', async ({ page }) => {
  508 |     await openParity(page);
  509 |     for (const name of [SECTIONS.launcher, SECTIONS.launcherPhone]) {
  510 |       const s = await theSection(page, name);
  511 |       await expect(launcher(s.locator('pp-top-navigation')), `"${name}" has the Modules button`).toBeVisible();
  512 |       const axe = await new AxeBuilder({ page }).include(`[data-parity$=${JSON.stringify('|' + name)}]`).withTags(AXE_TAGS).analyze();
  513 |       expect(axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `axe finds no violation in "${name}"`).toEqual([]);
  514 |     }
  515 |   });
  516 | 
  517 |   // ================================================================ Design system
  518 |   // -------------------------------------------------------------- AC-14
  519 |   test('AC-14 One source: sync.json is pinned and matches the synced files, the synced CSS hides the launcher word on phones and in compact, verify:design passes', async ({ page, browser }) => {
  520 |     once('reads the repository and runs verify:design once; it opens its own 1280 and 390 windows');
  521 |     test.setTimeout(3 * 60_000);
  522 |     const manifest = JSON.parse(readFileSync(join(DS_DIR, 'sync.json'), 'utf8')) as { repo: string; ref: string; files: Record<string, string> };
  523 |     expect(manifest.repo, 'synced from the design system repo').toBe('obsydian-tech/pepla-design-system');
  524 |     expect(manifest.ref, 'the ref is a full commit (40 hex), not a branch, a tag or a local sync').toMatch(/^[0-9a-f]{40}$/);
  525 |     expect(Object.keys(manifest.files), 'sync.json lists components.css').toContain('components.css');
  526 |     for (const [file, hash] of Object.entries(manifest.files)) expect(sha256(readFileSync(join(DS_DIR, file))), `${file} is the synced file (hash matches sync.json)`).toBe(hash);
  527 | 
  528 |     // The Modules button as the app renders it, put into a page that has nothing but the synced design system CSS.
  529 |     await openParity(page);
  530 |     const s = await theSection(page, SECTIONS.launcher);
  531 |     const b = launcher(s.locator('pp-top-navigation'));
  532 |     await expect(b, 'the gallery has the Modules button').toBeVisible();
  533 |     const button = await b.evaluate((el) => el.outerHTML);
  534 |     const order = ['tokens/palette.css', 'tokens/colors.css', 'tokens/typography.css', 'tokens/spacing.css', 'tokens/shape.css', 'tokens/motion.css', 'tokens/layers.css', 'tokens/base.css', 'components.css'];
  535 |     const css = order.map((f) => readFileSync(join(DS_DIR, f), 'utf8')).join('\n').replace(/url\((['"]?)\.\.?\/?assets\/[^)]*\)/g, 'none');
  536 |     const html = (compact: boolean) => `<!doctype html><html><head><style>${css}</style></head><body>
  537 |       <header class="pp-top-navigation pp-top-navigation--inline${compact ? ' pp-top-navigation--compact' : ''}">${button}
  538 |         <label class="pp-top-navigation__search"><input class="pp-top-navigation__search-input" type="search" aria-label="Search people and documents"></label>
  539 |         <div class="pp-top-navigation__actions"></div></header></body></html>`;
  540 |     for (const [width, compact, shown, why] of [
  541 |       [1280, false, true, 'desktop shows the word'],
  542 |       [390, false, false, 'the phone breakpoint hides the word'],
  543 |       [1280, true, false, 'the compact bar hides the word'],
  544 |     ] as const) {
  545 |       const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  546 |       try {
  547 |         const p = await ctx.newPage();
  548 |         await p.setContent(html(compact));
  549 |         const lone = p.getByRole('button', { name: WORDS.modules, exact: true });
  550 |         await expect(lone).toBeVisible();
  551 |         expect(await wordShown(lone), `synced components.css alone: ${why} (${width} wide${compact ? ', compact' : ''})`).toBe(shown);
  552 |       } finally {
  553 |         await ctx.close();
  554 |       }
  555 |     }
  556 | 
  557 |     let out = '';
  558 |     let ok = true;
  559 |     try {
  560 |       out = execFileSync('npm', ['run', 'verify:design'], { cwd: PEPLA_WEB, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  561 |     } catch (e) {
  562 |       ok = false;
  563 |       const err = e as { stdout?: string; stderr?: string };
  564 |       out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  565 |     }
  566 |     expect(ok, `npm run verify:design passes:\n${out.slice(-2000)}`).toBe(true);
  567 |   });
  568 | 
  569 |   // -------------------------------------------------------------- AC-16
  570 |   test('AC-16 The sync brings today\'s phone rules in: smaller phone tabs with no icons and an edge fade, full-width page header actions, stacked tables', async ({ page, browser }) => {
  571 |     const manifest = JSON.parse(readFileSync(join(DS_DIR, 'sync.json'), 'utf8')) as { ref: string; files: Record<string, string> };
  572 |     expect(manifest.ref, 'the ref is a full commit (40 hex)').toMatch(/^[0-9a-f]{40}$/);
> 573 |     expect(manifest.ref.startsWith('1cee4a5'), 'the ref is not develop\'s older sync (1cee4a5)').toBe(false);
      |                                                                                                  ^ Error: the ref is not develop's older sync (1cee4a5)
  574 |     expect(sha256(readFileSync(join(DS_DIR, 'components.css'))), 'components.css is the synced file').toBe(manifest.files['components.css']);
  575 |     // "At or after be254e2" is read from the CSS: these rules came with design system PR #48 (be254e2).
  576 |     const css = readFileSync(join(DS_DIR, 'components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  577 |     for (const [rule, why] of [
  578 |       ['.pp-tabs__tab > svg { display: none; }', 'phone tabs have no icon'],
  579 |       ['.pp-tabs__tab { min-height: var(--size-control-large); padding: 0 var(--space-100); }', 'phone tabs are smaller'],
  580 |       ['.pp-page-header__actions > .pp-button--primary { flex: 1 1 auto; min-width: max-content;', 'the page header\'s actions take the full width on phone'],
  581 |       ['.pp-table--stack th[scope="row"] {', 'stacked tables stack a row header too'],
  582 |       ['.pp-table--stack .pp-person { display: flex;', 'a person in a stacked row fits the line'],
  583 |     ] as const) expect(css, `the synced components.css has the be254e2 rule: ${why}`).toContain(rule);
  584 |     expect(css, 'the tab strip fades at its edge on phone (mask on .pp-tabs__list)').toMatch(/\.pp-tabs__list \{[^}]*mask-image:/);
  585 | 
  586 |     // The tab rules hold at 767px and below, and not above: the app's own tab strip, in a page with only the synced CSS.
  587 |     await openParity(page);
  588 |     const tabs = await theSection(page, 'With icons, one locked');
  589 |     const strip = await tabs.locator('.pp-tabs').first().evaluate((el) => el.outerHTML);
  590 |     const order = ['tokens/palette.css', 'tokens/colors.css', 'tokens/typography.css', 'tokens/spacing.css', 'tokens/shape.css', 'tokens/motion.css', 'tokens/layers.css', 'tokens/base.css', 'components.css'];
  591 |     const all = order.map((f) => readFileSync(join(DS_DIR, f), 'utf8')).join('\n').replace(/url\((['"]?)\.\.?\/?assets\/[^)]*\)/g, 'none');
  592 |     // Once, from the desktop strip (the 390 run checks the page itself below).
  593 |     for (const [width, phoneRules] of (phone() ? [] : [[767, true], [768, false]]) as Array<[number, boolean]>) {
  594 |       const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  595 |       try {
  596 |         const p = await ctx.newPage();
  597 |         await p.setContent(`<!doctype html><html><head><style>${all}</style></head><body>${strip}</body></html>`);
  598 |         const got = await p.evaluate(() => ({
  599 |           icons: [...document.querySelectorAll('.pp-tabs__tab > svg')].filter((s) => (s as SVGElement).checkVisibility()).length,
  600 |           all: document.querySelectorAll('.pp-tabs__tab > svg').length,
  601 |           mask: [...document.querySelectorAll('.pp-tabs__list')].map((l) => { const cs = getComputedStyle(l); return cs.maskImage || cs.webkitMaskImage; }).some((m) => !!m && m !== 'none'),
  602 |         }));
  603 |         expect(got.all, 'the tab strip has icons to hide').toBeGreaterThan(0);
  604 |         expect(got.icons, `${width} wide: tab icons are ${phoneRules ? 'hidden' : 'shown'}`).toBe(phoneRules ? 0 : got.all);
  605 |         expect(got.mask, `${width} wide: the edge fade is ${phoneRules ? 'on' : 'off'}`).toBe(phoneRules);
  606 |       } finally {
  607 |         await ctx.close();
  608 |       }
  609 |     }
  610 | 
  611 |     // On /dev/parity: no tab icon at 390 (shown at 1280), and the stacked table shows rows as blocks that fit.
  612 |     const icons = tabs.locator('.pp-tabs__tab > svg');
  613 |     expect(await icons.count(), '"With icons, one locked" has tab icons in its markup').toBeGreaterThan(0);
  614 |     const shownIcons = await icons.evaluateAll((list) => list.filter((s) => (s as SVGElement).checkVisibility()).length);
  615 |     expect(shownIcons, phone() ? 'at 390 no tab shows an icon' : 'at 1280 every tab shows its icon').toBe(phone() ? 0 : await icons.count());
  616 |     const table = (await theSection(page, 'New starters')).locator('table.pp-table--stack');
  617 |     await expect(table, '"New starters" is a table with stack').toHaveCount(1);
  618 |     const layout = await table.evaluate((t: HTMLTableElement) => ({
  619 |       rows: [...t.tBodies[0].rows].map((r) => getComputedStyle(r).display),
  620 |       cells: [...t.tBodies[0].rows].flatMap((r) => [...r.cells].map((c) => getComputedStyle(c).display)),
  621 |       inside: t.scrollWidth - (t.parentElement?.clientWidth ?? t.clientWidth),
  622 |       past: t.getBoundingClientRect().right - document.documentElement.clientWidth,
  623 |     }));
  624 |     if (phone()) {
  625 |       expect(layout.rows.filter((d) => d === 'table-row'), 'at 390 every row is a stacked block, not a table row').toEqual([]);
  626 |       expect(layout.cells.filter((d) => d === 'table-cell'), 'at 390 no cell sits in a table column').toEqual([]);
  627 |       expect(layout.inside, 'the stacked table is no wider than its frame (no horizontal scroll)').toBeLessThanOrEqual(0);
  628 |       expect(layout.past, 'the stacked table ends inside the window').toBeLessThanOrEqual(0.5);
  629 |     } else {
  630 |       expect(layout.rows.every((d) => d === 'table-row'), 'at 1280 the table is a table').toBe(true);
  631 |     }
  632 |   });
  633 | 
  634 |   // -------------------------------------------------------------- AC-15
  635 |   test('AC-15 Nothing else moved: only the card\'s files change, and the HR and employee top bars are as they were', async ({ page, signIn, hr, employee }) => {
  636 |     test.setTimeout(2 * 60_000);
  637 |     if (!phone()) {
  638 |       let base = '';
  639 |       for (const ref of ['origin/develop', 'develop']) { try { base = git('merge-base', 'HEAD', ref); break; } catch { /* next */ } }
  640 |       // CI checks out the pull request's merge commit with no develop branch: its first parent is develop's tip.
  641 |       if (!base && process.env['GITHUB_ACTIONS'] === 'true') {
  642 |         try { git('rev-parse', '--verify', '-q', 'HEAD^1'); } catch { git('fetch', '--no-tags', '--quiet', '--depth=2', 'origin', process.env['GITHUB_SHA'] ?? git('rev-parse', 'HEAD')); }
  643 |         try { base = git('rev-parse', 'HEAD^1'); } catch { /* stays empty */ }
  644 |       }
  645 |       expect(base, 'develop is known (git merge-base HEAD origin/develop)').not.toBe('');
  646 |       const changed = git('diff', '--name-only', '--no-renames', base, 'HEAD', '--', '.').split('\n').filter(Boolean).map((f) => f.replace(/^pepla-web\//, ''));
  647 |       // Judged on a pull request that carries this card's tests (the lock and the build); another card's PR is not.
  648 |       if (changed.some((f) => /^e2e\/acceptance\/(ang-01\.spec\.ts|support\/ang-01\/|cards\/ang-01\.md)/.test(f))) {
  649 |         const allowed = (f: string) =>
  650 |           /^e2e\/acceptance\/(ang-01\.spec\.ts|cards\/ang-01\.md)$/.test(f) ||
  651 |           /^e2e\/acceptance\/support\/ang-01\//.test(f) ||
  652 |           /^src\/app\/ds\/records\/pipeline\.ts$/.test(f) ||
  653 |           /^src\/app\/ds\/navigation\/shell\.ts$/.test(f) ||
  654 |           /^src\/app\/dev\/(parity|design-system)\.page\.(ts|html)$/.test(f) ||
  655 |           /^src\/app\/ds\/README\.md$/.test(f) ||
  656 |           /^src\/styles\/design-system\//.test(f);
  657 |         expect(changed.filter((f) => !allowed(f)), 'no file outside the card\'s list changes').toEqual([]);
  658 |       }
  659 |     }
  660 | 
  661 |     // The HR and employee pages keep their bars: no Modules button, the same controls as develop.
  662 |     await signIn.open();
  663 |     await signIn.signInAs(hr);
  664 |     await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
  665 |     await page.waitForLoadState('networkidle');
  666 |     await expect(page.locator('pp-top-navigation'), 'HR has one top bar').toHaveCount(1);
  667 |     expect(await barControls(page.locator('pp-top-navigation')), 'HR\'s top bar is as on develop, with no Modules button').toEqual(HR_BAR[project()]);
  668 |     await forgetSignIn(page);
  669 |     await signIn.open();
  670 |     await signIn.signInAs(employee);
  671 |     await expect(page).toHaveURL(/\/start/, { timeout: 20_000 });
  672 |     await page.waitForLoadState('networkidle');
  673 |     await expect(page.locator('pp-top-navigation'), 'the employee has one top bar').toHaveCount(1);
```