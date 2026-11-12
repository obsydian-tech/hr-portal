// Built on Angular Aria (combobox + listbox) and the CDK overlay. Aria does the keyboard, focus and
// screen reader work; components.css does the look. Spec: forms/search.md and forms/select.md
import { ChangeDetectionStrategy, Component, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option as AriaOption } from '@angular/aria/listbox';
import { OverlayModule } from '@angular/cdk/overlay';
import { PpField } from '../field';
import { PpIcon } from '../../core/icon';
import { PpValueControl, valueAccessor } from '../../util';
import { Option } from '../controls';

/**
 * Type to find one item in a long list (a person, a job title, a bank).
 * The page answers `(query)` by setting `[suggestions]`.
 * `<pp-field label="Manager"><pp-autocomplete [suggestions]="people()" (query)="find($event)" [(value)]="manager" /></pp-field>`
 */
@Component({
  selector: 'pp-autocomplete',
  imports: [Combobox, ComboboxPopup, ComboboxWidget, Listbox, AriaOption, OverlayModule, PpIcon],
  providers: [valueAccessor(() => PpAutocomplete)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-text-field pp-search" #origin [attr.aria-busy]="busy() ? 'true' : null">
      <span class="pp-text-field__prefix"><svg ppIcon="search" /></span>
      <input
        class="pp-text-field__input" type="text" autocomplete="off"
        ngCombobox #combobox="ngCombobox"
        [id]="field?.controlId" [attr.aria-describedby]="field?.describedBy()" [attr.aria-invalid]="field?.invalid() || invalid() ? 'true' : null"
        [attr.required]="field?.required() ? '' : null" [disabled]="disabled()" [placeholder]="placeholder()"
        [value]="text()" (valueChange)="type($event)" [(expanded)]="open" (click)="open.set(true)" (blur)="onTouched()" />
      <span class="pp-spinner" aria-hidden="true"></span>
      @if (text()) {
        <button class="pp-text-field__action pp-search__clear" type="button" aria-label="Clear" (mousedown)="$event.preventDefault()" (click)="clear()"><svg ppIcon="x" /></button>
      }
    </div>
    <div class="pp-visually-hidden" aria-live="polite">{{ open() && text() && !suggestions().length ? empty() : '' }}</div>

    <ng-template [cdkConnectedOverlay]="{ origin, usePopover: 'inline', matchWidth: true }" [cdkConnectedOverlayOpen]="open() && !!text()">
      <ng-template ngComboboxPopup [combobox]="combobox">
        <div class="pp-select-panel">
          @if (!suggestions().length) { <div class="pp-select-panel__empty">{{ busy() ? 'Looking…' : empty() }}</div> }
          <div class="pp-select-panel__list" ngListbox ngComboboxWidget #list="ngListbox" focusMode="activedescendant" [tabIndex]="-1"
               [activeDescendant]="list.activeDescendant()" [(value)]="highlighted" (click)="commit()" (keydown.enter)="commit()">
            @for (o of suggestions(); track o.value) {
              <div class="pp-select-option" ngOption #opt="ngOption" [value]="o.value" [label]="o.label" [disabled]="!!o.disabled"
                   [class.pp-select-option--focused]="opt.active()">
                <span class="pp-select-option__text">{{ o.label }}@if (o.description) {<span class="pp-select-option__meta">{{ o.description }}</span>}</span>
                <span class="pp-select-option__check"><svg ppIcon="check" /></span>
              </div>
            }
          </div>
        </div>
      </ng-template>
    </ng-template>
  `,
  host: { class: 'pp-popup-anchor pp-autocomplete' },
})
export class PpAutocomplete extends PpValueControl<Option | null> {
  readonly suggestions = input<Option[]>([]);
  readonly placeholder = input('');
  readonly busy = input(false);
  readonly empty = input('Nothing matches. Check the spelling, or try fewer letters.');
  readonly query = output<string>();
  protected readonly field = inject(PpField, { optional: true });
  protected readonly open = signal(false);
  protected readonly typed = signal<string | null>(null);
  protected readonly text = computed(() => this.typed() ?? this.value()?.label ?? '');
  /** Aria moves this as you arrow through; nothing is chosen until Enter or a click. */
  protected readonly highlighted = signal<string[]>([]);
  private readonly list = viewChild(Listbox);
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    afterRenderEffect(() => { if (this.open()) this.list()?.scrollActiveItemIntoView(); });
  }

  protected type(q: string) {
    this.typed.set(q);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.query.emit(q.trim()), 200);
  }

  protected commit() {
    const o = this.suggestions().find((s) => s.value === this.highlighted()[0]) ?? null;
    if (!o) return;
    this.set(o);
    this.typed.set(null);
    this.open.set(false);
  }

  protected clear() {
    this.typed.set(null);
    this.set(null);
    this.open.set(false);
  }
}
