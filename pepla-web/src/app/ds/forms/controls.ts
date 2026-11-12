import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpField } from './field';
import { PpValueControl, uid, valueAccessor } from '../util';

export interface Option<T = string> {
  value: T; label: string; disabled?: boolean; description?: string;
  /** Rich select only: the heading of the group it sits under, and an icon before the words. */
  group?: string; icon?: IconName;
}

/**
 * Choose one from a short list (up to about 15). Longer lists use `<pp-autocomplete>`.
 * `<pp-field label="Department"><pp-select [options]="departments" [(value)]="dept" /></pp-field>`
 * Spec: forms/select.md
 */
@Component({
  selector: 'pp-select',
  imports: [PpIcon],
  providers: [valueAccessor(() => PpSelect)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select class="pp-select__input" [id]="field?.controlId" [attr.aria-describedby]="field?.describedBy()" [attr.aria-invalid]="field?.invalid() || invalid() || null"
            [required]="field?.required() ?? false" [disabled]="disabled()" (change)="pick($any($event.target).value)" (blur)="onTouched()">
      @if (placeholder()) { <option value="" disabled [selected]="value() == null">{{ placeholder() }}</option> }
      @for (o of options(); track o.value) { <option [value]="o.value" [disabled]="o.disabled" [selected]="o.value === value()">{{ o.label }}</option> }
    </select>
    <svg ppIcon="chevron-down" />
  `,
  host: { '[class]': '"pp-select" + (size() === "small" ? " pp-select--small" : "") + (fit() ? " pp-select--fit" : "")' },
})
export class PpSelect extends PpValueControl<string | null> {
  readonly options = input.required<Option[]>();
  readonly placeholder = input<string>();
  readonly size = input<'medium' | 'small'>('medium');
  readonly fit = input(false);
  protected readonly field = inject(PpField, { optional: true });
  protected pick(v: string) { this.set(v); }
}

/**
 * Yes or no for one thing: `<pp-checkbox label="Send it by email as well" [(value)]="email" />`.
 * Several go in `<pp-field group="checkbox">`. Spec: forms/checkbox.md
 */
@Component({
  selector: 'pp-checkbox',
  providers: [valueAccessor(() => PpCheckbox)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input class="pp-checkbox__input" [class.pp-checkbox__input--mixed]="indeterminate()" type="checkbox" [id]="id" [checked]="!!value()" [disabled]="disabled()" [indeterminate]="indeterminate()"
           [required]="mustTick() || (field?.required() ?? false)" [attr.aria-invalid]="field?.invalid() || invalid() || null"
           [attr.aria-describedby]="describe(description() ? id + '-d' : null)" (change)="set($any($event.target).checked)" (blur)="onTouched()">
    <label class="pp-checkbox__label" [attr.for]="id">{{ label() }}@if (description()) {<span class="pp-checkbox__description" [id]="id + '-d'">{{ description() }}</span>}</label>
  `,
  host: { class: 'pp-checkbox' },
})
export class PpCheckbox extends PpValueControl<boolean> {
  protected readonly field = inject(PpField, { optional: true });
  protected describe(own: string | null) { return [own, this.field?.describedBy()].filter(Boolean).join(' ') || null; }
  readonly label = input.required<string>();
  readonly description = input<string>();
  readonly indeterminate = input(false);
  /** This one box must be ticked (consent), when the others in its group are optional. */
  readonly mustTick = input(false);
  protected readonly id = uid('pp-checkbox');
}

/**
 * On or off, taking effect at once (settings): `<pp-toggle label="Remind new employees" [(value)]="remind" />`.
 * For a choice that is saved with a form, use a checkbox. Spec: forms/toggle.md
 */
@Component({
  selector: 'pp-toggle',
  providers: [valueAccessor(() => PpToggle)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input class="pp-toggle__input" type="checkbox" role="switch" [id]="id" [checked]="!!value()" [disabled]="disabled()" [attr.aria-busy]="saving() ? 'true' : null"
           [attr.aria-describedby]="description() || saving() ? id + '-d' : null" (change)="set($any($event.target).checked)" (blur)="onTouched()">
    <label class="pp-toggle__label" [attr.for]="id">{{ label() }}@if (saving()) {<span class="pp-toggle__description" [id]="id + '-d'" role="status">Saving</span>} @else if (description()) {<span class="pp-toggle__description" [id]="id + '-d'">{{ description() }}</span>}</label>
  `,
  host: { class: 'pp-toggle', '[class.pp-toggle--end]': 'end()' },
})
export class PpToggle extends PpValueControl<boolean> {
  readonly label = input.required<string>();
  readonly description = input<string>();
  /** Switch at the end of the row, for settings lists. */
  readonly end = input(true);
  /** The change is being saved: says "Saving" in place of the description. */
  readonly saving = input(false);
  protected readonly id = uid('pp-toggle');
}

/**
 * Choose one of a few options, all visible: inside `<pp-field label="Contract type" group="radio">`.
 * `<pp-radio-group [options]="types" [(value)]="type" />`. Spec: forms/radio.md
 */
@Component({
  selector: 'pp-radio-group',
  providers: [valueAccessor(() => PpRadioGroup)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-field__options" [class]="layout() !== 'stack' ? 'pp-field__options--' + layout() : ''" [attr.role]="layout() === 'stack' ? 'radiogroup' : null">
    @for (o of options(); track o.value) {
      <div class="pp-radio" [class.pp-radio--tile]="isTiles()">
        <input class="pp-radio__input" type="radio" [name]="name" [id]="name + '-' + $index" [checked]="o.value === value()" [disabled]="disabled() || o.disabled"
               [required]="field?.required() ?? false" [attr.aria-invalid]="field?.invalid() || invalid() || null"
               [attr.aria-describedby]="describe(o.description ? name + '-' + $index + '-d' : null)" (change)="set(o.value)" (blur)="onTouched()">
        <label class="pp-radio__label" [attr.for]="name + '-' + $index">{{ o.label }}@if (o.description) {<span class="pp-radio__description" [id]="name + '-' + $index + '-d'">{{ o.description }}</span>}</label>
      </div>
    }
    </div>
  `,
})
export class PpRadioGroup extends PpValueControl<string | null> {
  readonly options = input.required<Option[]>();
  readonly tiles = input(false);
  protected readonly name = uid('pp-radio');
  protected readonly field = inject(PpField, { optional: true });
  protected readonly layout = computed(() => (this.tiles() ? 'tiles' : this.field?.options() ?? 'stack'));
  protected readonly isTiles = computed(() => this.layout() === 'tiles');
  protected describe(own: string | null) { return [own, this.field?.describedBy()].filter(Boolean).join(' ') || null; }
}

/**
 * Search a list on this page. Results are announced. `<pp-search label="Search people" [(value)]="q" [results]="'3 people match'" />`
 * Spec: forms/search.md
 */
@Component({
  selector: 'pp-search',
  // A component host is inline by default; this one wraps blocks, and screens may give it Layout classes.
  styles: ':host { display: block; }',
  imports: [PpIcon],
  providers: [valueAccessor(() => PpSearch)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="pp-visually-hidden" [attr.for]="id">{{ label() }}</label>
    <div class="pp-text-field pp-search" [class.pp-text-field--small]="size() === 'small'" [attr.aria-busy]="busy() ? 'true' : null">
      <span class="pp-text-field__prefix"><svg ppIcon="search" /></span>
      <input class="pp-text-field__input" [id]="id" type="search" [placeholder]="placeholder() ?? label()" autocomplete="off" [value]="value() ?? ''"
             [attr.aria-describedby]="results() ? id + '-r' : null" (input)="set($any($event.target).value)" (blur)="onTouched()">
      @if (value()) { <button class="pp-text-field__action pp-search__clear" type="button" [attr.aria-label]="clearLabel()" (click)="set('')"><svg ppIcon="x" /></button> }
      @if (busy()) { <span class="pp-spinner pp-spinner--small" aria-hidden="true"></span> }
    </div>
    @if (results()) { <div class="pp-search-results" [id]="id + '-r'" role="status">{{ results() }}</div> }
  `,
  host: { role: 'search' },
})
export class PpSearch extends PpValueControl<string> {
  readonly label = input.required<string>();
  readonly placeholder = input<string>();
  readonly results = input<string>();
  /** Searching: shows a spinner. Set results to "Searching" as well. */
  readonly busy = input(false);
  readonly size = input<'medium' | 'small'>('medium');
  readonly clearLabel = input('Clear search');
  protected readonly id = uid('pp-search');
}

