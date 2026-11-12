import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, viewChild } from '@angular/core';
import { PpIcon } from '../core/icon';
import { PpButton, PpButtonGroup } from '../actions/button';
import { uid } from '../util';
import { contrast, hueName, isHex, looksLike, nearestPassing, ratioWords } from './colour';

// Naleko People's own colours the check compares against. Kept in step with the design system tokens.
const WHITE = 'FFFFFF', DARK_SURFACE = '1B1640', INK = '1B1640', MINT = '2BB3A3', DANGER = 'AD093E';

/**
 * An admin's brand colour, checked and previewed in light and dark. Every colour is accepted: one that fails
 * contrast, or looks like Naleko People's mint or the error red, stays on the header, logo area and sign-in page.
 * `<pp-brand-preview company="Mokoena Accounting" [(value)]="accent" (save)="store($event)" (reset)="usePepla()" />`
 * Spec: records/tenant-branding-preview.md
 */
@Component({
  selector: 'pp-brand-preview',
  imports: [PpIcon, PpButton, PpButtonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-brand-preview__picker pp-field">
      <label class="pp-field__label" [for]="id">{{ label() }}</label>
      <div class="pp-brand-preview__input-row">
        <span class="pp-brand-preview__swatch" data-theme="light" aria-hidden="true" [style.--_accent]="hex() ? '#' + hex() : null"></span>
        <div class="pp-text-field">
          <span class="pp-text-field__prefix" aria-hidden="true">#</span>
          <input #field class="pp-text-field__input" [id]="id" type="text" [value]="value()" maxlength="6" spellcheck="false" autocomplete="off" [attr.aria-describedby]="id + '-r'" (input)="typed($any($event.target).value)">
        </div>
      </div>
      @if (!value()) {
        <span class="pp-field__help" [id]="id + '-r'">Naleko People's violet</span>
      } @else if (!hex()) {
        <span class="pp-brand-preview__result pp-brand-preview__result--brand-only" [id]="id + '-r'" role="status"><svg ppIcon="info" /><span>Enter 6 characters, like 00668D</span></span>
      } @else if (everywhere()) {
        <span class="pp-brand-preview__result" [id]="id + '-r'" role="status"><svg ppIcon="circle-check" /><span>Passes. {{ ratio() }} to 1 on white; buttons and links need 4.5 to 1.</span></span>
      } @else {
        <span class="pp-brand-preview__result pp-brand-preview__result--brand-only" [id]="id + '-r'" role="status"><svg ppIcon="info" /><span>Saved for your logo area, header and sign-in page. Buttons and links stay Naleko People violet, because {{ reason() }}</span></span>
        @if (suggestion(); as s) {
          <div class="pp-brand-preview__suggestion">
            <span class="pp-brand-preview__swatch pp-brand-preview__swatch--small" data-theme="light" aria-hidden="true" [style.--_accent]="'#' + s.hex"></span>
            <span class="pp-brand-preview__suggestion-text">
              <span>For buttons too, try {{ s.hex }}, a darker {{ s.name }}</span>
              <span class="pp-brand-preview__suggestion-meta">{{ s.ratio }} to 1 on white. Passes.</span>
            </span>
            <button ppButton size="small" type="button" (click)="use(s.hex)">Use {{ s.hex }}</button>
          </div>
        }
      }
    </div>
    <div class="pp-brand-preview__panes">
      @for (p of panes(); track p.theme) {
        <div class="pp-brand-preview__pane" [class.pp-brand-preview__pane--brand-only]="hex() && !everywhere()" [attr.data-theme]="p.theme" role="group"
             [attr.aria-label]="'Preview in ' + p.theme + ' theme'" [style.--_accent]="p.accent" [style.--_on-accent]="p.onAccent">
          <span class="pp-brand-preview__pane-label">{{ p.theme === 'light' ? 'Light' : 'Dark' }}</span>
          <span class="pp-brand-preview__header"><svg ppIcon="users" />{{ company() }}</span>
          <div class="pp-brand-preview__body">
            @if (welcome()) { <span>{{ welcome() }}</span> }
            <span class="pp-brand-preview__link">{{ linkText() }}</span>
            <span class="pp-brand-preview__button">{{ buttonText() }}</span>
          </div>
        </div>
      }
    </div>
    @if (hex()) {
      <span class="pp-brand-preview__note">@if (everywhere()) {In dark theme Naleko People uses {{ dark() === hex() ? 'your colour as it is' : 'a lighter partner of your colour, ' + dark() + ',' }} which has {{ darkRatio() }} to 1 on the dark background. Naleko People's mint and the status colours do not change.} @else {Your colour is on the header strip. Buttons and links stay violet so everyone can read them.}</span>
    }
    <pp-button-group>
      <button ppButton appearance="primary" type="button" [busy]="busy()" (click)="save.emit(hex() ?? '')">Save accent colour</button>
      <button ppButton appearance="subtle" type="button" (click)="value.set(''); reset.emit()">{{ resetText() }}</button>
    </pp-button-group>
  `,
  host: { class: 'pp-brand-preview' },
})
export class PpBrandPreview {
  /** The hex as typed, without `#`. */
  readonly value = model('');
  readonly company = input.required<string>();
  readonly label = input('Accent colour');
  readonly welcome = input<string>();
  readonly linkText = input('Read the welcome pack');
  readonly buttonText = input('Get started');
  /** "Skip for now" when a new company is setting up. */
  readonly resetText = input("Use Naleko People's violet");
  readonly busy = input(false);
  readonly save = output<string>();
  readonly reset = output<void>();
  protected readonly id = uid('pp-brand');
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly hex = computed(() => (isHex(this.value()) ? this.value().toUpperCase() : null));
  private readonly onWhite = computed(() => (this.hex() ? contrast(this.hex()!, WHITE) : 0));
  protected readonly ratio = computed(() => ratioWords(this.onWhite()));
  private readonly like = computed(() => (!this.hex() ? null : looksLike(this.hex()!, MINT) ? 'mint' : looksLike(this.hex()!, DANGER) ? 'red' : null));
  protected readonly everywhere = computed(() => !!this.hex() && this.onWhite() >= 4.5 && !this.like());
  protected readonly reason = computed(() =>
    this.onWhite() < 4.5 ? `this colour has ${this.ratio()} to 1 on white and they need 4.5 to 1.`
      : this.like() === 'mint' ? "this colour is close to the mint that marks Batsi's own work."
        : 'this colour is close to the red Naleko People uses for errors.');
  protected readonly suggestion = computed(() => {
    const h = this.hex();
    if (!h || this.onWhite() >= 4.5) return null;
    const s = nearestPassing(h, WHITE);
    return looksLike(s, MINT) || looksLike(s, DANGER) ? null : { hex: s, name: hueName(h), ratio: ratioWords(contrast(s, WHITE)) };
  });
  protected readonly dark = computed(() => (this.hex() ? nearestPassing(this.hex()!, DARK_SURFACE) : null));
  protected readonly darkRatio = computed(() => (this.dark() ? ratioWords(contrast(this.dark()!, DARK_SURFACE)) : ''));
  /** Each pane's accent and the text on the header: ink or white, whichever has more contrast. */
  protected readonly panes = computed(() => {
    const h = this.hex();
    const on = (c: string) => (contrast(c, WHITE) >= contrast(c, INK) ? '#' + WHITE : '#' + INK);
    return (['light', 'dark'] as const).map((theme) => {
      if (!h) return { theme, accent: null, onAccent: null };
      const c = this.everywhere() && theme === 'dark' ? this.dark()! : h;
      return { theme, accent: '#' + c, onAccent: on(c) };
    });
  });
  protected typed(v: string) { this.value.set(v.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase()); }
  protected use(hex: string) { this.value.set(hex); this.field().nativeElement.focus(); }
}
