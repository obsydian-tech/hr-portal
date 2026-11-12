// Built on Angular Aria (combobox + listbox) and the CDK overlay, like the multi-select. Spec: forms/select.md
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, afterRenderEffect, afterNextRender, computed, effect, forwardRef, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option as AriaOption } from '@angular/aria/listbox';
import { OverlayModule } from '@angular/cdk/overlay';
import { PpField } from '../field';
import { PpIcon } from '../../core/icon';
import { PpValueControl, valueAccessor } from '../../util';
import { Option } from '../controls';

/**
 * Choose one when the options need groups, a second line, an icon, or a filter (people, pipeline stages).
 * For a short plain list, use `<pp-select>`: the phone shows its own picker.
 * `<pp-field label="Move to stage" [labelOnly]="true"><pp-rich-select [options]="stages" [(value)]="stage" /></pp-field>`
 * An option with `disabled` should say why in its `description`. Spec: forms/select.md
 */
@Component({
  selector: 'pp-rich-select',
  imports: [Combobox, ComboboxPopup, OverlayModule, PpIcon, forwardRef(() => PpRichSelectPanel)],
  providers: [valueAccessor(() => PpRichSelect)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-select" [class.pp-select--open]="open()">
      <span class="pp-select__value" [class.pp-select__value--placeholder]="!chosen()"
           ngCombobox #combobox="ngCombobox" [expanded]="open()" (expandedChange)="setOpen($event)" [alwaysExpanded]="filter() && open()" [disabled]="disabled()" (keydown.escape)="setOpen(false)"
           [id]="field?.controlId" [attr.aria-labelledby]="field ? field.controlId + '-label' : null"
           [attr.aria-describedby]="field?.describedBy()" [attr.aria-invalid]="field?.invalid() || invalid() ? 'true' : null"
           (blur)="onTouched()">{{ chosen()?.label ?? placeholder() }}</span>
      <svg ppIcon="chevron-down" />
    </div>

    <!-- The panel is written once, in PpRichSelectPanel, and sits inside the popup either way so Aria can find it. -->
    @if (inline()) {
      <ng-template ngComboboxPopup [combobox]="combobox"><div ppRichSelectPanel></div></ng-template>
    } @else {
      <ng-template [cdkConnectedOverlay]="{ origin: combobox.element, usePopover: 'inline', matchWidth: true }" [cdkConnectedOverlayOpen]="open()">
        <ng-template ngComboboxPopup [combobox]="combobox"><div ppRichSelectPanel></div></ng-template>
      </ng-template>
    }
  `,
  // In place (docs), the field and the list are the field's own rows, so the field's gap sits between them.
  host: { '[style.display]': 'inline() ? "contents" : null' },
})
export class PpRichSelect extends PpValueControl<string | null> {
  readonly options = input.required<Option[]>();
  readonly placeholder = input('Choose');
  /** A filter box at the top of the list, for long lists such as people. */
  readonly filter = input(false);
  readonly filterLabel = input('Filter');
  readonly empty = input('Nothing matches. Try fewer letters.');
  readonly field = inject(PpField, { optional: true });
  /** Open or closed; set it only to show the list open in docs. */
  readonly open = model(false);
  /** The list in place under the field instead of floating (docs only). */
  readonly inline = input(false);
  /** The words in the filter. */
  readonly query = model('');
  protected readonly chosen = computed(() => this.options().find((o) => o.value === this.value()));
  readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.options().filter((o) => (o.label + ' ' + (o.description ?? '')).toLowerCase().includes(q)) : this.options();
  });
  list?: Listbox<string>;
  private readonly combobox = viewChild.required(Combobox);
  filterBox?: ElementRef<HTMLInputElement>;

  constructor() {
    super();
    this.field?.labelable.set(false);
    afterRenderEffect(() => { if (this.open()) this.list?.scrollActiveItemIntoView(); });
    // Shown open from the start (docs): start on the chosen value.
    afterNextRender(() => { if (this.open()) this.highlighted.set(this.value() ? [this.value()!] : []); });
  }
  /** Opening starts on the chosen value; closing clears the filter, so the whole list shows next time. */
  setOpen(open: boolean) {
    if (open === this.open()) return;
    if (open) this.highlighted.set(this.value() ? [this.value()!] : []);
    else this.query.set('');
    this.open.set(open);
  }
  /** With a filter, focus moves into the list, so Aria keeps it open and these close it: a click outside, Escape, a choice. */
  @HostListener('document:pointerdown', ['$event']) protected outside(e: Event) {
    if (this.open() && this.filter() && !this.host.contains(e.target as Node)) this.setOpen(false);
  }
  @HostListener('focusout', ['$event']) protected left(e: FocusEvent) {
    if (this.open() && this.filter() && !this.host.contains(e.relatedTarget as Node)) this.setOpen(false);
  }
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Aria moves this as you arrow through; nothing is chosen until Enter or a click (like the autocomplete). */
  readonly highlighted = signal<string[]>([]);
  commit() {
    const next = this.highlighted()[0];
    const o = this.options().find((x) => x.value === next);
    if (!o || o.disabled) return;
    this.set(o.value);
    this.setOpen(false);
    this.combobox().element.focus();
  }
  /** Arrows, Enter and Escape in the filter move through the list, as they do on the closed select. */
  forward(e: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Enter') { this.commit(); return; }
    if (e.key === 'Escape') { this.setOpen(false); this.combobox().element.focus(); return; }
    this.combobox().element.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }));
  }
}

/** The open list: filter, groups and options. Inside the combobox popup, so Aria wires it to the field. */
@Component({
  selector: 'div[ppRichSelectPanel]',
  imports: [ComboboxWidget, Listbox, AriaOption, PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
          @if (sel.filter()) {
            <div class="pp-select-panel__filter">
              <div class="pp-text-field pp-text-field--small">
                <span class="pp-text-field__prefix"><svg ppIcon="search" /></span>
                <input #filterBox class="pp-text-field__input" type="search" [value]="sel.query()" [attr.aria-label]="sel.filterLabel()"
                       (input)="sel.query.set($any($event.target).value)" (keydown)="sel.forward($event)">
              </div>
            </div>
            @if (!sel.shown().length) { <div class="pp-select-panel__empty">{{ sel.empty() }}</div> }
          }
          <div class="pp-select-panel__list" ngListbox ngComboboxWidget #list="ngListbox"
               focusMode="activedescendant" [tabIndex]="-1" [activeDescendant]="list.activeDescendant()"
               [attr.aria-labelledby]="sel.field ? sel.field.controlId + '-label' : null"
               [(value)]="sel.highlighted" (click)="sel.commit()" (keydown.enter)="sel.commit()">
            @for (o of sel.shown(); track o.value; let i = $index) {
              @if (o.group && o.group !== sel.shown()[i - 1]?.group) { <div class="pp-select-panel__group" role="presentation">{{ o.group }}</div> }
              <div class="pp-select-option" ngOption #opt="ngOption" [value]="o.value" [label]="o.label" [disabled]="!!o.disabled"
                   [class.pp-select-option--focused]="opt.active()">
                @if (o.icon) { <svg [ppIcon]="o.icon" /> }
                <span class="pp-select-option__text">{{ o.label }}@if (o.description) {<span class="pp-select-option__meta">{{ o.description }}</span>}</span>
                <span class="pp-select-option__check"><svg ppIcon="check" /></span>
              </div>
            }
          </div>
  `,
  host: { class: 'pp-select-panel' },
})
export class PpRichSelectPanel {
  protected readonly sel = inject(PpRichSelect);
  private readonly listbox = viewChild(Listbox);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('filterBox');
  constructor() {
    effect(() => { this.sel.list = this.listbox() as Listbox<string> | undefined; this.sel.filterBox = this.box(); });
    // A filtered list opens with the cursor in the filter.
    afterNextRender(() => this.box()?.nativeElement.focus());
  }
}
