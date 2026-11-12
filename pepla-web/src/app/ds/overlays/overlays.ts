import {
  AfterContentInit, ChangeDetectionStrategy, Component, Directive, ElementRef, HostListener, OnDestroy, TemplateRef, ViewContainerRef,
  booleanAttribute, contentChildren, effect, inject, input, model, output, signal, untracked, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { ConnectedOverlayPositionChange, ConnectedPosition, Overlay, OverlayModule, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpButton, ButtonAppearance } from '../actions/button';
import { PP_IN_DRAWER, uid } from '../util';

/**
 * Puts a dialog or drawer at the top of the page (the CDK overlay container), so no card, table or
 * container query around the button that opened it can clip or move it.
 */
@Directive()
export abstract class PpLayer implements OnDestroy {
  readonly open = model(false);
  /** In place instead of over the page, for the gallery and docs. */
  readonly inline = input(false);
  /** Height of the in-place frame, in pixels (docs only). */
  readonly inlineHeight = input<number>();
  protected inlineSize() { return this.inline() && this.inlineHeight() ? this.inlineHeight() + 'px' : null; }
  readonly closed = output<void>();
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private ref?: OverlayRef;
  private opener: HTMLElement | null = null;
  protected abstract readonly layer: () => TemplateRef<unknown>;

  constructor() {
    effect(() => {
      const show = this.open() && !this.inline();
      untracked(() => {
        if (show && !this.ref) {
          this.opener = document.activeElement as HTMLElement;
          this.ref = this.overlay.create({ positionStrategy: this.overlay.position().global(), scrollStrategy: this.overlay.scrollStrategies.block() });
          this.ref.attach(new TemplatePortal(this.layer(), this.vcr));
        } else if (!show && this.ref) {
          this.ref.dispose();
          this.ref = undefined;
          queueMicrotask(() => this.opener?.focus());
        }
      });
    });
  }
  close() { this.open.set(false); this.closed.emit(); }
  ngOnDestroy() { this.ref?.dispose(); }
}

/**
 * A modal dialog: one decision, then back to the page. Opened with `[(open)]`.
 * Focus moves in, stays in, and returns to what opened it. Escape and the blanket close it, except
 * `tone="danger"` (an alert dialog), which closes only by its buttons.
 * Footer buttons go in `<pp-modal-footer>`; the primary is last.
 * `<pp-modal-dialog [(open)]="confirming" heading="Withdraw Lerato Mokoena's offer?" tone="danger">…</pp-modal-dialog>`
 * Spec: overlays/modal-dialog.md
 */
@Component({
  selector: 'pp-modal-dialog',
  imports: [A11yModule, NgTemplateOutlet, PpIcon, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #layer>
      <div class="pp-blanket" [class.pp-blanket--sheet]="sheet()" [class.pp-blanket--inline]="inline()" [style.--_height]="inlineSize()" (click)="blanket($event)">
        <div [class]="classes()" [attr.role]="tone() === 'danger' ? 'alertdialog' : 'dialog'" aria-modal="true"
             [attr.aria-labelledby]="id + '-t'" [attr.aria-describedby]="tone() === 'danger' ? id + '-d' : null" cdkTrapFocus [cdkTrapFocusAutoCapture]="!inline()">
          <div class="pp-modal-dialog__header">
            @if (tone() !== 'default') { <svg ppIcon="triangle-alert" /> }
            <h2 class="pp-modal-dialog__title" [id]="id + '-t'">{{ heading() }}</h2>
            @if (tone() === 'default' && closable()) {
              <button ppButton appearance="subtle" icon="x" [iconOnly]="true" class="pp-modal-dialog__close" aria-label="Close" (click)="close()"></button>
            }
          </div>
          <div class="pp-modal-dialog__body" [id]="id + '-d'"><ng-container [ngTemplateOutlet]="body" /></div>
          <ng-container [ngTemplateOutlet]="footer" />
        </div>
      </div>
    </ng-template>
    <ng-template #body><ng-content /></ng-template>
    <ng-template #footer><ng-content select="pp-modal-footer" /></ng-template>
    @if (open() && inline()) { <ng-container [ngTemplateOutlet]="layer" /> }
  `,
})
export class PpModalDialog extends PpLayer {
  readonly heading = input.required<string>();
  readonly tone = input<'default' | 'warning' | 'danger'>('default');
  readonly size = input<'small' | 'medium' | 'large'>('medium');
  /** A close button in the corner. Leave it off when the footer already says "Cancel" or "Not now". */
  readonly closable = input(false);
  /** A bottom sheet on phones. */
  readonly sheet = input(false);
  protected readonly id = uid('pp-modal');
  protected readonly layer = viewChild.required<TemplateRef<unknown>>('layer');
  protected classes() {
    return ['pp-modal-dialog', this.size() !== 'medium' && `pp-modal-dialog--${this.size()}`, this.tone() !== 'default' && `pp-modal-dialog--${this.tone()}`,
      this.sheet() && 'pp-modal-dialog--sheet', this.inline() && 'pp-modal-dialog--inline'].filter(Boolean).join(' ');
  }
  protected blanket(e: MouseEvent) { if (e.target === e.currentTarget && this.tone() !== 'danger' && !this.inline()) this.close(); }
  @HostListener('document:keydown.escape') protected escape() { if (this.open() && this.tone() !== 'danger' && !this.inline()) this.close(); }
}

/** The dialog's buttons: secondary first, primary last. */
@Component({ selector: 'pp-modal-footer', template: '<ng-content />', host: { class: 'pp-modal-dialog__footer' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpModalFooter {}

/**
 * A drawer from the right edge, for editing a record or a setting without leaving the page.
 * `<pp-drawer [(open)]="editing" heading="Edit routing rule" description="…">form…<pp-drawer-footer note="Last changed …">…</pp-drawer-footer></pp-drawer>`
 * Spec: overlays/drawer.md
 */
@Component({
  selector: 'pp-drawer',
  providers: [{ provide: PP_IN_DRAWER, useValue: true }],
  imports: [A11yModule, NgTemplateOutlet, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #layer>
      <div class="pp-blanket pp-blanket--end" [class.pp-blanket--inline]="inline()" (click)="blanket($event)">
        <div class="pp-drawer" [class.pp-drawer--large]="large()" [class.pp-drawer--inline]="inline()" [style.--_height]="inlineSize()" role="dialog" aria-modal="true" [attr.aria-labelledby]="id + '-t'" cdkTrapFocus [cdkTrapFocusAutoCapture]="!inline()">
          <div class="pp-drawer__header">
            <div class="pp-drawer__heading">
              <h2 class="pp-drawer__title" [id]="id + '-t'">{{ heading() }}</h2>
              @if (description()) { <p class="pp-drawer__description">{{ description() }}</p> }
            </div>
            <button ppButton appearance="subtle" icon="x" [iconOnly]="true" class="pp-drawer__close" aria-label="Close" (click)="close()"></button>
          </div>
          <div class="pp-drawer__body"><ng-container [ngTemplateOutlet]="body" /></div>
          <ng-container [ngTemplateOutlet]="footer" />
        </div>
      </div>
    </ng-template>
    <ng-template #body><ng-content /></ng-template>
    <ng-template #footer><ng-content select="pp-drawer-footer" /></ng-template>
    @if (open() && inline()) { <ng-container [ngTemplateOutlet]="layer" /> }
  `,
})
export class PpDrawer extends PpLayer {
  readonly heading = input.required<string>();
  readonly description = input<string>();
  readonly large = input(false);
  protected readonly id = uid('pp-drawer');
  protected readonly layer = viewChild.required<TemplateRef<unknown>>('layer');
  protected blanket(e: MouseEvent) { if (e.target === e.currentTarget && !this.inline()) this.close(); }
  @HostListener('document:keydown.escape') protected escape() { if (this.open() && !this.inline()) this.close(); }
}

/** The drawer's sticky footer: an optional note ("Last changed by …"), then the buttons, primary last. */
@Component({
  selector: 'pp-drawer-footer', changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (note()) {<span class="pp-drawer__footer-note">{{ note() }}</span>}<ng-content />`,
  host: { class: 'pp-drawer__footer' },
})
export class PpDrawerFooter { readonly note = input<string>(); }

// ------------------------------------------------------------------ anchored panels

const BELOW = (align: 'start' | 'end', gap: number): ConnectedPosition[] => [
  { originX: align, originY: 'bottom', overlayX: align, overlayY: 'top', offsetY: gap },
  { originX: align, originY: 'top', overlayX: align, overlayY: 'bottom', offsetY: -gap },
];
const ABOVE = (align: 'start' | 'end', gap: number): ConnectedPosition[] => [BELOW(align, gap)[1], BELOW(align, gap)[0]];

// ------------------------------------------------------------------ dropdown menu

/**
 * One item in a dropdown menu. `<button ppMenuItem icon="pencil" (click)="edit()">Edit details</button>`
 * `danger` for actions that remove something; `end` for a short value at the end (a number, a shortcut);
 * `[checked]` makes it one choice of several (sort by), with a check on the chosen one.
 */
@Component({
  selector: 'button[ppMenuItem], a[ppMenuItem]',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (icon()) {<svg [ppIcon]="icon()!" />}<span><ng-content /></span>@if (end()) {<span class="pp-dropdown-menu__end">{{ end() }}</span>} @else if (checked()) {<span class="pp-dropdown-menu__end"><svg ppIcon="check" /></span>}`,
  host: {
    class: 'pp-dropdown-menu__item', tabindex: '-1',
    '[attr.role]': 'checked() === undefined ? "menuitem" : "menuitemradio"',
    '[attr.aria-checked]': 'checked() === undefined ? null : (checked() ? "true" : "false")',
    '[attr.aria-disabled]': 'disabled() ? "true" : null',
    '[attr.disabled]': 'null', // stays focusable, as menus expect; aria-disabled says it is off
    '[attr.type]': 'isButton ? "button" : null',
    '[class.pp-dropdown-menu__item--danger]': 'danger()',
  },
})
export class PpMenuItem {
  readonly icon = input<IconName>();
  readonly danger = input(false);
  readonly end = input<string>();
  readonly checked = input<boolean>();
  /** Shown but not available, with the reason somewhere near (a tooltip or the page). */
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly isButton = this.el.tagName === 'BUTTON';
}

/** A group of items, with an optional heading. */
@Component({
  selector: 'pp-menu-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (heading()) {<span class="pp-dropdown-menu__heading" [id]="id">{{ heading() }}</span>}<ng-content />`,
  styles: ':host { display: block; }',
  host: { class: 'pp-dropdown-menu__section', role: 'group', '[attr.aria-labelledby]': 'heading() ? id : null' },
})
export class PpMenuSection {
  readonly heading = input<string>();
  protected readonly id = uid('pp-menu-h');
}

/**
 * A button that opens a menu of actions. Arrow keys move, Escape closes and returns focus.
 * `<pp-dropdown-menu label="More actions for Thandeka Dlamini"><pp-menu-section>…</pp-menu-section></pp-dropdown-menu>`
 * With no `text`, the trigger is the "More actions" icon button and `label` is its name.
 * The menu floats above the page, so a table or card around it never clips it.
 * Spec: overlays/dropdown-menu.md
 */
@Component({
  selector: 'pp-dropdown-menu',
  imports: [PpButton, OverlayModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (trigger()) {
      <button ppButton [appearance]="text() ? 'default' : 'subtle'" [size]="size()" [icon]="text() ? undefined : 'ellipsis'" [iconOnly]="!text()"
              [iconAfter]="text() ? 'chevron-down' : undefined" [attr.aria-label]="text() ? null : label()"
              aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? id : null" (click)="toggle()">{{ text() }}</button>
    }
    <ng-template #panel>
      <div class="pp-dropdown-menu" [class.pp-dropdown-menu--inline]="inline()" [class.pp-dropdown-menu--floating]="!inline()" [id]="id" role="menu" [attr.aria-label]="menuLabel() ?? label()" (keydown)="keys($event)" (click)="picked($event)"><ng-content /></div>
    </ng-template>
    @if (inline()) { @if (open()) { <ng-container [ngTemplateOutlet]="panel" /> } }
    @else {
      <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin() ?? host" [cdkConnectedOverlayOpen]="open()" [cdkConnectedOverlayPositions]="positions()"
                   cdkConnectedOverlayUsePopover="inline" (overlayOutsideClick)="outside($event)" (detach)="open.set(false)">
        <ng-container [ngTemplateOutlet]="panel" />
      </ng-template>
    }
  `,
  // Only the in-place (docs) menu hangs from its host; the real one floats in the overlay layer.
  host: { '[class.pp-popup-anchor]': 'inline() && trigger()', '[attr.align]': 'null' },
})
export class PpDropdownMenu {
  /**
   * The built-in button. Turn it off when something else opens the menu (the avatar in the top
   * navigation): set `[(open)]` from there; the menu hangs under this element.
   */
  readonly trigger = input(true);
  readonly label = input.required<string>();
  /** The menu's own name, when it differs from the button's: button "More actions for Thandeka Dlamini", menu "Actions for Thandeka Dlamini". */
  readonly menuLabel = input<string>();
  readonly text = input<string>();
  readonly size = input<'small' | 'medium'>('small');
  readonly align = input<'start' | 'end'>('end');
  readonly open = model(false);
  /** In place under the button, for the gallery and docs. */
  readonly inline = input(false);
  /** Without the built-in button: what the menu hangs from (a split button's pair). Defaults to this element. */
  readonly origin = input<HTMLElement>();
  /** Without the built-in button: what gets focus back on Escape or a pick. */
  readonly returnTo = input<HTMLElement>();
  protected readonly id = uid('pp-menu');
  /** The menu's id, for the opener's aria-controls. */
  get menuId() { return this.id; }
  protected readonly positions = () => BELOW(this.align(), 4);
  private readonly items = contentChildren(PpMenuItem, { descendants: true });
  protected readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private button() { return this.trigger() ? this.host.querySelector<HTMLElement>('button') : this.returnTo() ?? null; }

  constructor() {
    effect(() => { if (this.open() && !this.trigger() && !this.inline()) untracked(() => setTimeout(() => this.focusItem(0))); });
  }
  protected toggle() {
    this.open.update((o) => !o);
    if (this.open()) setTimeout(() => this.focusItem(0));
  }
  private enabled() { return this.items().filter((x) => !x.disabled()).map((x) => x.el); }
  private focusItem(i: number) { const list = this.enabled(); list.at(((i % list.length) + list.length) % list.length)?.focus(); }
  protected keys(e: KeyboardEvent) {
    const list = this.enabled();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    if (e.key === 'End') { e.preventDefault(); list.at(-1)?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); this.open.set(false); this.button()?.focus(); }
    if (e.key === 'Tab') this.open.set(false);
  }
  protected outside(e: MouseEvent) { if (!this.button()?.contains(e.target as Node)) this.open.set(false); }
  protected picked(e: MouseEvent) {
    const item = (e.target as HTMLElement).closest('[role^="menuitem"]');
    if (!item) return;
    if (item.getAttribute('aria-disabled') === 'true') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!this.inline()) { this.open.set(false); this.button()?.focus(); }
  }
}

// ------------------------------------------------------------------ popup

/**
 * A small panel from a button: a filter, or an explanation. Not a menu (that's `<pp-dropdown-menu>`)
 * and not a decision (that's a modal). Escape and a click outside close it.
 * `<pp-popup text="Country" heading="Show people in" label="Filter by country">…<pp-popup-footer>…</pp-popup-footer></pp-popup>`
 * Spec: overlays/popup.md
 */
@Component({
  selector: 'pp-popup',
  imports: [PpButton, OverlayModule, NgTemplateOutlet, A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button ppButton [appearance]="appearance()" size="small" [icon]="icon()" [iconAfter]="appearance() === 'link' ? undefined : 'chevron-down'"
            cdkOverlayOrigin #origin="cdkOverlayOrigin" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? id : null" (click)="open.set(!open())">{{ text() }}</button>
    <ng-template #panel>
      <div class="pp-popup" [class.pp-popup--inline]="inline()" [class.pp-popup--floating]="!inline()" [class.pp-popup--wide]="wide()" [id]="id" role="dialog"
           [attr.aria-label]="label() ?? null" [attr.aria-labelledby]="label() ? null : id + '-t'" (keydown.escape)="dismiss()" cdkTrapFocus [cdkTrapFocusAutoCapture]="!inline()">
        @if (footerSlot()) {
          <div class="pp-popup__header"><h3 class="pp-popup__title" [id]="id + '-t'">{{ heading() }}</h3></div>
        } @else {
          <h3 class="pp-popup__title" [id]="id + '-t'">{{ heading() }}</h3>
        }
        <ng-content />
        <ng-content select="pp-popup-footer" />
      </div>
    </ng-template>
    @if (inline()) { @if (open()) { <ng-container [ngTemplateOutlet]="panel" /> } }
    @else {
      <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()" [cdkConnectedOverlayPositions]="positions()"
                   cdkConnectedOverlayUsePopover="inline" (overlayOutsideClick)="outside($event)" (detach)="open.set(false)">
        <ng-container [ngTemplateOutlet]="panel" />
      </ng-template>
    }
  `,
  host: { class: 'pp-popup-anchor', '[attr.align]': 'null' },
})
export class PpPopup {
  /** The button's words. */
  readonly text = input.required<string>();
  readonly icon = input<IconName>();
  readonly appearance = input<ButtonAppearance>('default');
  readonly heading = input.required<string>();
  /** A name for the popup when the heading doesn't say what it is for: "Filter by country". */
  readonly label = input<string>();
  readonly align = input<'start' | 'end'>('start');
  readonly wide = input(false);
  readonly open = model(false);
  readonly inline = input(false);
  protected readonly id = uid('pp-popup');
  protected readonly positions = () => BELOW(this.align(), 4);
  protected readonly footers = contentChildren(PpPopupFooter);
  protected footerSlot() { return this.footers().length > 0; }
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected dismiss() { this.open.set(false); this.host.querySelector<HTMLElement>('button')?.focus(); }
  protected outside(e: MouseEvent) { if (!this.host.contains(e.target as Node)) this.open.set(false); }
}

/** The popup's buttons: Clear first, the one that applies last. */
@Component({ selector: 'pp-popup-footer', template: '<ng-content />', host: { class: 'pp-popup__footer' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpPopupFooter {}

// ------------------------------------------------------------------ inline dialog

/**
 * A short question next to the control it is about, with a beak pointing at it: "Remind new employees by SMS?".
 * Use `tone="agent"` for a Batsi suggestion about one field. Opens from its button, closes by its actions.
 * `<pp-inline-dialog text="SMS reminders" icon="bell" heading="Remind new employees by SMS?" [closable]="true">Body<pp-inline-dialog-actions>…</pp-inline-dialog-actions></pp-inline-dialog>`
 * Spec: overlays/inline-dialog.md
 */
@Component({
  selector: 'pp-inline-dialog',
  imports: [PpButton, PpIcon, OverlayModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button ppButton [appearance]="appearance()" size="small" [icon]="icon()" cdkOverlayOrigin #origin="cdkOverlayOrigin"
            [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? id : null" (click)="open.set(!open())">{{ text() }}</button>
    <ng-template #panel>
      <div [class]="classes()" [id]="id" role="dialog" [attr.aria-labelledby]="id + '-t'" [attr.aria-describedby]="id + '-d'" (keydown.escape)="dismiss()">
        <div class="pp-inline-dialog__header">
          @if (tone() === 'agent') { <svg ppIcon="sparkles" /> }
          <div class="pp-inline-dialog__title" [id]="id + '-t'" role="heading" aria-level="3">{{ heading() }}</div>
          @if (closable()) { <button ppButton appearance="subtle" size="small" icon="x" [iconOnly]="true" class="pp-inline-dialog__close" aria-label="Close" (click)="dismiss()"></button> }
        </div>
        <div class="pp-inline-dialog__text" [id]="id + '-d'"><ng-content /></div>
        <ng-content select="pp-inline-dialog-actions" />
      </div>
    </ng-template>
    @if (inline()) { @if (open()) { <ng-container [ngTemplateOutlet]="panel" /> } }
    @else {
      <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()" [cdkConnectedOverlayPositions]="positions()"
                   cdkConnectedOverlayUsePopover="inline" (positionChange)="placed($event)" (detach)="open.set(false)">
        <ng-container [ngTemplateOutlet]="panel" />
      </ng-template>
    }
  `,
  // [attr.align]: the input, not the old HTML align attribute, which would right-align the text.
  host: { class: 'pp-inline-dialog-anchor', '[attr.align]': 'null' },
})
export class PpInlineDialog {
  readonly text = input.required<string>();
  readonly icon = input<IconName>();
  readonly appearance = input<ButtonAppearance>('default');
  readonly heading = input.required<string>();
  readonly tone = input<'default' | 'agent'>('default');
  readonly closable = input(false);
  /** Above the button instead of below. */
  readonly top = input(false);
  readonly align = input<'start' | 'end'>('start');
  readonly open = model(false);
  readonly inline = input(false);
  protected readonly id = uid('pp-inline-dialog');
  protected readonly positions = () => (this.top() ? ABOVE : BELOW)(this.align(), 12);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Where the overlay actually put it: above when there was no room below, so the beak points the right way. */
  private readonly above = signal<boolean | null>(null);
  protected placed(e: ConnectedOverlayPositionChange) { this.above.set(e.connectionPair.overlayY === 'bottom'); }
  protected classes() {
    const top = this.inline() ? this.top() : (this.above() ?? this.top());
    return ['pp-inline-dialog', this.tone() === 'agent' && 'pp-inline-dialog--agent', top && 'pp-inline-dialog--top',
      this.align() === 'end' && 'pp-inline-dialog--end', this.inline() ? 'pp-inline-dialog--inline' : 'pp-inline-dialog--floating'].filter(Boolean).join(' ');
  }
  protected dismiss() { this.open.set(false); this.host.querySelector<HTMLElement>('button')?.focus(); }
}

/** The inline dialog's two buttons: the quiet way out first, the action last. */
@Component({ selector: 'pp-inline-dialog-actions', template: '<ng-content />', host: { class: 'pp-inline-dialog__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpInlineDialogActions {}

// ------------------------------------------------------------------ tooltip

/** When a tooltip last hid: moving along a toolbar shows the next one at once (tooltip.md). */
let lastTooltipHidden = 0;

/**
 * A short label for an icon button or a truncated value, on hover (after 300ms) and keyboard focus
 * (at once). Escape hides it. Never the only place something is said, and never on a phone (no hover).
 * It floats in the overlay layer, so a table or card around it never clips it.
 * `<pp-tooltip text="View audit trail"><button …></pp-tooltip>`
 * `[redundant]="true"` when it repeats the button's own name ("More actions"): screen readers skip it.
 * `kbd` adds a shortcut hint. `open` and `inline` are for the docs.
 * Spec: messages/tooltip.md
 */
@Component({
  selector: 'pp-tooltip',
  imports: [OverlayModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #tip let-floating="floating">
      <span [class]="classes()" [id]="floating ? null : id" role="tooltip" [attr.aria-hidden]="redundant() || floating ? 'true' : null">{{ text() }}@if (kbd()) {<kbd>{{ kbd() }}</kbd>}</span>
    </ng-template>
    @if (inline()) {
      <ng-container [ngTemplateOutlet]="tip" />
    } @else {
      <ng-content />
      @if (open()) {
        <ng-container [ngTemplateOutlet]="tip" />
      } @else {
        <!-- The description, always in the page (the floating copy comes and goes). -->
        @if (!redundant()) { <span class="pp-visually-hidden" [id]="id">{{ text() }}</span> }
        <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="host" [cdkConnectedOverlayOpen]="shown()" [cdkConnectedOverlayPositions]="positions()"
                     cdkConnectedOverlayUsePopover="inline" (detach)="shown.set(false)">
          <ng-container [ngTemplateOutlet]="tip" [ngTemplateOutletContext]="{ floating: true }" />
        </ng-template>
      }
    }
  `,
  host: {
    '[class.pp-tooltip-anchor]': '!inline()',
    '[class.pp-tooltip-anchor--open]': 'open()',
    '(mouseenter)': 'enter()', '(mouseleave)': 'hide()',
    '(focusin)': 'focus($event)', '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class PpTooltip implements AfterContentInit, OnDestroy {
  readonly text = input.required<string>();
  readonly position = input<'top' | 'bottom' | 'end'>('top');
  readonly kbd = input<string>();
  readonly redundant = input(false);
  /** Shown without hover (docs and walkthroughs). */
  readonly open = input(false);
  /** Just the tooltip, in place (docs). */
  readonly inline = input(false);
  protected readonly id = uid('pp-tip');
  protected readonly shown = signal(false);
  protected readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly hover = typeof matchMedia === 'undefined' || !matchMedia('(hover: none)').matches;

  protected classes() {
    const p = this.position();
    return ['pp-tooltip', p !== 'top' && `pp-tooltip--${p}`, this.inline() && 'pp-tooltip--inline', !this.inline() && !this.open() && 'pp-tooltip--floating'].filter(Boolean).join(' ');
  }
  protected positions(): ConnectedPosition[] {
    const top: ConnectedPosition = { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -6 };
    const bottom: ConnectedPosition = { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 };
    const end: ConnectedPosition = { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 6 };
    return this.position() === 'end' ? [end, top] : this.position() === 'bottom' ? [bottom, top] : [top, bottom];
  }
  protected enter() {
    if (!this.hover || this.open() || this.inline()) return;
    clearTimeout(this.timer);
    const quick = Date.now() - lastTooltipHidden < 300;
    this.timer = setTimeout(() => this.shown.set(true), quick ? 0 : 300);
  }
  protected focus(e: FocusEvent) {
    if (!this.hover || this.open() || this.inline()) return;
    if ((e.target as HTMLElement).matches?.(':focus-visible')) { clearTimeout(this.timer); this.shown.set(true); }
  }
  protected hide() {
    clearTimeout(this.timer);
    if (this.shown()) lastTooltipHidden = Date.now();
    this.shown.set(false);
  }
  ngAfterContentInit() {
    if (this.redundant()) return;
    queueMicrotask(() => {
      const target = this.host.querySelector<HTMLElement>('button, a, [tabindex]');
      if (target) target.setAttribute('aria-describedby', [target.getAttribute('aria-describedby'), this.id].filter(Boolean).join(' '));
    });
  }
  ngOnDestroy() { clearTimeout(this.timer); }
}
