import type { Page } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { WHO, enter, quiet, test } from './support/rec-ui/harness';
import { W, expect } from './support/rec-ui-02/lists';

/**
 * Candidates and Pipeline list: the filter row lines up. Not a lock of the REC-UI-02 criteria: a check on how the row
 * looks. The search box, the Role and Stage pickers and More filters share one bottom edge and one height, wherever
 * a picker carries a label above it and the others do not. SHOTS=<folder> also saves pictures.
 */
const phone = () => test.info().project.name === 'phone-390';

async function rowBoxes(page: Page) {
  const main = page.locator('main');
  const parts = {
    search: main.locator('.pp-search').first(),
    role: main.getByLabel('Role', { exact: true }).locator('xpath=..'),
    stage: main.getByLabel('Stage', { exact: true }).locator('xpath=..'),
    more: main.getByRole('button', { name: W.moreFilters, exact: true }),
  };
  const out: Record<string, { top: number; bottom: number; height: number }> = {};
  for (const [k, loc] of Object.entries(parts)) {
    if (!(await loc.count())) continue;
    const b = (await loc.first().boundingBox())!;
    out[k] = { top: b.y, bottom: b.y + b.height, height: b.height };
  }
  return out;
}

for (const [name, path] of [['Candidates', '/hire/candidates'], ['Pipeline list', '/hire/pipeline']] as const) {
  test(`The ${name} filter row: search, pickers and More filters share a bottom edge and a height`, async ({ page, signIn, cognito, modules, hire }) => {
    test.skip(ON_DEV, 'Runs in the no-backend run only.');
    await enter(page, signIn, cognito, modules, hire, WHO.recruiterA);
    await page.goto(path);
    await quiet(page);
    await page.locator('main').getByRole('button', { name: W.moreFilters, exact: true }).waitFor();
    if (process.env['SHOTS']) await page.screenshot({ path: `${process.env['SHOTS']}/${name.replace(' ', '-')}-${phone() ? '390' : '1280'}.png` });
    const b = await rowBoxes(page);
    // The row may wrap on a phone; a control only has to line up with the ones on its own line.
    const items = Object.values(b);
    for (const a of items) for (const c of items) {
      if (Math.abs(a.top - c.top) < a.height) { // same line
        expect(Math.abs(a.bottom - c.bottom), `bottom edges on one line (${JSON.stringify(b)})`).toBeLessThanOrEqual(1);
      }
    }
    // On a phone the design system lifts text fields and pickers to 48px but leaves a small button at 32px (a gap to raise in
    // pepla-design-system), so the height check is for desktop.
    if (phone()) return;
    expect(Math.max(...items.map((i) => i.height)) - Math.min(...items.map((i) => i.height)), `heights (${JSON.stringify(b)})`).toBeLessThanOrEqual(1);
  });
}
