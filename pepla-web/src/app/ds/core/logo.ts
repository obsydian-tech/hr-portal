import { ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';
import { PpMark } from './mark';
import { PpIcon, IconTone } from './icon';
import { IconName } from './icon.registry';

/** The Pepla lockup: mark and lowercase wordmark. Spec: project/components/core/logo.md */
@Component({
  selector: 'pp-logo, a[ppLogo]',
  imports: [PpMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg ppMark /><span class="pp-logo__word">pepla</span>`,
  host: {
    class: 'pp-logo',
    '[class.pp-logo--small]': 'size() === "small"',
    '[class.pp-logo--large]': 'size() === "large"',
    '[class.pp-logo--mark-only]': 'markOnly()',
    '[attr.aria-label]': 'isLink ? "Pepla home" : null',
  },
})
export class PpLogo {
  /** `<a ppLogo routerLink="/">` is the way home, named "Pepla home". Otherwise the word "pepla" names it, even with the mark only. */
  protected readonly isLink = inject(ElementRef).nativeElement.tagName === 'A';
  readonly size = input<'small' | 'medium' | 'large'>('medium');
  readonly markOnly = input(false);
}

/** The app icon: the mark on its tile. */
@Component({
  selector: 'pp-app-icon',
  imports: [PpMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg ppMark />`,
  host: { class: 'pp-app-icon', '[class.pp-app-icon--large]': 'large()' },
})
export class PpAppIcon {
  readonly large = input(false);
}

/** An icon on a rounded tile, for modules and record types. Spec: project/components/core/icon.md */
@Component({
  selector: 'pp-icon-tile',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg [ppIcon]="icon()" size="medium" />`,
  host: {
    class: 'pp-icon-tile',
    '[class.pp-icon-tile--brand]': 'tone() === "brand"',
    '[class.pp-icon-tile--agent]': 'tone() === "agent"',
  },
})
export class PpIconTile {
  readonly icon = input.required<IconName>();
  readonly tone = input<'neutral' | 'brand' | 'agent'>('neutral');
}

export type { IconTone };
