import { PpField } from '../forms/field';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { uid } from '../util';

/** A count. `<pp-badge appearance="danger" label="overdue">3</pp-badge>`. Spec: status/badge.md */
@Component({
  selector: 'pp-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ dot() ? '' : shown() }}@if (label()) {<span class="pp-badge__label"> {{ label() }}</span>}`,
  host: {
    '[class]': 'classes()',
    '[attr.aria-hidden]': 'dot() || hidden() ? "true" : null',
  },
})
export class PpBadge {
  /** `aria-hidden="true"` when the button it sits on already says the count. */
  readonly hidden = input(false, { alias: 'aria-hidden', transform: (v: unknown) => v === '' || v === true || v === 'true' });
  readonly count = input<number>(0);
  readonly max = input(99);
  readonly appearance = input<'default' | 'primary' | 'danger' | 'agent' | 'subtle'>('default');
  /** Words for screen readers after the number: "overdue" reads "3 overdue". */
  readonly label = input<string>();
  readonly dot = input(false);
  protected readonly shown = computed(() => (this.count() > this.max() ? `${this.max()}+` : String(this.count())));
  protected readonly classes = computed(() => ['pp-badge', this.appearance() !== 'default' && `pp-badge--${this.appearance()}`, this.dot() && 'pp-badge--dot'].filter(Boolean).join(' '));
}

