import { ChangeDetectionStrategy, Component, computed, input, isDevMode } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';

export type Status = 'neutral' | 'information' | 'success' | 'warning' | 'danger' | 'agent';

/** The default icon per status, and the icons a status may use (readme, Iconography: Status). */
export const STATUS_ICON: Record<Status, IconName> = {
  neutral: 'circle-dashed', information: 'info', success: 'circle-check', warning: 'triangle-alert', danger: 'octagon-alert', agent: 'sparkles',
};
export const STATUS_ICONS: Partial<Record<Status, IconName[]>> = {
  success: ['check', 'circle-check', 'shield-check', 'user-check', 'thumbs-up'],
  danger: ['x', 'circle-x', 'octagon-alert', 'clock-alert', 'circle-slash', 'user-x', 'lock', 'thumbs-down'],
  warning: ['triangle-alert', 'clock', 'timer', 'hourglass', 'clock-alert'],
};

/**
 * A status: always an icon and a word (rule 4). Only on something that needs someone (Calm rule 2);
 * a row that is on track shows none. `<pp-lozenge status="success">Verified</pp-lozenge>`
 * Spec: project/components/status/lozenge.md
 */
@Component({
  selector: 'pp-lozenge',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg [ppIcon]="shownIcon()" /><ng-content />`,
  host: { '[class]': 'classes()' },
})
export class PpLozenge {
  readonly status = input<Status>('neutral');
  readonly icon = input<IconName>();
  /** Bold, for the one status that matters most on a screen. */
  readonly bold = input(false);
  readonly large = input(false);

  protected readonly shownIcon = computed(() => {
    const icon = this.icon() ?? STATUS_ICON[this.status()];
    const allowed = STATUS_ICONS[this.status()];
    if (isDevMode() && allowed && !allowed.includes(icon)) console.error(`pp-lozenge: a ${this.status()} lozenge uses "${icon}"; the vocabulary gives ${allowed.join(', ')}`);
    return icon;
  });
  protected readonly classes = computed(() => ['pp-lozenge',
    this.status() !== 'neutral' && `pp-lozenge--${this.status()}`,
    this.bold() && 'pp-lozenge--bold', this.large() && 'pp-lozenge--large'].filter(Boolean).join(' '));
}
