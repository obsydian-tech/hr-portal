import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpIcon } from './icon';

export type AvatarSize = 'xsmall' | 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge';
export type AvatarColour = 'blue' | 'green' | 'amber' | 'magenta' | 'violet' | 'sky';
const COLOURS: AvatarColour[] = ['blue', 'green', 'amber', 'magenta', 'violet', 'sky'];

/** Initials from a name: "Thandeka Dlamini" -> "TD". */
export const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
/** The same person always gets the same colour. */
export const colourFor = (name: string): AvatarColour => COLOURS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLOURS.length];

/**
 * A person, team or Pepla itself. `<pp-avatar name="Thandeka Dlamini" size="large" />`.
 * kind="agent" is Pepla (mint, sparkles); kind="team" is a square with the people icon.
 * Spec: project/components/core/avatar.md
 */
@Component({
  selector: 'pp-avatar',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (kind() === 'agent') { <svg ppIcon="sparkles" /> }
    @else if (kind() === 'team') { <svg ppIcon="users" /> }
    @else { {{ letters() }} }
    @if (online()) { <span class="pp-avatar__presence"></span> }
  `,
  host: {
    '[class]': 'classes()',
    '[attr.role]': 'decorative() ? null : "img"',
    '[attr.aria-label]': 'decorative() ? null : label()',
    '[attr.aria-hidden]': 'decorative() ? "true" : null',
  },
})
export class PpAvatar {
  readonly name = input.required<string>();
  readonly size = input<AvatarSize>('medium');
  readonly kind = input<'person' | 'agent' | 'team'>('person');
  readonly colour = input<AvatarColour>();
  readonly online = input(false);
  /** True when a visible name sits beside the avatar, so it is not read twice. */
  readonly decorative = input(false);

  protected readonly letters = computed(() => initials(this.name()));
  protected readonly label = computed(() => this.name() + (this.online() ? ', online' : ''));
  protected readonly classes = computed(() => {
    const k = this.kind();
    const tone = k === 'agent' ? 'agent' : k === 'team' ? 'square' : this.colour() ?? colourFor(this.name());
    return ['pp-avatar', this.size() !== 'medium' && `pp-avatar--${this.size()}`, `pp-avatar--${tone}`].filter(Boolean).join(' ');
  });
}

/**
 * A row of overlapping avatars with "+N". `<pp-avatar-group [names]="panel" label="Interview panel" />`
 */
@Component({
  selector: 'pp-avatar-group',
  imports: [PpAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of shown(); track p.name) { <pp-avatar [name]="p.name" [colour]="p.colour" [size]="size()" [decorative]="true" /> }
    @if (more() > 0) { <span class="pp-avatar pp-avatar-group__more" [class]="size() !== 'medium' ? 'pp-avatar--' + size() : ''" aria-hidden="true">+{{ more() }}</span> }
  `,
  host: { class: 'pp-avatar-group', role: 'group', '[attr.aria-label]': 'summary()' },
})
export class PpAvatarGroup {
  /** Names, or people with a colour from their ID: `{ name, colour }`. */
  readonly names = input.required<(string | { name: string; colour?: AvatarColour })[]>();
  readonly label = input.required<string>();
  readonly max = input(3);
  readonly size = input<AvatarSize>('small');
  /** The whole sentence read out, when the list needs more than names: "Scored by …. Waiting for Kagiso Molefe." */
  readonly spoken = input<string>();
  protected readonly people = computed(() => this.names().map((n) => (typeof n === 'string' ? { name: n, colour: undefined } : n)));
  protected readonly shown = computed(() => this.people().slice(0, this.max()));
  protected readonly more = computed(() => Math.max(0, this.names().length - this.max()));
  /** "Interview panel: Sipho Ndlovu, Lerato Mokoena, Kagiso Molefe and 2 more" */
  protected readonly summary = computed(() => {
    if (this.spoken()) return this.spoken();
    const parts = this.shown().map((p) => p.name);
    if (this.more()) parts.push(`${this.more()} more`);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join('');
    return `${this.label()}: ${list}`;
  });
}

/**
 * Avatar, name and one line of meta. `<pp-person name="Thandeka Dlamini" meta="Bookkeeper · Starts 17 Nov" />`
 */
@Component({
  selector: 'pp-person',
  imports: [PpAvatar, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-avatar [name]="name()" [size]="size()" [kind]="kind()" [colour]="colour()" [decorative]="true" />
    <span class="pp-person__text">
      @if (link()) { <a class="pp-person__name" [routerLink]="link()">{{ name() }}</a> } @else { <span class="pp-person__name">{{ name() }}</span> }
      @if (meta()) { <span class="pp-person__meta">{{ meta() }}</span> }
    </span>
  `,
  host: { class: 'pp-person' },
})
export class PpPerson {
  readonly name = input.required<string>();
  readonly meta = input<string>();
  readonly size = input<AvatarSize>('large');
  readonly kind = input<'person' | 'agent' | 'team'>('person');
  readonly colour = input<AvatarColour>();
  /** Their record: the name becomes the link (a table's first column). */
  readonly link = input<string>();
}
