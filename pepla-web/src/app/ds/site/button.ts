import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';

/**
 * The button on the public site: dark with a mint dot that grows into an arrow on hover, or a white line button.
 * `<a ppSiteButton href="#demo">Book a demo</a>`, `<button ppSiteButton variant="line" icon="sparkles">Ask Batsi</button>`.
 * Spec: project/components/site/site-button.md
 */
@Component({
  selector: 'a[ppSiteButton], button[ppSiteButton]',
  imports: [PpIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #label><ng-content /></ng-template>
    @if (variant() === 'dark') {
      <span><ng-container [ngTemplateOutlet]="label" /></span><svg ppIcon="arrow-right" />
    } @else {
      @if (icon()) { <svg [ppIcon]="icon()!" /> }<ng-container [ngTemplateOutlet]="label" />
    }
  `,
  host: {
    class: 'pp-site-button',
    '[class.pp-site-button--dark]': 'variant() === "dark"',
    '[class.pp-site-button--line]': 'variant() === "line"',
    '[class.pp-site-button--large]': 'large()',
  },
})
export class PpSiteButton {
  readonly variant = input<'dark' | 'line'>('dark');
  readonly large = input(false, { transform: booleanAttribute });
  /** An icon before the label on a line button, such as sparkles on "Ask Batsi". A dark button always ends in arrow-right. */
  readonly icon = input<IconName>();
}
