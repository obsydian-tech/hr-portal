import type { Page } from '@playwright/test';

/**
 * HELP-02.3 · Waits until every web font the page's text uses has loaded and
 * been painted, so a help picture and its reference draw the same letters.
 *
 * Why: the app loads Inter and Manrope from Google Fonts with display=swap, so
 * text first paints in a fallback font and swaps when the file arrives. On a
 * busy CI runner a picture was sometimes taken before a Manrope or Inter file
 * had swapped in; that one difference moved the HR home picture by 0.011
 * (desktop) to 0.017 (phone) against its reference, over the 0.01 limit.
 *
 * It asks the browser to load each font (style, weight, family) that an element
 * with its own text is drawn in, waits for the font set to settle and for two
 * frames, then fails with the names of any font that still is not loaded, so a
 * missing font file is reported as such instead of as a picture difference.
 * Used before every help picture (e2e/support/help.ts) and every reference picture.
 */
export async function settleFonts(page: Page): Promise<void> {
  const missing = await page.evaluate(async () => {
    const specs = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || !n.parentElement) continue;
      const s = getComputedStyle(n.parentElement);
      specs.add(`${s.fontStyle} ${s.fontWeight} 16px ${s.fontFamily}`);
    }
    await Promise.all([...specs].map((spec) => document.fonts.load(spec).catch(() => [])));
    await document.fonts.ready;
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    return [...specs].filter((spec) => !document.fonts.check(spec));
  });
  if (missing.length) throw new Error(`settleFonts: these fonts did not load: ${missing.join(' | ')}`);
}
