import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { AvatarColour, PpPerson } from '../core/avatar';
import { PpLozenge, Status } from '../status/lozenge';
import { PpProgressBar } from '../status/status';
import { PpDeadline } from './records';
import { daysBetween, toDate } from '../format';

export type BundleItemState = 'done' | 'agent' | 'progress' | 'waiting' | 'todo';

export interface BundleItem {
  icon: IconName;
  name: string;
  detail: string;
  /** Who does it: a person, or "Batsi". Left out: "No owner yet". */
  owner?: { name: string; colour?: AvatarColour };
  state: BundleItemState;
  /** "Ready 10 Nov", "Created by Batsi 9 Nov", "In progress". */
  status: string;
  due?: Date | string;
}

const LOOK: Record<BundleItemState, { status: Status; icon: IconName }> = {
  done: { status: 'success', icon: 'circle-check' },
  agent: { status: 'agent', icon: 'sparkles' },
  progress: { status: 'information', icon: 'circle-dot-dashed' },
  waiting: { status: 'neutral', icon: 'circle-dashed' },
  todo: { status: 'neutral', icon: 'circle-dashed' },
};

/**
 * Everything a new starter needs from IT: each item, who owns it, its state and deadline.
 * `<pp-bundle heading="IT setup for Kagiso Molefe" subheading="Office starter bundle · Starts Mon 16 Nov" icon="laptop" [items]="items">
 *    <time ppDeadline …></time> <pp-card-footer>…</pp-card-footer></pp-bundle>`. Spec: records/provisioning-bundle.md
 */
@Component({
  selector: 'pp-bundle',
  imports: [PpIcon, PpPerson, PpLozenge, PpProgressBar, PpDeadline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-card__header">
      @if (icon()) { <span class="pp-icon-tile pp-icon-tile--brand" aria-hidden="true"><svg [ppIcon]="icon()!" /></span> }
      <div class="pp-card__titles"><span class="pp-card__title" role="heading" aria-level="3">{{ heading() }}</span><span class="pp-card__subtitle">{{ subheading() }}</span></div>
      <ng-content select="pp-card-aside" />
    </div>
    @if (progress()) { <pp-progress-bar label="Ready" [value]="ready()" [max]="items().length" [valueText]="ready() + ' of ' + items().length + ' items'" [tone]="tone()" /> }
    <ul class="pp-bundle__items" aria-label="Items in this bundle">
      @for (i of items(); track i.name) {
        <li class="pp-bundle__item">
          <span class="pp-icon-tile" aria-hidden="true"><svg [ppIcon]="i.icon" /></span>
          <div class="pp-bundle__body"><span class="pp-bundle__name">{{ i.name }}</span><span class="pp-bundle__detail">{{ i.detail }}</span></div>
          <span class="pp-bundle__owner">
            @if (i.owner; as o) { <pp-person [name]="o.name" size="small" [kind]="o.name === 'Batsi' ? 'agent' : 'person'" [colour]="o.colour" /> }
            @else { <span class="pp-bundle__unowned"><svg ppIcon="user-x" />No owner yet</span> }
          </span>
          <div class="pp-bundle__status">
            <pp-lozenge [status]="look(i).status" [icon]="look(i).icon">{{ i.status }}</pp-lozenge>
            @if (i.due && i.state !== 'done' && i.state !== 'agent') { <time ppDeadline [due]="i.due" [now]="now()" [inline]="true"></time> }
          </div>
        </li>
      }
    </ul>
    <ng-content select="pp-card-footer" />
  `,
  host: { '[class]': '"pp-card pp-bundle" + (compact() ? " pp-card--compact" : "")', role: 'article' },
})
export class PpBundle {
  readonly heading = input.required<string>();
  readonly subheading = input.required<string>();
  readonly icon = input<IconName>();
  readonly items = input.required<BundleItem[]>();
  /** The "Ready, 3 of 5 items" bar. Off in a narrow panel. */
  readonly progress = input(true);
  readonly compact = input(false);
  readonly now = input<Date>();
  protected readonly ready = computed(() => this.items().filter((i) => i.state === 'done' || i.state === 'agent').length);
  protected readonly tone = computed(() => {
    const now = this.now() ?? new Date();
    if (this.ready() === this.items().length) return 'success' as const;
    return this.items().some((i) => i.due && i.state !== 'done' && i.state !== 'agent' && daysBetween(now, toDate(i.due)) < 0) ? 'danger' as const : 'neutral' as const;
  });
  protected look(i: BundleItem) { return LOOK[i.state]; }
}