/** Puts a badge on the corner of an icon button: `<pp-badge-anchor><button …/><pp-badge …/></pp-badge-anchor>` */
@Component({ selector: 'pp-badge-anchor', template: '<ng-content />', host: { class: 'pp-badge-anchor' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpBadgeAnchor {}

export type TagColour = 'blue' | 'sky' | 'green' | 'lime' | 'yellow' | 'amber' | 'red' | 'magenta' | 'violet' | 'gray';

/** A label someone set: department, skill. Not a status. `<pp-tag colour="blue">Finance</pp-tag>`. Spec: status/tag.md */
@Component({
  selector: 'pp-tag, a[ppTag]',
  imports: [PpIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #words><ng-content /></ng-template>
    @if (removable()) {
      <span class="pp-tag__text"><ng-container [ngTemplateOutlet]="words" /></span>
      <button class="pp-tag__remove" type="button" [attr.aria-label]="'Remove ' + text()" (click)="remove.emit()"><svg ppIcon="x" /></button>
    } @else { <span class="pp-tag__text"><ng-container [ngTemplateOutlet]="words" /></span> }
  `,
  // A list item only inside a named tag group (which is the list).
  host: { '[class]': '"pp-tag" + (colour() ? " pp-tag--" + colour() : "")', '[attr.role]': '!isLink && group?.isList() ? "listitem" : null' },
})
export class PpTag {
  protected readonly isLink = inject(ElementRef).nativeElement.tagName === 'A';
  protected readonly group = inject(PpTagGroup, { optional: true });
  readonly colour = input<TagColour>();
  readonly removable = input(false);
  /** The tag's words, for the remove button's name. */
  readonly text = input('');
  readonly remove = output<void>();
}

@Component({
  selector: 'pp-tag-group', template: '<ng-content />', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pp-tag-group', '[attr.role]': 'label() || labelledBy ? "list" : null', '[attr.aria-label]': 'labelledBy ? null : label()', '[attr.aria-labelledby]': 'labelledBy' },
})
export class PpTagGroup {
  /**
   * Its name for screen readers; a named group is a list. Inside a `<pp-field group="list">` the field's label names it.
   * Tags that are links (`<a ppTag>`) need no name.
   */
  readonly label = input<string>();
  private readonly field = inject(PpField, { optional: true });
  protected readonly labelledBy = this.field?.group() === 'list' ? this.field.controlId + '-label' : null;
  readonly isList = computed(() => !!this.label() || !!this.labelledBy);
}

/** Loading. Prefer a skeleton for content that has a shape. Spec: status/spinner.md */
@Component({
  selector: 'pp-spinner', template: '', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"pp-spinner" + (size() !== "medium" ? " pp-spinner--" + size() : "") + (inverse() ? " pp-spinner--inverse" : "")', 'aria-hidden': 'true' },
})
export class PpSpinner {
  readonly size = input<'small' | 'medium' | 'large'>('medium');
  readonly inverse = input(false);
}

/**
 * Progress towards a known end, with the value in words.
 * `<pp-progress-bar label="Lerato's documents" [value]="3" [max]="5" valueText="3 of 5 received" />`
 * Spec: status/progress-bar.md
 */
@Component({
  selector: 'pp-progress-bar',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (small()) {
      <progress class="pp-progress-bar__track pp-progress-bar__track--small" [value]="value()" [max]="max()" [attr.aria-label]="label() + ', ' + valueText()">{{ value() }} of {{ max() }}</progress>
    } @else {
    <div class="pp-progress-bar__header">
      <span class="pp-progress-bar__label" [id]="id + '-l'">{{ label() }}</span>
      <span class="pp-progress-bar__value" [id]="id + '-v'">{{ valueText() }}</span>
    </div>
    <progress class="pp-progress-bar__track" [class.pp-progress-bar__track--small]="trackSize() === 'small'" [value]="value()" [max]="max()" [attr.aria-labelledby]="id + '-l'" [attr.aria-describedby]="id + '-v'">{{ value() }} of {{ max() }}</progress>
    }
    @if (help()) { <div class="pp-progress-bar__help">@if (helpIcon()) {<svg [ppIcon]="helpIcon()!" />}<span>{{ help() }}</span></div> }
  `,
  host: { '[class]': '"pp-progress-bar" + (tone() !== "neutral" ? " pp-progress-bar--" + tone() : "")' },
})
export class PpProgressBar {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly max = input(100);
  readonly valueText = input.required<string>();
  readonly tone = input<'neutral' | 'success' | 'warning' | 'danger' | 'agent'>('neutral');
  readonly help = input<string>();
  readonly helpIcon = input<IconName>();
  /** A thin bar inside a row, with no header: the label and value are read out, and the row shows the value. */
  readonly small = input(false);
  /** The header, over a thin track (a person's progress in a list). */
  readonly trackSize = input<'medium' | 'small'>('medium');
  protected readonly id = uid('pp-progress');
}

/**
 * A placeholder in the shape of content that is loading.
 * `<pp-skeleton-group label="Loading people"><pp-skeleton shape="text" />…</pp-skeleton-group>`
 * Spec: status/skeleton.md
 */
@Component({
  selector: 'pp-skeleton-group', changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pp-skeleton-group__label">{{ label() }}</span><ng-content />`,
  host: { class: 'pp-skeleton-group', role: 'status', 'aria-busy': 'true', '[style.--_gap]': 'gap() ? "var(--space-" + gap() + ")" : null' },
})
export class PpSkeletonGroup {
  readonly label = input.required<string>();
  /** Space between the rows, from the spacing scale: "200". */
  readonly gap = input<'100' | '150' | '200' | '300'>();
}

@Component({
  selector: 'pp-skeleton', template: '', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'classes()', '[style.--_width]': 'width() ?? null' },
})
export class PpSkeleton {
  readonly shape = input<'text' | 'text-short' | 'heading' | 'avatar' | 'avatar-small' | 'lozenge' | 'field' | 'button' | 'card'>('text');
  /** A width from the layout scale, as a percentage: "40%". */
  readonly width = input<`${number}%`>();
  protected readonly classes = computed(() => this.shape() === 'text-short' ? 'pp-skeleton pp-skeleton--text pp-skeleton--text-short' : `pp-skeleton pp-skeleton--${this.shape()}`);
}

/** A skeleton row (avatar, lines, lozenge) and the lines stacked inside it. */
@Component({ selector: 'pp-skeleton-row', template: '<ng-content />', host: { class: 'pp-skeleton-row' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpSkeletonRow {}
@Component({ selector: 'pp-skeleton-stack', template: '<ng-content />', host: { class: 'pp-skeleton-stack' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpSkeletonStack {}

export type StepState = 'done' | 'agent' | 'current' | 'blocked' | 'upcoming';
export interface Step { label: string; state: StepState; meta?: string; }
const STEP_WORDS: Record<StepState, string> = { done: 'Done: ', agent: 'Done by Batsi: ', current: 'Current step: ', blocked: 'Blocked: ', upcoming: 'Not started: ' };
const STEP_ICON: Partial<Record<StepState, IconName>> = { done: 'check', agent: 'sparkles', blocked: 'octagon-alert' };

/** Where something is in a fixed set of steps. One per screen (Calm rule 4). Spec: status/progress-tracker.md */
@Component({
  selector: 'pp-progress-tracker',
  // A component host is inline by default; this one wraps blocks, and screens may give it Layout classes.
  styles: ':host { display: block; }',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="pp-progress-tracker" [class.pp-progress-tracker--vertical]="vertical()" [attr.aria-label]="label()">
      @for (s of steps(); track s.label) {
        <li class="pp-progress-tracker__step" [class]="s.state !== 'upcoming' ? 'pp-progress-tracker__step--' + s.state : ''" [attr.aria-current]="s.state === 'current' || s.state === 'blocked' ? 'step' : null">
          <span class="pp-progress-tracker__marker" aria-hidden="true">@if (icon(s.state); as i) {<svg [ppIcon]="i" />}</span>
          <span class="pp-progress-tracker__body">
            <span class="pp-progress-tracker__label"><span class="pp-progress-tracker__state">{{ words(s.state) }}</span>{{ s.label }}</span>
            @if (s.meta) { <span class="pp-progress-tracker__meta">{{ s.meta }}</span> }
          </span>
        </li>
      }
    </ol>
  `,
})
export class PpProgressTracker {
  readonly label = input.required<string>();
  readonly steps = input.required<Step[]>();
  readonly vertical = input(false);
  protected icon = (s: StepState) => STEP_ICON[s];
  protected words = (s: StepState) => STEP_WORDS[s];
}
