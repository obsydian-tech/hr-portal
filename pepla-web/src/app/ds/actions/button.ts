import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';

export type ButtonAppearance = 'primary' | 'default' | 'subtle' | 'danger' | 'agent' | 'link' | 'neutral';

/**
 * Every button in Pepla: `<button ppButton appearance="primary">Send contract</button>`.
 * Also on links that look like buttons: `<a ppButton routerLink="…">`.
 * - `icon` goes before the label; `iconAfter` is only for chevron-down (opens a menu) or arrow-right (next step).
 * - `iconOnly` needs an aria-label on the button.
 * - `busy` shows the working state (rule 8): the label fades, a spinner takes its place, clicks are ignored.
 * - `pressed` makes it a toggle (aria-pressed).
 * Spec: project/components/actions/button.md
 */
@Component({
  selector: 'button[ppButton], a[ppButton]',
  imports: [PpIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (icon()) { <svg [ppIcon]="icon()!" /> }
    <ng-template #label><ng-content /></ng-template>
    @if (iconOnly() || !(icon() || iconAfter() || busy())) { <ng-container [ngTemplateOutlet]="label" /> } @else { <span><ng-container [ngTemplateOutlet]="label" /></span> }
    @if (iconAfter()) { <svg [ppIcon]="iconAfter()!" /> }
    @if (busy()) { <span class="pp-spinner" [class.pp-spinner--inverse]="inverse()" [class.pp-spinner--small]="size() === 'small'" aria-hidden="true"></span> }
  `,
  host: {
    '[class]': 'classes()',
    '[attr.type]': 'isButton ? type() : null',
    '[attr.aria-busy]': 'busy() ? "true" : null',
    '[attr.aria-pressed]': 'pressed() == null ? null : (pressed() ? "true" : "false")',
  },
})
export class PpButton {
  readonly appearance = input<ButtonAppearance>('default');
  readonly size = input<'small' | 'medium' | 'large'>('medium');
  readonly icon = input<IconName>();
  readonly iconAfter = input<'chevron-down' | 'arrow-right'>();
  readonly iconOnly = input(false);
  readonly block = input(false);
  readonly busy = input(false);
  readonly pressed = input<boolean>();
  /** A <button> is type="button" unless it submits its form. Links ignore it. */
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  protected readonly isButton = inject(ElementRef).nativeElement.tagName === 'BUTTON';

  protected readonly inverse = computed(() => ['primary', 'danger', 'agent'].includes(this.appearance()));
  protected readonly classes = computed(() => [
    'pp-button',
    this.appearance() !== 'neutral' && `pp-button--${this.appearance()}`,
    this.size() !== 'medium' && `pp-button--${this.size()}`,
    this.iconOnly() && 'pp-button--icon',
    this.block() && 'pp-button--block',
  ].filter(Boolean).join(' '));
}

/**
 * Buttons side by side. On a phone, `stackPhone` puts them one under another, primary on top.
 * `<pp-button-group align="end" [stackPhone]="true">…</pp-button-group>`
 */
@Component({
  selector: 'pp-button-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    class: 'pp-button-group',
    '[attr.align]': 'null', // the input, not the old HTML align attribute (it would right-align the text)
    '[class.pp-button-group--end]': 'align() === "end"',
    '[class.pp-button-group--stack-phone]': 'stackPhone()',
  },
})
export class PpButtonGroup {
  readonly align = input<'start' | 'end'>('start');
  readonly stackPhone = input(false);
}
