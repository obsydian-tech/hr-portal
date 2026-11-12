import { ChangeDetectionStrategy, Component, ElementRef, input, model, output, viewChild } from '@angular/core';
import { PpButton } from './button';
import { PpIcon } from '../core/icon';
import { PpDropdownMenu } from '../overlays/overlays';

/**
 * One main action and a menu of other ways to do it: "Send contract" ▾ "Send on start date".
 * `<pp-split-button label="Send contract" menuLabel="More ways to send the contract" (run)="send()">
 *    <pp-menu-item icon="clock" (click)="later()">Send on start date</pp-menu-item></pp-split-button>`
 * Spec: actions/split-button.md
 */
@Component({
  selector: 'pp-split-button',
  imports: [PpButton, PpDropdownMenu, PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #group class="pp-split-button" [class.pp-split-button--small]="size() === 'small'" [class.pp-split-button--block]="block()" role="group" [attr.aria-label]="groupLabel() ?? label()">
      <button ppButton class="pp-split-button__main" [appearance]="appearance()" [size]="size()" [busy]="busy()" [disabled]="disabled()" (click)="run.emit()">{{ busy() ? busyText() : label() }}</button>
      <button #more type="button" [class]="'pp-button pp-button--' + appearance() + (size() !== 'medium' ? ' pp-button--' + size() : '') + ' pp-split-button__trigger'"
              [attr.aria-label]="menuLabel()" aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? dd.menuId : null"
              [attr.aria-disabled]="busy() ? 'true' : null" [disabled]="disabled()" (click)="toggle()"><svg ppIcon="chevron-down" /></button>
    </div>
    <pp-dropdown-menu #dd [trigger]="false" [label]="menuLabel()" [inline]="inline()" [(open)]="open" [origin]="group" [returnTo]="moreEl().nativeElement" align="end"><ng-content /></pp-dropdown-menu>
  `,
  host: { '[class.pp-popup-anchor]': 'inline()' },
})
export class PpSplitButton {
  readonly label = input.required<string>();
  /** The arrow's name and the menu's: "More ways to send the contract". */
  readonly menuLabel = input.required<string>();
  /** The pair's name, when it differs from the main button ("Approve leave"). */
  readonly groupLabel = input<string>();
  readonly appearance = input<'primary' | 'default'>('primary');
  readonly size = input<'small' | 'medium' | 'large'>('medium');
  readonly block = input(false);
  /** Working: the main button spins, the arrow can't open. */
  readonly busy = input(false);
  readonly busyText = input('Working');
  readonly disabled = input(false);
  readonly open = model(false);
  /** In place, for the gallery and docs. */
  readonly inline = input(false);
  readonly run = output<void>();
  protected readonly moreEl = viewChild.required('more', { read: ElementRef<HTMLElement> });
  protected toggle() { if (!this.busy()) this.open.update((o) => !o); }
}
