import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { PpButton, PpField, PpModalDialog, PpModalFooter, PpRadioGroup, PpSectionMessage, PpTextField } from '../../../ds';
import { HireApi, newKey, type InterviewListAnswer } from '../hire-api';
import { INTERVIEW_WORDS, typeWords } from './interview-words';

type Item = InterviewListAnswer['interviews'][number];
export type CloseAction = 'cancel' | 'did_not_happen' | 'complete';
const W = INTERVIEW_WORDS.close as Record<string, string>;
const DW = INTERVIEW_WORDS.drawer as Record<string, string>;
const STATUS: Record<CloseAction, string> = { cancel: 'CANCELLED', did_not_happen: 'DID_NOT_HAPPEN', complete: 'COMPLETED' };
const REASON_CODES: Record<CloseAction, string[]> = {
  cancel: ['CANDIDATE_ASKED', 'PANEL_NOT_AVAILABLE', 'CANDIDATE_WITHDREW', 'OTHER'],
  did_not_happen: ['CANDIDATE_DID_NOT_COME', 'INTERVIEWER_DID_NOT_COME', 'OTHER'],
  complete: ['FEEDBACK_GIVEN_ANOTHER_WAY', 'PANEL_MEMBER_CANNOT_GIVE_FEEDBACK', 'OTHER'],
};
const fill = (s: string, type: string) => s.replace('{type}', type);

/** INT-UI-03: cancel, did not happen, mark as done. The choice, the text and the request key live here only. */
@Component({
  selector: 'app-close-interview-dialog',
  imports: [PpButton, PpField, PpModalDialog, PpModalFooter, PpRadioGroup, PpSectionMessage, PpTextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-modal-dialog [open]="!!target()" [closable]="true" [heading]="title()" (closed)="dismiss()">
      <div class="pp-stack pp-gap-150">
        @if (problem(); as p) { <pp-section-message tone="danger" [heading]="p" /> }
        @for (l of lines(); track $index) { <p class="pp-text">{{ l }}</p> }
        <pp-field [label]="w['reason']" group="radio">
          <pp-radio-group [options]="options()" [value]="reason()" (valueChange)="reason.set($event)" />
        </pp-field>
        @if (reason() === 'OTHER') {
          <pp-field [label]="w['describe']"><input ppTextField type="text" maxlength="500" [value]="note()" (input)="note.set($any($event.target).value)" /></pp-field>
        }
      </div>
      <pp-modal-footer>
        <button ppButton type="button" (click)="dismiss()">{{ secondary() }}</button>
        <button ppButton appearance="primary" type="button" [disabled]="!canSave()" (click)="save()">{{ primary() }}</button>
      </pp-modal-footer>
    </pp-modal-dialog>`,
})
export class CloseInterviewDialog {
  readonly candidateId = input.required<string>();
  readonly reread = input.required<() => Promise<Item[] | null>>();
  readonly saved = output<string>();
  private readonly api = inject(HireApi);
  protected readonly w = W;
  protected readonly target = signal<{ action: CloseAction; item: Item } | null>(null);
  protected readonly reason = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly problem = signal<string | null>(null);
  private readonly sending = signal(false);
  private readonly blocked = signal(false);
  private key = '';
  private keyBody: string | null = null;
  private run = 0;
  private gone = false;
  private lastTitle = '';

  constructor() { inject(DestroyRef).onDestroy(() => { this.gone = true; this.run++; }); }

  open(action: CloseAction, item: Item) {
    this.run++;
    this.reason.set(null); this.note.set(''); this.problem.set(null); this.sending.set(false); this.blocked.set(false);
    this.key = newKey(); this.keyBody = null;
    this.target.set({ action, item });
  }
  private type = computed(() => (typeWords(this.target()?.item.type) ?? '').toLowerCase());
  protected readonly title = computed(() => {
    const t = this.target();
    if (!t) return this.lastTitle;
    const k = t.action === 'cancel' ? 'cancelTitle' : t.action === 'did_not_happen' ? 'dnhTitle' : 'doneTitle';
    return (this.lastTitle = fill(W[k]!, this.type()));
  });
  protected readonly lines = computed(() => {
    const t = this.target();
    if (!t) return [];
    const g = t.item.panel.find((e) => e.kind === 'GUEST');
    if (t.action === 'cancel') return g ? [W['cancelGuest']!] : [];
    if (t.action === 'did_not_happen') return [fill(W['dnhLine']!, this.type())];
    return [g && g.feedback === 'WAITING' ? W['doneGuest']! : W['doneNoGuest']!];
  });
  protected readonly options = computed(() => {
    const t = this.target();
    if (!t) return [];
    const words = INTERVIEW_WORDS.reasons[STATUS[t.action]]!;
    return REASON_CODES[t.action].map((value) => ({ value, label: words[value]! }));
  });
  protected readonly secondary = computed(() => (this.target()?.action === 'cancel' ? W['keep']! : W['cancel']!));
  protected readonly primary = computed(() => {
    const a = this.target()?.action;
    return a === 'cancel' ? INTERVIEW_WORDS.controls['cancel']! : a === 'did_not_happen' ? W['save']! : INTERVIEW_WORDS.controls['markDone']!;
  });
  protected readonly canSave = computed(() => {
    const r = this.reason();
    if (!r || this.sending() || this.blocked()) return false;
    if (r !== 'OTHER') return true;
    const n = this.note().trim();
    return n.length >= 1 && n.length <= 500;
  });

  protected dismiss() {
    if (!this.target()) return;
    this.run++;
    this.target.set(null);
  }

  protected async save() {
    const t = this.target();
    if (!t || !this.canSave()) return;
    const body: Record<string, string> = { action: t.action, reason: this.reason()! };
    if (body['reason'] === 'OTHER') body['reason_note'] = this.note().trim();
    const text = JSON.stringify(body);
    if (this.keyBody !== null && this.keyBody !== text) this.key = newKey();
    this.keyBody = text;
    this.sending.set(true);
    this.problem.set(null);
    const run = this.run;
    const r = await this.api.call('PATCH', `/v1/candidates/${encodeURIComponent(this.candidateId())}/interviews/${encodeURIComponent(t.item.id ?? '')}`, body, this.key);
    if (this.gone) return;
    if (run !== this.run) { void this.reread()(); return; }
    const id = t.item.id ?? '';
    if (r?.status === 200) { await this.reread()(); if (run === this.run && !this.gone) this.done(id); return; }
    const code = (r?.body as { code?: string } | null)?.code;
    if (r === null || (r.status === 409 && (code === 'NOT_CANCELLABLE' || code === 'NOT_ALLOWED_NOW'))) {
      const rows = await this.reread()();
      if (this.gone || run !== this.run) return;
      const now = rows?.find((x) => x.id === id);
      if (now && now.status === STATUS[t.action]) { this.done(id); return; }
      if (r !== null) {
        this.blocked.set(true);
        this.problem.set(t.action === 'did_not_happen' && now?.panel.some((e) => e.feedback === 'GIVEN') ? DW['hasFeedback']! : W['changed']!);
        this.sending.set(false);
        return;
      }
    }
    this.problem.set(DW['saveFail']!);
    this.sending.set(false);
  }

  private done(id: string) {
    this.run++;
    this.target.set(null);
    this.saved.emit(id);
  }
}
