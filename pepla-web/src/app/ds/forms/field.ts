import { ChangeDetectionStrategy, Component, Directive, ElementRef, HostAttributeToken, TemplateRef, afterNextRender, booleanAttribute, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { IconName } from '../core/icon.registry';
import { NgTemplateOutlet } from '@angular/common';
import { PpIcon } from '../core/icon';
import { uid, PP_IN_DRAWER } from '../util';

/**
 * A label, the control, help and the error, wired for screen readers. Every form control sits in one.
 * Mark either the required fields or the optional ones on a form, never both.
 * ```html
 * <pp-field label="ID number" help="13 digits, as on the ID" [error]="idError()" [required]="true">
 *   <input ppTextField inputmode="numeric" [formControl]="id" />
 * </pp-field>
 * ```
 * Spec: forms/field.md
 */
@Component({
  selector: 'pp-field',
  imports: [PpIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (group() === 'checkbox' || group() === 'radio') {
      <fieldset class="pp-field">
        <legend class="pp-field__label"><ng-container [ngTemplateOutlet]="words" /></legend>
        @if (options() === 'none' || group() === 'radio') { <ng-container [ngTemplateOutlet]="control" /> }
        @else { <div class="pp-field__options" [class]="options() !== 'stack' ? 'pp-field__options--' + options() : ''"><ng-container [ngTemplateOutlet]="control" /></div> }
        <ng-container [ngTemplateOutlet]="after" />
      </fieldset>
    } @else {
      @if (group() === 'list' || !labelable()) { <span class="pp-field__label" [id]="controlId + '-label'"><ng-container [ngTemplateOutlet]="words" /></span> }
      @else if (label()) { <label class="pp-field__label" [id]="controlId + '-label'" [attr.for]="forId() ?? controlId"><ng-container [ngTemplateOutlet]="words" /></label> }
      <ng-container [ngTemplateOutlet]="control" />
      <ng-container [ngTemplateOutlet]="after" />
    }
    <ng-template #words>{{ label() }}@if (required()) {<span class="pp-field__required" aria-hidden="true">*</span>}@if (optional()) {<span class="pp-field__optional">(optional)</span>}</ng-template>
    <ng-template #control><ng-content /></ng-template>
    <ng-template #errorLine><div class="pp-field__error" [id]="errorId"><svg ppIcon="octagon-alert" /><span>{{ error() }}</span></div></ng-template>
    <ng-template #after>
      @if (count()) {
        <div class="pp-field__footer">
          @if (error()) { <ng-container [ngTemplateOutlet]="errorLine" /> }
          @if (help()) { <div class="pp-field__help" [id]="helpId">{{ help() }}</div> }
          <span class="pp-field__count" [class.pp-field__count--over]="over()" [id]="countId">{{ count() }}</span>
        </div>
      } @else {
        @if (error()) { <ng-container [ngTemplateOutlet]="errorLine" /> }
        @if (help()) { <div class="pp-field__help" [id]="helpId">{{ help() }}</div> }
      }
      @if (extra(); as x) { <ng-container [ngTemplateOutlet]="x" /> }
    </ng-template>
  `,
  host: { '[class]': 'group() === "checkbox" || group() === "radio" ? "" : "pp-field"', '[class.pp-field--row]': 'row()' },
})
export class PpField {
  /** The label. Leave it out only for a single checkbox, whose own label says it all. */
  readonly label = input<string>('');
  readonly help = input<string>();
  readonly error = input<string | null>();
  readonly required = input(false);
  readonly optional = input(false);
  /** "118 of 500" under a textarea. */
  readonly count = input<string>();
  /** The count is over the limit. */
  readonly over = input(false);
  /**
   * `checkbox` or `radio`: a set of choices in a fieldset and legend.
   * `list`: a label for a list such as a tag group, which points at it.
   */
  readonly group = input<'checkbox' | 'radio' | 'list'>();
  /** How a group's choices sit: stacked, inline, as tiles, or `none` when the screen lays them out (select all, with `<pp-field-options>`). */
  readonly options = input<'stack' | 'inline' | 'tiles' | 'none'>('stack');
  /** Label beside the control on wide screens. */
  readonly row = input(false);

  readonly controlId = uid('pp-field');
  /** False when the control is not a native one (a combobox on a span): the label is then a span the control points at with aria-labelledby. */
  readonly labelable = signal(true);
  /** The control's own id, when the screen gave it one (an error summary links to it): the label points there. */
  readonly forId = signal<string | null>(null);
  protected readonly helpId = `${this.controlId}-help`;
  protected readonly errorId = `${this.controlId}-error`;
  protected readonly countId = `${this.controlId}-count`;
  readonly describedBy = computed(() => [this.error() && this.errorId, this.help() && this.helpId, this.count() && this.countId].filter(Boolean).join(' ') || null);
  readonly invalid = computed(() => !!this.error());
  /** Lines a control adds under the help, such as a password's strength. Set by the control. */
  readonly extra = signal<TemplateRef<unknown> | null>(null);
}

/** Choices under a "select all" checkbox: `<pp-field group="checkbox" options="none" label="…"><pp-checkbox …/><pp-field-options [nested]="true">…</pp-field-options></pp-field>` */
@Component({
  selector: 'pp-field-options', template: '<ng-content />', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pp-field__options', '[class.pp-field__options--nested]': 'nested()', '[class.pp-field__options--inline]': 'inline()' },
})
export class PpFieldOptions {
  readonly nested = input(false);
  readonly inline = input(false);
}

/**
 * A text field with a prefix, suffix or both: `<pp-text-field-group prefix="R" [money]="true"><input ppTextField inputmode="decimal" /></pp-text-field-group>`.
 * The input inside takes the group's place in the field. Spec: forms/text-field.md
 */
@Component({
  selector: 'pp-text-field-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (prefix()) { <span class="pp-text-field__prefix" aria-hidden="true">{{ prefix() }}</span> }
    <ng-content />
    @if (suffix()) { <span class="pp-text-field__suffix">{{ suffix() }}</span> }
  `,
  host: { '[class]': 'classes()' },
})
export class PpTextFieldGroup {
  readonly prefix = input<string>();
  readonly suffix = input<string>();
  readonly money = input(false);
  readonly numeric = input(false);
  readonly size = input<'medium' | 'small'>('medium');
  protected readonly classes = computed(() => ['pp-text-field', this.money() && 'pp-text-field--money', this.numeric() && 'pp-text-field--numeric', this.size() === 'small' && 'pp-text-field--small'].filter(Boolean).join(' '));
}

/** Wires a native control to its field: id, aria-describedby, aria-invalid and required. */
@Directive()
export abstract class PpFieldControl {
  protected readonly field = inject(PpField, { optional: true });
  readonly id = input<string>();
  protected readonly controlId = computed(() => this.id() ?? this.field?.controlId ?? null);
  protected readonly describedBy = computed(() => this.field?.describedBy() ?? null);
  protected readonly invalid = computed(() => (this.field?.invalid() ? 'true' : null));
  /** `required` on the control itself: required, but not marked (a form that says "All fields are required unless marked optional"). */
  readonly required = input(false, { transform: booleanAttribute });
  protected readonly isRequired = computed(() => this.required() || !!this.field?.required());
  constructor() { effect(() => { const id = this.id(); untracked(() => this.field?.forId.set(id ?? null)); }); }
}

const CONTROL_HOST = {
  '[attr.id]': 'controlId()',
  '[attr.aria-describedby]': 'describedBy()',
  '[attr.aria-invalid]': 'invalid()',
  '[attr.required]': 'isRequired() ? "" : null',
};

/**
 * A one-line text input: `<input ppTextField type="email" autocomplete="email" />`.
 * Works with reactive forms, template forms and signal forms because it stays a native input.
 * Spec: forms/text-field.md
 */
@Directive({
  selector: 'input[ppTextField]',
  host: { ...CONTROL_HOST, '[attr.type]': 'type', '[class]': 'group ? "pp-text-field__input" : "pp-text-field" + (size() === "small" ? " pp-text-field--small" : "") + (numeric() ? " pp-text-field--numeric" : "")' },
})
export class PpTextField extends PpFieldControl {
  /** Written out, so the markup says what the field is: "text" unless the screen sets email, tel, search… */
  protected readonly type = inject(new HostAttributeToken('type'), { optional: true }) ?? 'text';
  protected readonly group = inject(PpTextFieldGroup, { optional: true });
  readonly size = input<'medium' | 'small'>('medium');
  readonly numeric = input(false);
}

/** Several lines of text: `<textarea ppTextarea maxlength="500"></textarea>`. Spec: forms/textarea.md */
@Directive({
  selector: 'textarea[ppTextarea]',
  host: { ...CONTROL_HOST, '[class]': '"pp-textarea" + (large() ? " pp-textarea--large" : "") + (auto() ? " pp-textarea--auto" : "")' },
})
export class PpTextarea extends PpFieldControl {
  readonly large = input(false);
  /** Grows with its content. */
  readonly auto = input(false);
}

/**
 * A section of a form, on the fieldset itself so sections space and divide from each other:
 * `<fieldset ppFormSection heading="Employment">…</fieldset>`. Spec: forms/form-layout.md
 */
@Component({
  selector: 'fieldset[ppFormSection]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <legend class="pp-form-section__title">{{ heading() }}</legend>
    @if (description()) { <div class="pp-form-section__description" [id]="id + '-d'">{{ description() }}</div> }
    <ng-content />
  `,
  host: { class: 'pp-form-section', '[attr.aria-describedby]': 'description() ? id + "-d" : null' },
})
export class PpFormSection {
  readonly heading = input.required<string>();
  readonly description = input<string>();
  protected readonly id = uid('pp-form-section');
}

/** Fields side by side on wide screens, one under another on phones. `[full]` on a child spans the row. */
@Component({
  selector: 'pp-form-row', template: '<ng-content />', changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pp-form-row', '[class.pp-form-row--3]': 'columns() === 3' },
})
export class PpFormRow { readonly columns = input<2 | 3>(2); }

/** A field that spans the whole form row: `<pp-field ppFull …>` */
@Directive({ selector: '[ppFull]', host: { class: 'pp-form-row__full' } })
export class PpFull {}

/** `<form ppForm>`: the form's layout, with an optional note and a footer. */
/** `<form ppForm>`, or `<div ppForm>` for fields laid out like a form that are not one. */
@Directive({ selector: 'form[ppForm], div[ppForm]', host: { '[class]': 'inDrawer ? "pp-drawer__form" : "pp-form" + (wide() ? " pp-form--wide" : "") + (raised() ? " pp-form--raised" : "")', '[attr.novalidate]': 'isForm ? "" : null' } })
export class PpForm {
  protected readonly isForm = inject(ElementRef).nativeElement.tagName === 'FORM';
  /** In a drawer the form takes the drawer's own layout (pp-drawer__form). */
  protected readonly inDrawer = inject(PP_IN_DRAWER, { optional: true }) ?? false;
  readonly wide = input(false);
  readonly raised = input(false);
}

/** The form's buttons, with an optional status line ("Saved 2 minutes ago"). */
@Component({
  selector: 'pp-form-footer', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PpIcon],
  template: `@if (status()) {<span class="pp-form__status" role="status">@if (statusIcon()) {<svg [ppIcon]="statusIcon()!" />}<span>{{ status() }}</span></span>}<ng-content />`,
  host: { class: 'pp-form__footer' },
})
export class PpFormFooter {
  readonly status = input<string>();
  /** `check` once saved. */
  readonly statusIcon = input<IconName>();
}

export interface FormError { text: string; /** The field's control id. */ for: string; }

/**
 * After a failed submit: what to fix, each a link to its field. It takes focus when it appears.
 * `<pp-error-summary heading="Fix 2 things to add Lerato" [errors]="errors()" />`. Spec: forms/form-layout.md
 */
@Component({
  selector: 'pp-error-summary',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #box class="pp-section-message pp-section-message--danger pp-form-error-summary" role="alert" tabindex="-1" [attr.aria-labelledby]="id">
      <svg ppIcon="octagon-alert" />
      <div class="pp-section-message__content">
        <div class="pp-section-message__title" role="heading" aria-level="2" [id]="id">{{ heading() }}</div>
        <div class="pp-form-error-summary__list" role="list">
          @for (e of errors(); track e.for) { <div role="listitem"><a class="pp-link" [attr.href]="'#' + e.for" (click)="go($event, e.for)">{{ e.text }}</a></div> }
        </div>
      </div>
    </div>
  `,
})
export class PpErrorSummary {
  readonly heading = input.required<string>();
  readonly errors = input.required<FormError[]>();
  /** Take focus when shown (after submit). Off in previews. */
  readonly focus = input(true);
  protected readonly id = uid('pp-error-summary');
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  constructor() { afterNextRender(() => { if (this.focus()) this.box().nativeElement.focus(); }); }
  protected go(ev: Event, id: string) {
    ev.preventDefault();
    const el = document.getElementById(id);
    el?.focus(); el?.scrollIntoView({ block: 'center' });
  }
}

/**
 * A region that scrolls inside itself above a height: `<div ppScroll label="Applicants" height="440px">`.
 * It can be reached and scrolled with the keyboard. Spec: layout/layout.md
 */
@Directive({
  selector: 'div[ppScroll]',
  host: { class: 'pp-scroll', role: 'region', tabindex: '0', '[attr.aria-label]': 'label()', '[style.--_height]': 'height()' },
})
export class PpScroll {
  readonly label = input.required<string>();
  readonly height = input<string>();
}

/** One line above a form: "All fields are required unless marked optional." */
@Component({ selector: 'pp-form-note', template: '<ng-content />', host: { class: 'pp-form__note' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpFormNote {}
