import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpButton } from '../actions/button';
import { PpLink } from '../actions/link';
import { uid } from '../util';

export interface ConsentTerm { icon: IconName; term: string; text: string; }

/**
 * Asking for consent before personal data is collected (POPIA): what, why, who receives it, how long,
 * then the choices (`<pp-checkbox>`, nothing ticked) and "Agree and continue".
 * `<form ppConsent heading="How Mokoena Accounting uses your information" intro="…" [terms]="terms" noticeLink="/privacy" (agree)="save()">
 *    <pp-checkbox label="I agree …" [mustTick]="true" …/></form>`
 * Spec: records/consent-capture.md
 */
@Component({
  selector: 'form[ppConsent]',
  imports: [PpIcon, PpButton, PpLink, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-consent__header">
      <span class="pp-consent__title" role="heading" aria-level="2" [id]="id">{{ heading() }}</span>
      <span class="pp-consent__intro">{{ intro() }}</span>
    </div>
    <dl class="pp-consent__terms">
      @for (t of terms(); track t.term) { <dt><svg [ppIcon]="t.icon" />{{ t.term }}</dt><dd>{{ t.text }}</dd> }
    </dl>
    <fieldset class="pp-field">
      <legend class="pp-field__label">{{ choicesLabel() }}</legend>
      <div class="pp-consent__choices"><ng-content /></div>
    </fieldset>
    <div class="pp-consent__footer">
      <a ppLink [routerLink]="noticeLink()">Read the full privacy notice</a>
      <button ppButton appearance="primary" size="large" type="submit">{{ submitText() }}</button>
    </div>
  `,
  host: { class: 'pp-consent', '[attr.aria-labelledby]': 'id', novalidate: '', '(submit)': '$event.preventDefault(); agree.emit()' },
})
export class PpConsent {
  readonly heading = input.required<string>();
  readonly intro = input.required<string>();
  readonly terms = input.required<ConsentTerm[]>();
  readonly choicesLabel = input('Your choices');
  readonly noticeLink = input.required<string>();
  readonly submitText = input('Agree and continue');
  readonly agree = output<void>();
  protected readonly id = uid('pp-consent');
}

/**
 * What someone agreed to and when, with a way to change it. `live` when it has just been saved.
 * `<pp-consent-record text="You agreed to …" meta="11 Nov 2026, 08:42" [action]="{ text: 'Change or withdraw', link: '/…' }" [live]="true" />`
 */
@Component({
  selector: 'pp-consent-record',
  imports: [PpIcon, PpLink, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-consent__record" [attr.role]="live() ? 'status' : null">
      <svg ppIcon="circle-check" />
      <span class="pp-consent__record-text">
        <span>{{ text() }}</span>
        <span class="pp-consent__record-meta">{{ meta() + (action() ? ' · ' : '') }}@if (action(); as a) {<a ppLink [routerLink]="a.link">{{ a.text }}</a>}</span>
      </span>
    </div>
  `,
  host: { class: 'pp-consent' },
})
export class PpConsentRecord {
  readonly text = input.required<string>();
  readonly meta = input.required<string>();
  readonly action = input<{ text: string; link: string }>();
  readonly live = input(false);
}
