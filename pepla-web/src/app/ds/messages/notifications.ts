import { ChangeDetectionStrategy, Component, computed, contentChildren, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { AvatarColour, PpAvatar } from '../core/avatar';
import { PpButton } from '../actions/button';
import { PpEmptyState } from './messages';
import { uid } from '../util';

/**
 * One notification: who or what, the sentence (projected, with the name in <strong>), when, and one action.
 * `<li ppNotification actor="Pepla" [unread]="true" at="2026-11-11T09:40" when="20 min ago" [action]="{ text: 'Approve result', link: '/…' }">
 *    <strong>Pepla</strong> checked Kagiso Molefe's ID. It passed.</li>`
 * Without an actor, an icon says what kind it is (`icon="clock-alert" tone="danger"`). Spec: records/notification-item.md
 */
@Component({
  selector: 'li[ppNotification]',
  imports: [PpIcon, PpAvatar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (actor()) { <pp-avatar [name]="actor()!" [kind]="actor() === 'Pepla' ? 'agent' : 'person'" [colour]="colour()" [decorative]="true" /> }
    @else { <span class="pp-notification__icon" [class]="tone() !== 'neutral' ? 'pp-notification__icon--' + tone() : ''" aria-hidden="true"><svg [ppIcon]="icon()" /></span> }
    <div class="pp-notification__body">
      <span class="pp-notification__text">@if (unread()) {<span class="pp-visually-hidden">Unread. </span>}<ng-content /></span>
      <span class="pp-notification__meta"><time [attr.datetime]="at()" [attr.title]="exact() ?? null">{{ when() }}</time>@if (action(); as a) {<a class="pp-notification__action" [routerLink]="a.link">{{ a.text }}</a>}</span>
    </div>
    <span class="pp-notification__dot" aria-hidden="true"></span>
  `,
  host: { class: 'pp-notification', '[class.pp-notification--unread]': 'unread()' },
})
export class PpNotification {
  /** A person's name, or "Pepla": their avatar. */
  readonly actor = input<string>();
  readonly colour = input<AvatarColour>();
  /** Without an actor: what kind of news it is. */
  readonly icon = input<IconName>('info');
  readonly tone = input<'neutral' | 'danger' | 'success' | 'warning'>('neutral');
  readonly unread = input(false);
  /** ISO time, and the words ("20 min ago"); `exact` is the full time for the tooltip. */
  readonly at = input.required<string>();
  readonly when = input.required<string>();
  readonly exact = input<string>();
  readonly action = input<{ text: string; link: string }>();
}

/**
 * The bell's panel: a heading, "Mark all as read" while some are unread, the list, and a link to all.
 * `<pp-notifications-panel [unread]="3" allLink="/notifications" (markAllRead)="read()"><li ppNotification …>…</pp-notifications-panel>`
 * With no notifications it says so. Spec: records/notification-item.md
 */
@Component({
  selector: 'pp-notifications-panel',
  imports: [PpButton, PpEmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-notifications-panel__header">
      <span class="pp-notifications-panel__title" role="heading" aria-level="2" [id]="id">{{ heading() }}</span>
      @if (unread()) { <button ppButton appearance="link" size="small" (click)="markAllRead.emit()">Mark all as read</button> }
    </div>
    @if (items().length) { <ul class="pp-notifications"><ng-content /></ul> }
    @else { <pp-empty-state [compact]="true" heading="You are all caught up" body="New notifications show up here." /> }
    @if (allLink() && items().length) { <div class="pp-notifications-panel__footer"><a ppButton appearance="link" size="small" [routerLink]="allLink()">See all notifications</a></div> }
  `,
  host: { class: 'pp-notifications-panel', role: 'region', '[attr.aria-labelledby]': 'id' },
})
export class PpNotificationsPanel {
  readonly heading = input('Notifications');
  /** How many are unread: "Mark all as read" shows while there are any. */
  readonly unread = input(0);
  readonly allLink = input<string>();
  readonly markAllRead = output<void>();
  protected readonly items = contentChildren(PpNotification);
  protected readonly id = uid('pp-notifications');
}
