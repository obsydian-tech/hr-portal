import type { IconName } from '../../core/icon.registry';

// The words of a Learn more page, as data. Every string in the content files is copied from the design system kit
// ("Site pages", "Learn more top", "Learn more ending"); the components never hold page words of their own.

/** One step of the breadcrumb. The last one has no link and names the page. */
export interface LearnCrumb { label: string; href?: string }

/** The top of a Learn more page, without its hero card (that is the page's own, projected into the page). */
export interface LearnTop {
  crumb: readonly LearnCrumb[];
  eyebrow: string;
  /** The headline up to its shine line, and the shine line. */
  title: string;
  shine: string;
  lead: string;
  /** The "Built for" list. */
  chips: readonly string[];
  /** Turning rings behind the top (Recruitment and Onboarding have them). */
  rings: boolean;
}

/** A row in one of Ask Batsi's answers: the thing, the status tone ('' is neutral) and the status words. */
export type LearnRow = readonly [label: string, tone: string, status: string];

/** One of the three sample questions. With `ask`, the answer ends with an action that waits for a person. */
export interface LearnQuestion {
  q: string;
  a: string;
  rows: readonly LearnRow[];
  ask?: string;
  button?: string;
  done?: string;
  log?: string;
}

export interface LearnAsk { key: string; title: string; lead: string; questions: readonly LearnQuestion[] }
export interface LearnStrip { label: string; items: readonly { icon: IconName; text: string }[]; link?: { text: string; href: string } }
export interface LearnTile { icon: IconName; title: string; text: string; href: string }
export interface LearnFaq { lead: string; link: { text: string; href: string }; items: readonly { q: string; a: string }[] }

/** What closes a Learn more page: Ask Batsi, the strip, "Works together with" and the questions. */
export interface LearnEnding { ask: LearnAsk; strip: LearnStrip; related: readonly LearnTile[]; faq: LearnFaq }

/** The words beside a demo's panel. `batsi` adds the Batsi tag after the point. */
export interface LearnDemoText {
  eyebrow: string;
  title: string;
  lead: string;
  points: readonly { text: string; batsi?: boolean }[];
}

/** A tab of the sub-menu: the id of the section it leads to, and its name. */
export interface LearnTab { id: string; label: string }
