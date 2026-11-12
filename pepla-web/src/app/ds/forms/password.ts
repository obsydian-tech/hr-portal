import { ChangeDetectionStrategy, Component, booleanAttribute, TemplateRef, computed, effect, inject, input, model, signal, viewChild } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpField } from './field';
import { PpValueControl, uid, valueAccessor } from '../util';

export interface Strength { level: 1 | 2 | 3 | 4; word: string; detail?: string; }

const MIN = 12;
const COMMON = /^(password|passw0rd|welcome|qwerty|letmein|admin|iloveyou|monkey|dragon|sunshine|football|abc123|123456|111111)/i;
const STRENGTH_ICON: Record<Strength['level'], IconName> = { 1: 'octagon-alert', 2: 'triangle-alert', 3: 'check', 4: 'circle-check' };

/**
 * A first-pass score: length first, then common passwords. Replace it with a breached-password check
 * through `[score]` once the API has one (spec: score with a library, not rules about symbols).
 */
export function scorePassword(v: string): Strength {
  if (v.length < MIN) return { level: 1, word: 'Too short.', detail: `${v.length} of ${MIN} characters.` };
  if (COMMON.test(v) || /^(.)\1+$/.test(v) || /^\d+$/.test(v)) return { level: 2, word: 'Weak.', detail: 'It is a common password. Add a few words.' };
  if (v.length < 20) return { level: 3, word: 'Good.' };
  return { level: 4, word: 'Strong.', detail: `${v.length} characters.` };
}

/**
 * A password, hidden as it is typed, with an eye button to show it. Inside a field:
 * `<pp-field label="New password" help="At least 12 characters. A short sentence is easy to remember."><pp-password autocomplete="new-password" [strength]="true" [(value)]="pw" /></pp-field>`
 * Never blocks paste or autofill. Spec: forms/password.md
 */
@Component({
  selector: 'pp-password',
  imports: [PpIcon],
  providers: [valueAccessor(() => PpPassword)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-text-field pp-password">
      <input class="pp-text-field__input" [id]="inputId" [type]="shown() ? 'text' : 'password'" [attr.autocomplete]="autocomplete()"
             [required]="required() || (field?.required() ?? false)" [disabled]="disabled()" [attr.aria-invalid]="field?.invalid() || invalid() || null"
             [attr.aria-describedby]="describedBy()" [attr.spellcheck]="shown() ? 'false' : null" [attr.autocapitalize]="shown() ? 'off' : null"
             [value]="value() ?? ''" (input)="type($any($event.target).value)" (keydown)="caps($event)" (keyup)="caps($event)" (blur)="capsOn.set(false); onTouched()" />
      <button class="pp-text-field__action" type="button" [attr.aria-pressed]="shown() ? 'true' : 'false'" [attr.aria-controls]="inputId"
              [attr.aria-label]="(shown() ? 'Hide ' : 'Show ') + name()" (click)="shown.set(!shown())"><svg [ppIcon]="shown() ? 'eye-off' : 'eye'" /></button>
    </div>
    <ng-template #lines>
      @if (score(); as s) {
        <div class="pp-password-strength" [attr.data-strength]="s.level" [id]="id + '-strength'">
          <div class="pp-password-strength__bars" aria-hidden="true"><span class="pp-password-strength__bar"></span><span class="pp-password-strength__bar"></span><span class="pp-password-strength__bar"></span><span class="pp-password-strength__bar"></span></div>
          <div class="pp-password-strength__text" aria-live="polite"><svg [ppIcon]="icon(s)" /><span><strong>{{ s.word }}</strong>@if (s.detail) { {{ s.detail }}}</span></div>
        </div>
      }
      @if (capsOn()) { <div class="pp-password-caps" [id]="id + '-caps'"><svg ppIcon="triangle-alert" /><span>Caps Lock is on</span></div> }
    </ng-template>
  `,
})
export class PpPassword extends PpValueControl<string> {
  readonly autocomplete = input<'current-password' | 'new-password'>('current-password');
  /** Required, without a marker on the label (sign in). */
  readonly required = input(false, { transform: booleanAttribute });
  /** Show the strength hint: only when someone sets a new password, never on sign in. */
  readonly strength = input(false);
  /** How to score a new password. */
  readonly scorer = input<(v: string) => Strength>(scorePassword, { alias: 'score' });
  /** The button's name: "password", or "new password" when a form has two. */
  readonly name = input('password');
  protected readonly field = inject(PpField, { optional: true });
  protected readonly id = uid('pp-password');
  protected readonly inputId = this.field?.controlId ?? this.id;
  /** Shown as text. Starts hidden. */
  readonly shown = model(false);
  /** Caps Lock is on. Set by the component from the keyboard; the gallery sets it to show the state. */
  readonly capsOn = model(false);
  private readonly debounced = signal('');
  private timer?: ReturnType<typeof setTimeout>;
  protected readonly score = computed(() => (this.strength() && this.debounced() ? this.scorer()(this.debounced()) : null));
  protected readonly describedBy = computed(() => [this.field?.describedBy(), this.score() && this.id + '-strength', this.capsOn() && this.id + '-caps'].filter(Boolean).join(' ') || null);
  protected icon = (s: Strength) => STRENGTH_ICON[s.level];
  private readonly lines = viewChild.required<TemplateRef<unknown>>('lines');

  constructor() {
    super();
    effect(() => this.field?.extra.set(this.lines()));
    effect(() => { const v = this.value() ?? ''; if (!this.debounced() && v) this.debounced.set(v); });
  }
  protected type(v: string) {
    this.set(v);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.debounced.set(v), 300);
  }
  protected caps(e: KeyboardEvent) { if (typeof e.getModifierState === 'function') this.capsOn.set(e.getModifierState('CapsLock')); }
}
