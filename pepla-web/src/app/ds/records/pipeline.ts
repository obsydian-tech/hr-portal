import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { PpIcon } from '../core/icon';
import { IconName } from '../core/icon.registry';
import { AvatarColour, PpPerson } from '../core/avatar';
import { PpLozenge, Status } from '../status/lozenge';
import { PpBadge } from '../status/status';
import { PpDeadline } from './records';
import { PpDropdownMenu, PpMenuItem, PpMenuSection, PpModalDialog, PpModalFooter } from '../overlays/overlays';
import { PpButton } from '../actions/button';
import { PpField, PpTextarea } from '../forms/field';
import { PpSelect } from '../forms/controls';
import { uid } from '../util';

export interface PipelineCard {
  id: string;
  name: string;
  link?: string;
  colour?: AvatarColour;
  /** One fact: "Applied 4 Nov". */
  meta: string;
  /** At most one lozenge: the most urgent thing. */
  lozenge?: { status: Status; icon: IconName; text: string };
  /** Or a deadline: `{ due: '2026-11-10', subject: 'Scorecard' }`. */
  deadline?: { due: Date | string; subject?: string };
}

export interface PipelineStage {
  id: string;
  name: string;
  cards: PipelineCard[];
  /** "1 interview feedback overdue" (danger), or "1 waiting over 5 days" (warning). */
  alert?: { text: string; tone: 'danger' | 'warning' };
}

export interface PipelineMove { card: PipelineCard; from: string; to: string; index: number; }
export interface PipelineMoveRequest extends PipelineMove { reason: string; }

/**
 * A board of hiring stages for one role. Drag a card, or use its Move button (the keyboard and phone way).
 * On a phone it is a stage picker and one list. The board updates `stages` and emits `moved` to save (with Undo).
 * `<pp-pipeline-board label="Hiring stages for Sales rep" [(stages)]="stages" (moved)="save($event)" />`
 * Spec: records/pipeline-board.md
 */
