import { Directive, InjectionToken, forwardRef, input, model, Provider, Type } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let next = 0;
/** A unique id for wiring labels, help and errors (`pp-field-3`). */
/** Set inside a drawer's body, so a form there takes the drawer's tighter form layout. */
export const PP_IN_DRAWER = new InjectionToken<boolean>('PP_IN_DRAWER');

export const uid = (prefix = 'pp') => `${prefix}-${++next}`;

/** Joins class names whose condition is true. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Registers a control as a ControlValueAccessor, so it works with reactive and template forms. */
export const valueAccessor = (type: () => Type<unknown>): Provider => ({
  provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(type), multi: true,
});

/**
 * Base for ds form controls: a `value` model (two-way binding and signal forms) plus
 * ControlValueAccessor (reactive and template-driven forms).
 */
@Directive()
export abstract class PpValueControl<T> implements ControlValueAccessor {
  readonly value = model<T>(undefined as T);
  readonly disabled = model(false);
  readonly invalid = input(false);
  private onChange: (v: T) => void = () => {};
  protected onTouched: () => void = () => {};

  protected set(v: T) { this.value.set(v); this.onChange(v); }
  writeValue(v: T) { this.value.set(v); }
  registerOnChange(fn: (v: T) => void) { this.onChange = fn; }
  registerOnTouched(fn: () => void) { this.onTouched = fn; }
  setDisabledState(d: boolean) { this.disabled.set(d); }
}
