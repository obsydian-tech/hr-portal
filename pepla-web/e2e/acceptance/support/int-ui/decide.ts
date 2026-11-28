import type { Locator, Page } from '@playwright/test';
import { SW as SUMMARY_WORDS } from './summary';
import { expect, main } from './summary';
import { personHeader } from '../rec-ui-02/record';

/**
 * INT-UI-06 · Decide (Jira NH-275, epic NH-223, amber; lock acceptance-lock/int-ui-06): the words and the page helpers of
 * int-ui-06.spec.ts. Spec: specs/interview-journey/cards/INT-UI-06.md, section "Changes after spec check round 1 (28 Nov)" (it wins over
 * the text above it): rules 1 to 11 with R-1 to R-4 and O-1 to O-9, AC-1 to AC-11, decisions D1 to D10. Its checks:
 * INT-UI-06-spec-check.md and INT-UI-06-spec-check-round-2.md (T-1 to T-3). Where the spec is silent, cards/int-ui-06.md says what these
 * tests take (T-D1 up).
 *
 * No new fake: the record (support/rec-ui-02/record.ts) already sends `can_decide`, `can_move` and `next_step.blocker` per candidate;
 * the harness (support/rec-ui/harness.ts) answers the move as moveCandidate does (400 REASON_REQUIRED, 409 INTERVIEWS_INCOMPLETE from the
 * candidate's interview counts, one answer per request key) and `refuse()` sets 403, 409 STAGE_CHANGED or 500; the interviews, scores,
 * Schedule and Not hired fakes are INT-UI-01/02/05's and REC-UI-01's. Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (one list, so a later child lock changes one place)
/** Approved by Iggie 25 Nov 2026 19:42 SAST (W-14, W-9d) and the placements W-N6a and W-N6b under rule 7a (spec "Words", O-5). */
export const DW = {
  /** W-14 button and the confirm before a pick (W-N6a). */
  decide: 'Decide',
  /** The three choices, in kit order. */
  move: 'Move to Offer',
  book: 'Book another interview',
  notHired: 'Not hired',
  cancel: 'Cancel',
  /** The drawer's own close button (design system, ds/overlays/overlays.ts 130; R-2). */
  close: 'Close',
  /** W-9d, and its danger placement after a 409 INTERVIEWS_INCOMPLETE (W-N6b). */
  blocked: 'Every required interview must be done first.',
} as const;
export const CHOICES = [DW.move, DW.book, DW.notHired] as const;
/** W-14 title. */
export const titleOf = (name: string): string => `Decide on ${name}`;
/** The Schedule drawer's line (rule 3). */
export const lineOf = (name: string, roleTitle: string): string => `${name} · ${roleTitle}`;
/** INT-UI-01's line, also on the phone Decide page (rule 4). */
export const requiredLine = (done: number, total: number): string => `${done} of ${total} required interviews done`;
/** Every word INT-UI-05's block may draw (R-2). */
export { SUMMARY_WORDS };
/** Words never shown (AC-9). */
export const BAD = /⟦|⟧|\b(null|undefined|NaN)\b|Invalid Date|\[object Object\]|\b(INTERVIEWS_INCOMPLETE|STAGE_CHANGED|OFFER|INTERVIEW|STRONG_YES|STRONG_NO)\b|MARK/;

// ---------------------------------------------------------------- where things are
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** The header's Decide (rule 1): a button inside the person header. */
export const decideButton = (page: Page): Locator => personHeader(page).getByRole('button', { name: DW.decide, exact: true });
/** The Decide control under the summary (rule 8): a "Decide" button or link in `main` that is not in the person header. */
export const decideLink = (page: Page): Locator =>
  main(page).locator(':is(button, a[href], [role="button"], [role="link"]):not(.pp-person-header *)').filter({ hasText: new RegExp(`^\\s*${DW.decide}\\s*$`) });
