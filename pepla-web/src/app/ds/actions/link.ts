import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';

/**
 * A link that goes somewhere: `<a ppLink routerLink="/people/42">Thandeka Dlamini</a>`.
 * `standalone` for links outside a sentence (with an optional icon); `external` opens elsewhere
 * and says so. Spec: project/components/actions/link.md
 */
@Component({
  selector: 'a[ppLink]',
  imports: [PpIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #words><ng-content /></ng-template>
    @if (isStandalone()) {
      @if (icon()) { <svg [ppIcon]="icon()!" /> }
      <span><ng-container [ngTemplateOutlet]="words" /></span>
      @if (iconAfter()) { <svg [ppIcon]="iconAfter()!" /> }
      @if (external()) { <svg ppIcon="external-link" /><span class="pp-visually-hidden"> (opens in a new tab)</span> }
    } @else {
      <ng-container [ngTemplateOutlet]="words" />
      @if (external()) { <span class="pp-link__icon"><svg ppIcon="external-link" /></span><span class="pp-visually-hidden"> (opens in a new tab)</span> }
    }
  `,
  host: {
    '[class]': 'classes()',
    '[attr.target]': 'external() ? "_blank" : null',
    '[attr.rel]': 'external() ? "noopener noreferrer" : null',
  },
})
export class PpLink {
  readonly standalone = input(false);
  readonly subtle = input(false);
  /** Shows the link as read, in a list of things to read. Browsers don't expose :visited to scripts, so the screen says it. */
  readonly visited = input(false);
  readonly external = input(false);
  readonly icon = input<IconName>();
  /** An icon after the words, such as arrow-right on "View all new employees". */
  readonly iconAfter = input<IconName>();
  protected readonly isStandalone = computed(() => this.standalone() || !!this.icon() || !!this.iconAfter());
  protected readonly classes = computed(() => ['pp-link',
    this.isStandalone() && 'pp-link--standalone',
    this.subtle() && 'pp-link--subtle',
    this.visited() && 'pp-link--visited',
    this.external() && 'pp-link--external'].filter(Boolean).join(' '));
}
