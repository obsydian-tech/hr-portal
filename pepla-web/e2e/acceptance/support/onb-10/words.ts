/**
 * ONB-10: the card's new words, in ONE place so a words-only change after Iggie's answer touches this file only.
 *
 * W-1 to W-4 are PROPOSED in the spec (/mnt/project-files/onboarding-cards/specs/ONB-10.md, "Words") and wait for
 * Iggie. They are the design system's own deadline words and the kit's "2 overdue". Nothing else in the tests
 * spells these words out: every other file takes them from here.
 */

/** The plural-aware "{n} day(s)". */
export const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

/** W-1 chip on a required document still to give; W-4 the same words against a person on HR home (overdue only). */
export const chipWords = (state: 'later' | 'soon' | 'today' | 'overdue', n: number): string =>
  state === 'today' ? 'Due today' : state === 'overdue' ? `Overdue by ${days(n)}` : `Due in ${days(n)}`;

/** W-2 the date line under the chip. `dateText` is "24 Nov 2026". */
export const dueLine = (dateText: string): string => `Due ${dateText}`;

/** W-3 the count under the Documents count on HR home, only when n is above zero. */
export const overdueCount = (n: number): string => `${n} overdue`;

/** Every deadline word the pages may show: used to find a stray line in a row or a cell. */
export const DEADLINE_LINE = /^(Due in \d+ days?|Due today|Overdue by \d+ days?|Due \d{1,2} [A-Z][a-z]{2} \d{4}|\d+ overdue)$/;