/** The desktop drawer: the dialog named by the title. */
export const drawerOf = (page: Page, name: string): Locator => page.getByRole('dialog', { name: titleOf(name), exact: true });
/** T-D1: the phone page is `main` holding a level 1 heading with the title (it replaces the record's content, rule 4). */
export const phoneTitle = (page: Page, name: string): Locator => main(page).getByRole('heading', { level: 1, name: titleOf(name), exact: true });
/** Decide as it is open at this width: the drawer at 1280, `main` at 390. */
export const decideOf = (page: Page, name: string): Locator =>
  (isPhone(page) ? main(page).filter({ has: page.getByRole('heading', { level: 1, name: titleOf(name), exact: true }) }) : drawerOf(page, name));
/** T-D2: the choices are the radios of the radio group named by the title (O-7). */
export const groupOf = (scope: Locator, name: string): Locator => scope.getByRole('radiogroup', { name: titleOf(name), exact: true });
/** A choice's radio, by the words of its label (its description is not part of the match). */
export const choice = (scope: Locator, words: string): Locator => scope.getByRole('radio', { name: new RegExp(`^${esc(words)}(\\s|$)`) });
/** T-D3: the confirm button is the one button of Decide whose name is "Decide" or a choice. */
export const confirmOf = (scope: Locator): Locator => scope.getByRole('button', { name: new RegExp(`^(${[DW.decide, ...CHOICES].map(esc).join('|')})$`) });
export const cancelOf = (scope: Locator): Locator => scope.getByRole('button', { name: DW.cancel, exact: true });

/** Is Decide open, at either width (any drawer named "Decide on …", or a level 1 "Decide on …" in main)? */
export const anyDecide = (page: Page): Locator =>
  page.getByRole('dialog', { name: /^Decide on / }).or(main(page).getByRole('heading', { level: 1, name: /^Decide on / }));

/** Opens Decide with the header button and waits for it. */
export async function pressDecide(page: Page, name: string): Promise<Locator> {
  await expect(decideButton(page)).toBeVisible();
  await decideButton(page).click();
  const d = decideOf(page, name);
  await expect(isPhone(page) ? phoneTitle(page, name) : d).toBeVisible();
  return d;
}

export type ChoiceRead = { label: string; description: string; checked: boolean; disabled: boolean };
/** The choices in order: label without its description, the description (aria-describedby or the kit's description part), state. */
export async function readChoices(scope: Locator, name: string): Promise<ChoiceRead[]> {
  const g = groupOf(scope, name);
  await expect(g, 'one radio group named by the title').toHaveCount(1);
  return g.evaluate((el) => {
    const t = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    return [...el.querySelectorAll('input[type="radio"]')].map((r) => {
      const input = r as HTMLInputElement;
      const label = (input.id && document.querySelector(`label[for="${input.id}"]`)) || input.closest('label');
      const copy = label ? (label.cloneNode(true) as HTMLElement) : null;
      copy?.querySelectorAll('.pp-radio__description').forEach((x) => x.remove());
      const described = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map((id) => t(document.getElementById(id))).filter(Boolean);
      const part = t(label?.querySelector('.pp-radio__description'));
      return { label: t(copy), description: [...new Set([...described, ...(part ? [part] : [])])].join(' '), checked: input.checked, disabled: input.disabled };
    });
  });
}

/** Every visible text and accessible name inside an element (as INT-UI-05's wordsIn, with input values and placeholders). */
export async function wordsOf(l: Locator): Promise<string[]> {
  return l.evaluate((root) => {
    const out = new Set<string>();
    const add = (t: string | null | undefined) => { const s = (t ?? '').replace(/[\s  ]+/g, ' ').trim(); if (s) out.add(s); };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode as Text;
      const el = n.parentElement;
      if (!el || el.closest('[aria-hidden="true"], svg, script, style')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      add(n.nodeValue);
    }
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (e.closest('[aria-hidden="true"]')) continue;
      add(e.getAttribute('aria-label'));
      for (const id of (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) add(document.getElementById(id)?.textContent);
      add(e.getAttribute('title'));
      add(e.getAttribute('placeholder'));
    }
    return [...out];
  });
}

/** The page's address now, as search parameters. */
export const addressOf = async (page: Page): Promise<URLSearchParams> => new URL(page.url()).searchParams;
/** How many history entries the tab has. */
export const historyLength = (page: Page): Promise<number> => page.evaluate(() => history.length);
