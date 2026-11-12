// Built on Angular Aria (combobox + multi listbox) and the CDK overlay. Spec: forms/select.md
import { ChangeDetectionStrategy, Component, afterRenderEffect, computed, inject, input, signal, viewChild } from '@angular/core';
import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option as AriaOption } from '@angular/aria/listbox';
import { OverlayModule } from '@angular/cdk/overlay';
import { PpField } from '../field';
import { PpIcon } from '../../core/icon';
import { PpValueControl, valueAccessor } from '../../util';
import { Option } from '../controls';

/**
 * Choose several from a longer list. Typing a letter jumps to the matching option.
 * For a few options, use checkboxes.
 * `<pp-field label="Departments"><pp-multi-select [options]="departments" [(value)]="chosen" noun="departments" /></pp-field>`
 */
@Component({
  selector: 'pp-multi-select',
  imports: [Combobox, ComboboxPopup, ComboboxWidget, Listbox, AriaOption, OverlayModule, PpIcon],
  providers: [valueAccessor(() => PpMultiSelect)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-select" [class.pp-select--open]="open()">
      <div class="pp-select__value" [class.pp-select__value--placeholder]="!count()"
           ngCombobox #combobox="ngCombobox" [(expanded)]="open" [disabled]="disabled()"
           [id]="field?.controlId" [attr.aria-labelledby]="field ? field.controlId + '-label' : null"
           [attr.aria-describedby]="field?.describedBy()" [attr.aria-invalid]="field?.invalid() || invalid() ? 'true' : null"
           (blur)="onTouched()">{{ summary() }}</div>
      <svg ppIcon="chevron-down" />
    </div>

    <ng-template [cdkConnectedOverlay]="{ origin: combobox.element, usePopover: 'inline', matchWidth: true }" [cdkConnectedOverlayOpen]="open()">
      <ng-template ngComboboxPopup [combobox]="combobox">
        <div class="pp-select-panel">
          <div class="pp-select-panel__list" ngListbox ngComboboxWidget #list="ngListbox" [multi]="true" selectionMode="explicit"
               focusMode="activedescendant" [tabIndex]="-1" [activeDescendant]="list.activeDescendant()"
               [value]="value() ?? []" (valueChange)="set($event)">
            @for (o of options(); track o.value) {
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
})
export class PpMultiSelect extends PpValueControl<string[]> {
  readonly options = input.required<Option[]>();
  /** Plural, for the summary: "3 departments". */
  readonly noun = input('selected');
  readonly placeholder = input('Choose');
  protected readonly field = inject(PpField, { optional: true });
  protected readonly open = signal(false);
  protected readonly count = computed(() => this.value()?.length ?? 0);
  /** "Finance", "Finance, Sales", then "3 departments". */
  protected readonly summary = computed(() => {
    const chosen = this.options().filter((o) => this.value()?.includes(o.value));
    if (!chosen.length) return this.placeholder();
    return chosen.length <= 2 ? chosen.map((o) => o.label).join(', ') : `${chosen.length} ${this.noun()}`;
  });
  private readonly list = viewChild(Listbox);

  constructor() {
    super();
    this.field?.labelable.set(false);
    afterRenderEffect(() => { if (this.open()) this.list()?.scrollActiveItemIntoView(); });
  }
}
