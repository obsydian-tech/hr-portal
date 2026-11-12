import { test, expect } from '../support/help';

/**
 * Checks the help-mode plumbing on the design system gallery until the first
 * real screen lands. Replace with real journeys (Today, People, Onboard...).
 */
test('Design system gallery opens', async ({ page, help }) => {
  help.video('dev/gallery-tour');
  await page.goto('/dev/design-system');
  await expect(page.locator('body')).not.toBeEmpty();
  await help.step('This is the design system gallery');
  await help.shot('dev/gallery');
});
