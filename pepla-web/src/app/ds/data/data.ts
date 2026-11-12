import { ChangeDetectionStrategy, Component, Directive, ElementRef, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { AvatarColour, PpAvatar } from '../core/avatar';
import { PpMaskedField } from '../records/records';
import { PpAgentMark } from '../agent/agent';
import { PpLink } from '../actions/link';
import { PpOverflowRegion } from './overflow-region';

/**
 * A card: one thing, with a title. No card inside a card (Calm rule 9); group inside with
 * `appearance="sunken"`, a list or a divider.
 * ```html
 * <pp-card heading="Laptop and email setup" subheading="For Thandeka Dlamini" icon="laptop">
 *   <pp-card-aside>…</pp-card-aside>   body   <pp-card-footer align="end">…</pp-card-footer>
 * </pp-card>
 * ```
 * Spec: data/card.md
 */
@Component({
  selector: 'pp-card, a[ppCard]',
  imports: [PpIcon, PpAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (heading() && compact() && !icon()) {
      <span class="pp-card__title">{{ heading() }}</span>
      @if (subheading()) { <span class="pp-card__subtitle">{{ subheading() }}</span> }
    } @else if (heading()) {
      <header class="pp-card__header">
        @if (person()) { <pp-avatar [name]="person()!" size="large" [colour]="personColour()" [decorative]="true" /> }
        @else if (icon()) { <span class="pp-icon-tile" [class.pp-icon-tile--brand]="iconTone() === 'brand'" [class.pp-icon-tile--agent]="iconTone() === 'agent'"><svg [ppIcon]="icon()!" size="medium" /></span> }
        <div class="pp-card__titles">
          @switch (level()) {
            @case (2) { <h2 class="pp-card__title">{{ heading() }}</h2> }
            @case (4) { <h4 class="pp-card__title">{{ heading() }}</h4> }
            @default { <h3 class="pp-card__title">{{ heading() }}</h3> }
          }
          @if (subheading()) { <p class="pp-card__subtitle">{{ subheading() }}</p> }
        </div>
        <ng-content select="pp-card-aside" />
      </header>
    }
    <ng-content />
    <ng-content select="pp-card-footer" />
  `,
  host: { '[class]': 'classes()', '[attr.aria-current]': 'isLink && selected() ? "true" : null' },
})
export class PpCard {
  /** `<a ppCard routerLink="…">` is a card you open or pick (a template, a plan); `selected` marks the chosen one. */
  protected readonly isLink = inject(ElementRef).nativeElement.tagName === 'A';
  readonly heading = input<string>();
  readonly subheading = input<string>();
  /** The heading's level in the page's outline: 2 for a card that is a section of the page, 3 inside one. */
  readonly level = input<2 | 3 | 4>(3);
  readonly icon = input<IconName>();
  readonly iconTone = input<'neutral' | 'brand' | 'agent'>('brand');
  /** A card about one person: their avatar in place of the icon. */
  readonly person = input<string>();
  readonly personColour = input<AvatarColour>();
  readonly appearance = input<'raised' | 'sunken' | 'overlay'>('raised');
  readonly compact = input(false);
  readonly flush = input(false);
  readonly selected = input(false);
  protected readonly classes = computed(() => ['pp-card',
    this.appearance() !== 'raised' && `pp-card--${this.appearance()}`,
    this.isLink && !this.selected() && 'pp-card--interactive',
    this.compact() && 'pp-card--compact', this.flush() && 'pp-card--flush', this.selected() && 'pp-card--selected'].filter(Boolean).join(' '));
}

/** A card's lines of text, in the card's quieter body style: `<div ppCardBody>Dell Latitude 5440, …</div>`. Other content (a list, a table, an empty state) goes straight in the card. */
@Directive({ selector: 'div[ppCardBody], p[ppCardBody]', host: { class: 'pp-card__body' } })
export class PpCardBody {}

@Component({ selector: 'pp-card-aside', template: '<ng-content />', host: { class: 'pp-card__aside' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpCardAside {}

@Component({
  selector: 'pp-card-footer', template: '<ng-content />', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pp-card__footer', '[class.pp-card__footer--end]': 'align() === "end"', '[attr.align]': 'null' },
})
export class PpCardFooter { readonly align = input<'start' | 'end'>('start'); }

/** Cards in a responsive grid. */
@Component({ selector: 'pp-card-grid', template: '<ng-content />', host: { class: 'pp-card-grid' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpCardGrid {}

export type StatMetaTone = 'neutral' | 'attention' | 'danger' | 'good' | 'agent';

/**
 * A label and a number (Calm rule 7). The meta line only when it asks for attention.
 * `<pp-stat label="Documents waiting" icon="file-text" [value]="12" meta="2 due tomorrow" metaTone="attention" link="/documents" />`
 * Spec: data/stat-card.md
 */
@Component({
  selector: 'pp-stat',
  imports: [PpIcon, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #inner>
      <span class="pp-stat__label">@if (icon()) {<svg [ppIcon]="icon()!" />}{{ label() }}</span>
      <span class="pp-stat__value">{{ value() }}</span>
      @if (meta()) { <span class="pp-stat__meta" [class]="metaTone() !== 'neutral' ? 'pp-stat__meta--' + metaTone() : ''">@if (metaIcon()) {<svg [ppIcon]="metaIcon()!" />}{{ meta() }}</span> }
    </ng-template>
    @if (link()) { <a class="pp-stat" [routerLink]="link()"><ng-container *ngTemplateOutlet="inner" /></a> }
    @else { <div class="pp-stat"><ng-container *ngTemplateOutlet="inner" /></div> }
  `,
})
export class PpStat {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly icon = input<IconName>();
  readonly meta = input<string>();
  readonly metaTone = input<StatMetaTone>('neutral');
  readonly link = input<string>();
  protected readonly metaIcon = computed<IconName | undefined>(() => ({ neutral: undefined, attention: 'clock', danger: 'octagon-alert', good: 'circle-check', agent: 'sparkles' } as const)[this.metaTone()]);
}

/** A row of stat cards. */
@Component({ selector: 'pp-stat-row', template: '<ng-content />', host: { class: 'pp-stat-row' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpStatRow {}

/**
 * A description list whose values need more than words (a lozenge, a person, a masked value):
 * `<dl ppDl><dt>By</dt><dd><pp-person …/></dd></dl>`. Plain facts use `<pp-description-list>`.
 */
@Directive({ selector: 'dl[ppDl]', host: { '[class]': '"pp-dl" + (layout() !== "columns" ? " pp-dl--" + layout() : "")' } })
export class PpDl { readonly layout = input<'columns' | 'stacked' | 'strip'>('columns'); }

export interface DlItem {
  term: string;
  value?: string | null;
  /** Where Batsi read it ("From ID document"); shows the agent mark. */
  source?: string;
  link?: string;
  /**
   * Personal data, hidden until someone shows it (a Masked field): `{ masked: '•••••••••0876', value, record: 'Thandeka Dlamini' }`.
   * Showing is recorded first. `notice` on the first one on a page says "Revealing is recorded".
   */
  reveal?: { masked: string; value: string; record: string; notice?: boolean; maskedLabel?: string };
}

/**
 * Facts about one thing, as label and value. Empty values say "Not set". Masked values use
 * `<pp-masked-field>` instead. Spec: data/description-list.md
 */
@Component({
  selector: 'pp-description-list',
  // A component host is inline by default; this one wraps blocks, and screens may give it Layout classes.
  styles: ':host { display: block; }',
  imports: [PpIcon, RouterLink, PpMaskedField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl [class]="'pp-dl' + (layout() !== 'columns' ? ' pp-dl--' + layout() : '')">
      @for (i of items(); track i.term) {
        <dt>{{ i.term }}</dt>
        <dd>
          @if (i.reveal; as r) { <pp-masked-field [field]="i.term" [record]="r.record" [value]="r.value" [masked]="r.masked" [notice]="!!r.notice" [maskedLabel]="r.maskedLabel" /> }
          @else if (i.value === null || i.value === undefined || i.value === '') { <span class="pp-dl__notset">Not set</span> }
          @else if (i.link) { <a [routerLink]="i.link">{{ i.value }}</a> }
          @else {{{ i.value }}}
          @if (i.source) { <span class="pp-dl__source"><svg ppIcon="sparkles" />{{ i.source }}</span> }
        </dd>
      }
      <ng-content />
    </dl>
  `,
})
export class PpDescriptionList {
  readonly items = input<DlItem[]>([]);
  readonly layout = input<'columns' | 'stacked' | 'strip'>('columns');
}

// ------------------------------------------------------------------ table (short lists; long ones use <pp-table>)

/** A short table: `<pp-table-wrap><table ppTable caption="New starters">…</table></pp-table-wrap>`. Spec: data/table.md */
@Directive({
  selector: 'table[ppTable]',
  host: { '[class]': '"pp-table" + (compact() ? " pp-table--compact" : "") + (stack() ? " pp-table--stack" : "")' },
})
export class PpTableDirective {
  readonly compact = input(false);
  /** On phones, each row becomes a stacked card; cells need `label`. */
  readonly stack = input(false);
}

/** Scrolls a wide table sideways inside its card instead of the page. */
@Component({ selector: 'pp-table-wrap', template: '<ng-content />', styles: ':host { display: block; }', host: { class: 'pp-table-wrap' }, hostDirectives: [PpOverflowRegion], changeDetection: ChangeDetectionStrategy.OnPush })
export class PpTableWrap {}

/**
 * A cell: `<td ppCell label="Start date">17 Nov 2026</td>`. `ppCell="num"` right-aligns numbers;
 * `ppCell="actions"` holds the row's menu. `label` is shown on phones when rows stack.
 */
@Directive({
  selector: 'td[ppCell], th[ppCell]',
  host: {
    '[class.pp-table__num]': 'ppCell() === "num"',
    '[class.pp-table__actions]': 'ppCell() === "actions"',
    '[class.pp-table__check]': 'ppCell() === "check"',
    '[class.pp-table__empty]': 'ppCell() === "empty"',
    '[attr.data-label]': 'label() ?? null',
  },
})
export class PpCell {
  /** `empty` is the one cell of a table with no rows yet: say why and what to do. */
  readonly ppCell = input<'' | 'text' | 'num' | 'actions' | 'check' | 'empty'>('');
  readonly label = input<string>();
}

/** A sortable column header: `<th ppSortHeader [direction]="dir" (sort)="…">Person</th>` */
@Component({
  selector: 'th[ppSortHeader]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button class="pp-table__sort" type="button" (click)="sort.emit(direction() === 'ascending' ? 'descending' : 'ascending')"><ng-content />@if (direction() !== 'none') {<svg [ppIcon]="direction() === 'ascending' ? 'arrow-up' : 'arrow-down'" />}</button>`,
  host: { scope: 'col', '[attr.aria-sort]': 'direction()' },
})
export class PpSortHeader {
  readonly direction = input<'ascending' | 'descending' | 'none'>('none');
  readonly sort = output<'ascending' | 'descending'>();
}

/** A value this person may not see: `<pp-restricted-cell />` shows a lock and "Hidden". */
@Component({
  selector: 'pp-restricted-cell', imports: [PpIcon], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pp-table__restricted"><svg ppIcon="lock" />{{ text() }}</span>`,
})
export class PpRestrictedCell { readonly text = input('Hidden'); }

// ------------------------------------------------------------------ accordion and timeline

/**
 * One collapsible section, on the native `<details>`: `<details ppAccordionItem heading="Branding" meta="1 accent colour">…</details>`.
 * Add `open` to start it open. Spec: data/accordion.md
 */
@Component({
  selector: 'details[ppAccordionItem]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <summary class="pp-accordion__header"><span class="pp-accordion__title">{{ heading() }}</span>@if (meta()) {<span class="pp-accordion__meta">{{ meta() }}</span>}<svg ppIcon="chevron-down" class="pp-accordion__chevron" /></summary>
    <div class="pp-accordion__panel"><ng-content /></div>
  `,
  host: { class: 'pp-accordion__item' },
})
export class PpAccordionItem {
  readonly heading = input.required<string>();
  readonly meta = input<string>();
}

@Component({ selector: 'pp-accordion', template: '<ng-content />', host: { class: 'pp-accordion' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpAccordion {}

export interface TimelineEvent {
  /** Who did it: a person's name, or "Batsi" for the agent. Leave it out for something that happened (an ID check came back). */
  actor?: string;
  /** The person's avatar colour, from their record. */
  colour?: AvatarColour;
  /** For an event with no actor: the icon and its tone. */
  icon?: IconName;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
  /** The rest of the sentence after the actor: "drafted Kagiso's offer letter". */
  summary: string;
  /** Words at the end of the sentence that matter most, in bold: "everything matches", "overdue by 1 day". */
  emphasis?: string;
  detail?: string;
  /** An icon before the detail, such as eye for "revealed". */
  detailIcon?: IconName;
  /** A change, shown as old struck through, an arrow, and new. `label` is read out first: "Stage changed". */
  change?: { from: string; to: string; label?: string };
  /** Someone's own words: a note or a reason. */
  quote?: string;
  /** Just happened: highlighted until the person has seen it. */
  fresh?: boolean;
  /** Batsi had a hand in it: "Drafted by Batsi" after the summary. */
  agent?: string;
  /** What came of something Batsi did or suggested, for the agent activity log. Always an icon and words. */
  outcome?: TimelineOutcome;
  /** When, in words ("2 hours ago"), and the exact time for the tooltip and datetime. */
  when: string;
  at: string;
  exact: string;
}
export interface TimelineOutcome {
  /** approved: green tick; failed: red words; waiting: needs someone. Leave out for a plain grey line. */
  tone?: 'approved' | 'failed' | 'waiting';
  icon: IconName;
  text: string;
  /** A link inside the words: `text`, then the link, then `after`. */
  link?: { label: string; to: string };
  after?: string;
}
export interface TimelineDay { day: string; events: TimelineEvent[]; }

/**
 * What happened, newest first. Group by day with `days`, or pass a short list as `events`.
 * `hasMore` adds "Show older events" (the `more` output); `loading` shows placeholders; with nothing
 * to show it says `empty`. Spec: data/timeline.md
 */
@Component({
  selector: 'pp-timeline',
  imports: [PpAvatar, PpIcon, NgTemplateOutlet, PpAgentMark, PpLink, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #event let-e>
      <li class="pp-timeline__event" [class.pp-timeline__event--new]="e.fresh">
        <span class="pp-timeline__marker" aria-hidden="true">
          @if (e.actor) { <pp-avatar [name]="e.actor === 'Batsi' ? 'Batsi' : e.actor" [kind]="e.actor === 'Batsi' ? 'agent' : 'person'" [colour]="e.colour" [decorative]="true" /> }
          @else { <span class="pp-timeline__icon" [class]="e.tone && e.tone !== 'neutral' ? 'pp-timeline__icon--' + e.tone : ''"><svg [ppIcon]="e.icon ?? 'circle-dot'" /></span> }
        </span>
        <div class="pp-timeline__content">
          <span class="pp-timeline__summary">@if (e.actor) {<strong>{{ e.actor }}</strong>&ngsp;}{{ e.summary }}@if (e.emphasis) {&ngsp;<strong>{{ e.emphasis }}</strong>}@if (e.agent) {&ngsp;<pp-agent-mark [text]="e.agent" />}</span>
          @if (e.change) {
            <span class="pp-timeline__detail"><span class="pp-visually-hidden">{{ e.change.label ?? 'Changed' }} from</span><del>{{ e.change.from }}</del>&ngsp;<svg ppIcon="arrow-right" />&ngsp;<span class="pp-visually-hidden">to</span><ins>{{ e.change.to }}</ins></span>
          } @else if (e.detail) {
            <span class="pp-timeline__detail">@if (e.detailIcon) {<svg [ppIcon]="e.detailIcon" />&ngsp;}{{ e.detail }}</span>
          }
          @if (e.outcome; as o) {
            <span class="pp-agent-log__outcome" [class]="o.tone ? 'pp-agent-log__outcome--' + o.tone : ''"><svg [ppIcon]="o.icon" /><span>{{ o.text }}@if (o.link) {&ngsp;<a ppLink [routerLink]="o.link.to">{{ o.link.label }}</a>}{{ o.after }}</span></span>
          }
          @if (e.quote) { <span class="pp-timeline__quote">{{ e.quote }}</span> }
          <time class="pp-timeline__time" [attr.datetime]="e.at" [title]="e.exact">{{ e.when }}</time>
        </div>
      </li>
    </ng-template>
    @if (loading()) {
      <div class="pp-stack pp-gap-200" role="status" [attr.aria-label]="'Loading ' + label().charAt(0).toLowerCase() + label().slice(1)">
        @for (i of [1, 2, 3]; track i) {
          <div class="pp-inline pp-inline--nowrap pp-inline--top pp-gap-150"><span class="pp-skeleton pp-skeleton--avatar-small"></span><span class="pp-grow"><span class="pp-skeleton pp-skeleton--text"></span><span class="pp-skeleton pp-skeleton--text pp-skeleton--text-short"></span></span></div>
        }
      </div>
    } @else if (!days().length && !events().length) {
      <ol class="pp-timeline"><li class="pp-timeline__empty">{{ empty() }}</li></ol>
    } @else {
      <ol class="pp-timeline" [class.pp-timeline--compact]="compact()" [attr.aria-label]="label()">
        @for (d of days(); track d.day) {
          <li class="pp-timeline__day"><span role="heading" aria-level="3">{{ d.day }}</span></li>
          @for (e of d.events; track $index) { <ng-container [ngTemplateOutlet]="event" [ngTemplateOutletContext]="{ $implicit: e }" /> }
        }
        @for (e of events(); track $index) { <ng-container [ngTemplateOutlet]="event" [ngTemplateOutletContext]="{ $implicit: e }" /> }
        @if (hasMore()) { <li class="pp-timeline__more"><button class="pp-button pp-button--subtle pp-button--small" type="button" (click)="more.emit()">Show older events</button></li> }
      </ol>
    }
  `,
})
export class PpTimeline {
  /** "History for Kagiso Molefe". */
  readonly label = input.required<string>();
  readonly days = input<TimelineDay[]>([]);
  readonly events = input<TimelineEvent[]>([]);
  readonly compact = input(false);
  readonly hasMore = input(false);
  readonly loading = input(false);
  readonly empty = input('Nothing has happened yet.');
  readonly more = output<void>();
}
