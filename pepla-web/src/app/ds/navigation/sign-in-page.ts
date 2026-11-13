import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import { PpLogo } from '../core/logo';

/**
 * The layout for every screen before sign-in: the logo, one narrow card with the form, and a footer line.
 * ```html
 * <pp-sign-in-page heading="Sign in" footer="Forgot your password? Your Admin can send you a new link.">
 *   <form ppForm aria-label="Sign in"> … <pp-sign-in-actions><button ppButton appearance="primary" type="submit">Sign in</button></pp-sign-in-actions></form>
 * </pp-sign-in-page>
 * ```
 * One h1 per page: the card title. Under 768px the phone spacing applies on its own; `phone` forces it (previews).
 * Spec: project/components/navigation/sign-in-page.md
 */
@Component({
  selector: 'pp-sign-in-page',
  imports: [PpLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The design system's base styles have no box-sizing reset or body margin reset yet, and the card is
  // sized for border-box. Until the design system adds them, the page fills the window itself and
  // sizes its own parts. Remove this block when the synced base.css carries the reset.
  encapsulation: ViewEncapsulation.None,
  styles: `
    pp-sign-in-page { position: fixed; inset: 0; overflow-y: auto; }
    pp-sign-in-page, pp-sign-in-page *, pp-sign-in-page *::before, pp-sign-in-page *::after { box-sizing: border-box; }
  `,
  template: `
    <div class="pp-sign-in__panel">
      <pp-logo />
      <div class="pp-sign-in__card">
        <div class="pp-sign-in__heading">
          <h1 class="pp-sign-in__title">{{ heading() }}</h1>
          @if (company()) { <span class="pp-sign-in__company">{{ company() }}</span> }
          @if (lead()) { <p class="pp-sign-in__lead">{{ lead() }}</p> }
        </div>
        <ng-content />
      </div>
      @if (footer()) { <p class="pp-sign-in__footer">{{ footer() }}</p> }
    </div>
  `,
  host: { class: 'pp-sign-in', '[class.pp-sign-in--phone]': 'phone()' },
})
export class PpSignInPage {
  readonly heading = input.required<string>();
  /** The company's name, when the person knows it better than the product. */
  readonly company = input<string>();
  readonly lead = input<string>();
  /** Outside the card: who sent the link, when it expires, or how to get help. */
  readonly footer = input<string>();
  readonly phone = input(false);
}

/** The card's actions: one primary button at full width, and at most one link or default button under it. */
@Component({ selector: 'pp-sign-in-actions', template: '<ng-content />', host: { class: 'pp-sign-in__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpSignInActions {}
