import { ChangeDetectionStrategy, Component, Injectable, computed, inject, input, output, signal } from '@angular/core';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { PpButton } from '../actions/button';
import { uid } from '../util';

export type MessageTone = 'information' | 'success' | 'warning' | 'danger' | 'agent';
const TONE_ICON: Record<MessageTone, IconName> = { information: 'info', success: 'circle-check', warning: 'triangle-alert', danger: 'octagon-alert', agent: 'sparkles' };

/**
 * Something about this section that people should know or act on.
 * `<pp-section-message tone="warning" heading="…">Body<pp-section-message-actions>…</…></pp-section-message>`
 * At most one Pepla (agent) notice per screen (Calm rule 5). Spec: messages/section-message.md
 */
@Component({
  selector: 'pp-section-message',
  imports: [PpIcon, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [ppIcon]="icon()" />
    <div class="pp-section-message__content">
      @if (heading()) { <h3 class="pp-section-message__title" [attr.id]="tone() !== 'danger' ? id : null">{{ heading() }}</h3> }
      <div class="pp-section-message__body"><ng-content /></div>
      <ng-content select="pp-section-message-actions" />
    </div>
    @if (dismissible()) {
      <button ppButton appearance="subtle" size="small" icon="x" [iconOnly]="true" class="pp-section-message__dismiss" aria-label="Dismiss" (click)="dismiss.emit()"></button>
    }
  `,
  host: {
    '[class]': '"pp-section-message" + (tone() !== "information" ? " pp-section-message--" + tone() : "")',
    '[attr.role]': 'tone() === "danger" ? "alert" : "region"',
    '[attr.aria-labelledby]': 'heading() && tone() !== "danger" ? id : null',
  },
})
export class PpSectionMessage {
  readonly tone = input<MessageTone>('information');
  readonly heading = input<string>();
  readonly dismissible = input(false);
  readonly dismiss = output<void>();
  protected readonly id = uid('pp-sm');
  protected readonly icon = computed(() => TONE_ICON[this.tone()]);
}

@Component({ selector: 'pp-section-message-actions', template: '<ng-content />', host: { class: 'pp-section-message__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpSectionMessageActions {}

/** One line under a field or beside an action. Spec: messages/inline-message.md */
@Component({
  selector: 'pp-inline-message',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg [ppIcon]="icon()" /><span><ng-content /></span>`,
  host: { '[class]': 'classes()' },
})
export class PpInlineMessage {
  readonly tone = input<'information' | 'error' | 'warning' | 'success' | 'agent'>('information');
  readonly inline = input(false);
  /** A different icon from the tone's set, such as clock for "Due in 2 days". */
  readonly with = input<IconName>(undefined, { alias: 'icon' });
  protected readonly icon = computed<IconName>(() => this.with() ?? (this.tone() === 'error' ? 'octagon-alert' : TONE_ICON[this.tone() as MessageTone]));
  protected readonly classes = computed(() => ['pp-inline-message', this.tone() !== 'information' && `pp-inline-message--${this.tone()}`, this.inline() && 'pp-inline-message--inline'].filter(Boolean).join(' '));
}

/** Across the top of the app, for something that affects everyone. Spec: messages/banner.md */
@Component({
  selector: 'pp-banner',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [ppIcon]="tone() === 'announcement' ? 'info' : tone() === 'error' ? 'octagon-alert' : 'triangle-alert'" /><p class="pp-banner__text"><ng-content /></p>
    @if (dismissible()) { <button class="pp-banner__dismiss" type="button" aria-label="Dismiss announcement" (click)="dismiss.emit()"><svg ppIcon="x" /></button> }
  `,
  host: {
    '[class]': '"pp-banner" + (tone() !== "warning" ? " pp-banner--" + tone() : "")',
    '[attr.role]': 'tone() === "announcement" ? "region" : "alert"',
    '[attr.aria-label]': 'tone() === "announcement" ? "Announcement" : null',
  },
})
export class PpBanner {
  readonly tone = input<'warning' | 'error' | 'announcement'>('warning');
  /** Only an announcement can be dismissed. Warnings and errors stay until fixed. */
  readonly dismissible = input(false);
  readonly dismiss = output<void>();
}

/** Nothing here yet, or all done. Says why it is empty and what to do. Spec: messages/empty-state.md */
@Component({
  selector: 'pp-empty-state',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (icon()) { <div class="pp-empty-state__icon"><svg [ppIcon]="icon()!" /></div> }
    @if (level() === 2) { <h2 class="pp-empty-state__title">{{ heading() }}</h2> } @else { <h3 class="pp-empty-state__title">{{ heading() }}</h3> }
    @if (body()) { <p class="pp-empty-state__body">{{ body() }}</p> }
    <ng-content />
  `,
  host: { '[class]': '"pp-empty-state" + (done() ? " pp-empty-state--done" : "") + (compact() ? " pp-empty-state--compact" : "")', '[attr.role]': 'done() ? "status" : null' },
})
export class PpEmptyState {
  /** Leave it out in a small panel (no notifications), where the words are enough. */
  readonly icon = input<IconName>();
  readonly heading = input.required<string>();
  readonly body = input<string>();
  readonly done = input(false);
  readonly compact = input(false);
  /** Heading level: 2 when the empty state is the whole page ("Nothing needs you today"). */
  readonly level = input<2 | 3>(3);
}

/** The empty state's one action: `<pp-empty-state-actions><button ppButton …/></pp-empty-state-actions>` */
@Component({ selector: 'pp-empty-state-actions', template: '<ng-content />', host: { class: 'pp-empty-state__actions' }, changeDetection: ChangeDetectionStrategy.OnPush })
export class PpEmptyStateActions {}

/** What Pepla did meanwhile, under a "done" empty state: `<p ppEmptyStateNote>Pepla handled 12 tasks…</p>` */
@Component({
  selector: 'p[ppEmptyStateNote]', imports: [PpIcon], changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<svg ppIcon="sparkles" /><span><ng-content /></span>',
  host: { class: 'pp-empty-state__note' },
})
export class PpEmptyStateNote {}

// ------------------------------------------------------------------ flags (toasts)
export interface Flag {
  id?: number;
  tone?: 'success' | 'warning' | 'error' | 'agent' | 'information';
  title: string;
  body?: string;
  /** One action: a button (`run`) or a link (`href`). */
  action?: { label: string; run?: () => void; href?: string };
}

const LIFE = 8000;

/**
 * Shows flags in the corner. Inject it anywhere: `inject(PpFlags).show({ tone: 'success', title: 'Leave approved' })`.
 * Only success flags dismiss themselves, after 8 seconds; hover or focus pauses the count. Every other flag stays.
 * Spec: messages/flag.md
 */
@Injectable({ providedIn: 'root' })
export class PpFlags {
  readonly flags = signal<(Flag & { id: number })[]>([]);
  private n = 0;
  private timers = new Map<number, { left: number; started: number; handle?: ReturnType<typeof setTimeout> }>();
  show(flag: Flag) {
    const f = { ...flag, id: ++this.n };
    this.flags.update((all) => [...all, f]);
    if (f.tone === 'success') { this.timers.set(f.id, { left: LIFE, started: 0 }); this.resume(f.id); }
    return f.id;
  }
  dismiss(id: number) {
    clearTimeout(this.timers.get(id)?.handle); this.timers.delete(id);
    this.flags.update((all) => all.filter((f) => f.id !== id));
  }
  /** Hover or focus inside a counting flag. */
  pause(id: number) {
    const t = this.timers.get(id); if (!t?.handle) return;
    clearTimeout(t.handle); t.handle = undefined; t.left -= Date.now() - t.started;
  }
  resume(id: number) {
    const t = this.timers.get(id); if (!t || t.handle) return;
    t.started = Date.now(); t.handle = setTimeout(() => this.dismiss(id), Math.max(t.left, 0));
  }
}

const FLAG_ICON: Record<NonNullable<Flag['tone']>, IconName> = { success: 'circle-check', warning: 'triangle-alert', error: 'octagon-alert', agent: 'sparkles', information: 'info' };

/**
 * Where flags appear. The app shell includes it once. `[items]` shows a fixed list instead of the service's
 * flags (gallery and docs only).
 */
@Component({
  selector: 'pp-flag-group',
  imports: [PpIcon, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (f of shown(); track f.id) {
      <div class="pp-flag" [class]="f.tone && f.tone !== 'information' ? 'pp-flag--' + f.tone : ''" [attr.role]="f.tone === 'error' ? 'alert' : 'status'"
          (mouseenter)="service.pause(f.id!)" (mouseleave)="service.resume(f.id!)" (focusin)="service.pause(f.id!)" (focusout)="service.resume(f.id!)">
        <svg [ppIcon]="icon(f)" />
        <div class="pp-flag__content">
          <p class="pp-flag__title">{{ f.title }}</p>
          @if (f.body) { <p class="pp-flag__body">{{ f.body }}</p> }
          @if (f.action; as a) {
            <div class="pp-flag__actions">
              @if (a.href) { <a ppButton appearance="link" size="small" [href]="a.href">{{ a.label }}</a> }
              @else { <button ppButton appearance="link" size="small" type="button" (click)="a.run?.(); service.dismiss(f.id!)">{{ a.label }}</button> }
            </div>
          }
          @if (f.tone === 'success') { <span class="pp-flag__timer" aria-hidden="true"></span> }
        </div>
        <button ppButton appearance="subtle" size="small" icon="x" [iconOnly]="true" type="button" class="pp-flag__dismiss" aria-label="Dismiss" (click)="service.dismiss(f.id!)"></button>
      </div>
    }
  `,
  // Not a list: each flag is its own status or alert, which a list item cannot be.
  host: { class: 'pp-flag-group', '[class.pp-flag-group--inline]': 'inline()' },
})
export class PpFlagGroup {
  readonly inline = input(false);
  readonly items = input<Flag[]>();
  protected readonly service = inject(PpFlags);
  protected readonly shown = computed(() => this.items()?.map((f, i) => ({ ...f, id: f.id ?? -1 - i })) ?? this.service.flags());
  protected icon = (f: Flag) => FLAG_ICON[f.tone ?? 'information'];
}