@Component({
  selector: 'pp-pipeline-board',
  imports: [PpIcon, PpPerson, PpLozenge, PpBadge, PpDeadline, PpDropdownMenu, PpMenuItem, PpMenuSection, PpField, PpSelect, PpTextarea, PpModalDialog, PpModalFooter, PpButton, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-pipeline__picker">
      <pp-field label="Stage"><pp-select [options]="pickerOptions()" [value]="currentId()" (valueChange)="current.set($event)" /></pp-field>
    </div>
    <ol class="pp-pipeline__board" [attr.aria-label]="label()" cdkDropListGroup>
      @for (s of stages(); track s.id) {
        <li [class]="'pp-pipeline__column' + (s.id === currentId() ? ' pp-pipeline__column--current' : '') + (s.id === over() ? ' pp-pipeline__column--drop-target' : '')" [attr.aria-labelledby]="id + '-' + s.id">
          <div class="pp-pipeline__column-header">
            <span class="pp-pipeline__column-name" role="heading" aria-level="3" [id]="id + '-' + s.id">{{ s.name }}</span>
            <pp-badge [count]="s.cards.length" [label]="s.cards.length === 1 ? 'candidate' : 'candidates'" />
            @if (s.alert; as a) { <span class="pp-pipeline__column-alert" [class.pp-pipeline__column-alert--warning]="a.tone === 'warning'"><svg [ppIcon]="a.tone === 'warning' ? 'clock' : 'clock-alert'" />{{ a.text }}</span> }
          </div>
          <ul class="pp-pipeline__cards" cdkDropList [cdkDropListData]="s.id" (cdkDropListDropped)="dropped($event)"
              (cdkDropListEntered)="over.set(s.id)" (cdkDropListExited)="over.set(null)">
            @for (c of s.cards; track c.id) {
              <li class="pp-pipeline__card" cdkDrag [cdkDragData]="c" cdkDragPreviewClass="pp-pipeline__card--dragging">
                <span class="pp-pipeline__handle" aria-hidden="true"><svg ppIcon="grip-vertical" /></span>
                <div class="pp-pipeline__card-body">
                  <pp-person [name]="c.name" [meta]="c.meta" [link]="c.link" [colour]="c.colour" size="small" />
                  @if (c.lozenge; as l) { <pp-lozenge [status]="l.status" [icon]="l.icon">{{ l.text }}</pp-lozenge> }
                  @else if (c.deadline; as d) { <time ppDeadline [due]="d.due" [subject]="d.subject" [now]="now()"></time> }
                </div>
                @if (confirmMoves()) {
                  <button type="button" class="pp-button pp-button--subtle pp-button--icon pp-button--small" [attr.data-card]="c.id"
                          [attr.aria-label]="'Move ' + first(c.name)" aria-haspopup="dialog" (click)="ask(c, s.id, s.id)"><svg ppIcon="arrow-right-left" /></button>
                } @else {
                <button #mv type="button" class="pp-button pp-button--subtle pp-button--icon pp-button--small" [attr.data-card]="c.id"
                        [attr.aria-label]="'Move ' + c.name + ' to another stage'" aria-haspopup="menu" [attr.aria-expanded]="menuFor() === c.id ? 'true' : null"
                        (click)="menuFor.set(menuFor() === c.id ? null : c.id)"><svg ppIcon="arrow-right-left" /></button>
                @if (menuFor() === c.id) {
                  <pp-dropdown-menu [trigger]="false" [open]="true" (openChange)="$event || menuFor.set(null)" [origin]="mv" [returnTo]="mv" [label]="'Move ' + c.name">
                    <pp-menu-section>
                      @for (t of stages(); track t.id) { @if (t.id !== s.id) { <button ppMenuItem icon="arrow-right" (click)="moveTo(c, s.id, t.id)">Move to {{ t.name }}</button> } }
                    </pp-menu-section>
                  </pp-dropdown-menu>
                }
                }
                <ng-template cdkDragPlaceholder><li class="pp-pipeline__placeholder" aria-hidden="true"></li></ng-template>
              </li>
            } @empty {
              <li class="pp-pipeline__empty">No one yet</li>
            }
          </ul>
        </li>
      }
    </ol>
    <div class="pp-visually-hidden" aria-live="polite">{{ said() }}</div>
    <pp-modal-dialog [open]="!!asking()" [closable]="true" [heading]="'Move ' + first(asking()?.card?.name ?? '')" (closed)="cancel()">
      <div class="pp-stack pp-gap-150">
        <pp-field label="Move to"><pp-select [options]="stageOptions()" [value]="asking()?.to ?? null" (valueChange)="setTo($event)" /></pp-field>
        <pp-field label="Why? (required)" help="Saved with your name and the time.">
          <textarea ppTextarea rows="3" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea>
          @if (back()) { <p class="pp-text--small">Moving back a stage needs a reason too.</p> }
        </pp-field>
      </div>
      <pp-modal-footer>
        <button ppButton type="button" (click)="cancel()">Cancel</button>
        <button ppButton appearance="primary" type="button" [disabled]="!canMove()" (click)="confirm()">Move</button>
      </pp-modal-footer>
    </pp-modal-dialog>
  `,
  host: { class: 'pp-pipeline' },
})
export class PpPipelineBoard {
  readonly label = input.required<string>();
  readonly stages = model.required<PipelineStage[]>();
  /** The stage shown on a phone. Defaults to the first. */
  readonly current = model<string | null>(null);
  readonly now = input<Date>();
  readonly moved = output<PipelineMove>();
  /** Ask first: a drop or the Move button opens the Move dialog; the screen moves the card after `moveRequested`. */
  readonly confirmMoves = input(false);
  readonly moveRequested = output<PipelineMoveRequest>();
  protected readonly asking = signal<{ card: PipelineCard; from: string; to: string } | null>(null);
  protected readonly reason = signal('');
  private pending: { id: string; from: string } | null = null;
  protected readonly stageOptions = computed(() => this.stages().map((s) => ({ value: s.id, label: s.name })));
  protected readonly back = computed(() => {
    const a = this.asking(); if (!a) return false;
    const ids = this.stages().map((s) => s.id);
    return ids.indexOf(a.to) < ids.indexOf(a.from);
  });
  protected readonly canMove = computed(() => { const a = this.asking(); return !!a && a.to !== a.from && this.reason().trim() !== ''; });
  protected first(name: string) { return name.split(' ')[0]; }
  constructor() {
    effect(() => {
      const all = this.stages();
      untracked(() => {
        const p = this.pending;
        if (!p) return;
        const now = all.find((s) => s.cards.some((c) => c.id === p.id));
        if (now && now.id !== p.from) { this.pending = null; this.focusCard(p.id); }
      });
    });
  }
  protected ask(card: PipelineCard, from: string, to: string) { this.reason.set(''); this.asking.set({ card, from, to }); }
  protected setTo(to: string | null) { const a = this.asking(); if (a && to) this.asking.set({ ...a, to }); }
  protected cancel() {
    const a = this.asking(); if (!a) return;
    this.asking.set(null);
    this.focusCard(a.card.id);
  }
  protected confirm() {
    const a = this.asking(); if (!a || !this.canMove()) return;
    const index = this.stages().find((s) => s.id === a.to)!.cards.length;
    this.asking.set(null);
    this.pending = { id: a.card.id, from: a.from };
    this.moveRequested.emit({ card: a.card, from: a.from, to: a.to, index, reason: this.reason().trim() });
    this.focusCard(a.card.id);
  }
  private focusCard(id: string) { setTimeout(() => this.host.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus()); }
  protected readonly id = uid('pp-pipeline');
  protected readonly over = signal<string | null>(null);
  protected readonly menuFor = signal<string | null>(null);
  protected readonly said = signal('');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly currentId = computed(() => this.current() ?? this.stages()[0]?.id ?? null);
  protected readonly pickerOptions = computed(() => this.stages().map((s) => ({ value: s.id, label: `${s.name} (${s.cards.length})` })));

  protected dropped(e: CdkDragDrop<string, string, PipelineCard>) {
    this.over.set(null);
    if (this.confirmMoves()) {
      if (e.previousContainer.data !== e.container.data) this.ask(e.item.data, e.previousContainer.data, e.container.data);
      return;
    }
    this.move(e.item.data, e.previousContainer.data, e.container.data, e.currentIndex);
  }
  protected moveTo(card: PipelineCard, from: string, to: string) {
    this.menuFor.set(null);
    this.move(card, from, to, this.stages().find((s) => s.id === to)!.cards.length);
    // Focus follows the card to its new column.
    setTimeout(() => this.host.querySelector<HTMLElement>(`[data-card="${card.id}"]`)?.focus());
  }
  private move(card: PipelineCard, from: string, to: string, index: number) {
    if (from === to && this.stages().find((s) => s.id === from)!.cards.indexOf(card) === index) return;
    this.stages.update((all) => all.map((s) => {
      let cards = s.cards.filter((c) => c.id !== card.id);
      if (s.id === to) cards = [...cards.slice(0, index), card, ...cards.slice(index)];
      return { ...s, cards };
    }));
    const name = this.stages().find((s) => s.id === to)!.name;
    this.said.set(`${card.name} moved to ${name}`);
    this.moved.emit({ card, from, to, index });
  }
}
