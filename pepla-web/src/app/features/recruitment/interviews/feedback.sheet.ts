import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { PpButton, PpDrawer, PpDrawerFooter, PpField, PpForm, PpPageHeader, PpRadioGroup, PpSectionMessage, PpSelect, PpSlider, PpTextarea } from '../../../ds';
import type { components } from '../../../core/api/openapi';
import { HireApi, newKey } from '../hire-api';
import { typeWords } from './interview-words';

type Item = components['schemas']['InterviewList']['interviews'][number];
const SCALE = ['poor', 'fair', 'good', 'strong', 'excellent'];
function day(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${parseInt(get('day'), 10)} ${get('month').replace('.', '')} ${get('year')}`;
}

/** REC-UI-03 step 2: HR captures feedback for a named panel member. A drawer at 1280, a full page at 390 (the record draws only this). */
@Component({
  selector: 'app-feedback-sheet',
  imports: [NgTemplateOutlet, PpButton, PpDrawer, PpDrawerFooter, PpField, PpForm, PpPageHeader, PpRadioGroup, PpSectionMessage, PpSelect, PpSlider, PpTextarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #fields>
      <pp-field label="Feedback from"><pp-select [options]="people()" placeholder=" " [value]="person()" (valueChange)="person.set($event)" /></pp-field>
      @for (c of criteria(); track c.key) {
        <pp-slider [label]="c.label" [min]="1" [max]="5" [value]="$any(scores()[c.key])" (valueChange)="setScore(c.key, $event)" [words]="words" />
      }
      <pp-field label="Decision" group="radio" options="none">
        <div class="pp-grid pp-grid--2 pp-gap-100">
          @for (d of decisions; track d.value) { <pp-radio-group [tiles]="true" [options]="[d]" [value]="rating()" (valueChange)="rating.set($event)" /> }
        </div>
      </pp-field>
      <pp-field label="Notes" [optional]="true">
        <textarea ppTextarea rows="3" maxlength="2000" [value]="comment()" (input)="comment.set($any($event.target).value)"></textarea>
      </pp-field>
      @if (failure(); as f) { <pp-section-message tone="danger">{{ f }}</pp-section-message> }
    </ng-template>
    @if (item()) {
      @if (phone()) {
        <div class="pp-stack pp-gap-200">
          <pp-page-header [heading]="title()" [description]="line()" />
          <form ppForm class="pp-stack pp-gap-200" (submit)="$event.preventDefault(); send()">
            <ng-container *ngTemplateOutlet="fields" />
            <button ppButton appearance="primary" type="submit" icon="send" [block]="true" [disabled]="!ready() || sending()">Submit feedback</button>
            <button ppButton type="button" [block]="true" (click)="cancel()">Cancel</button>
          </form>
        </div>
      } @else {
        <pp-drawer [open]="true" (openChange)="$event || cancel()" [heading]="title()" [description]="line()">
          <form ppForm (submit)="$event.preventDefault(); send()"><ng-container *ngTemplateOutlet="fields" /></form>
          <pp-drawer-footer>
            <button ppButton type="button" (click)="cancel()">Cancel</button>
            <button ppButton appearance="primary" type="button" icon="send" [disabled]="!ready() || sending()" (click)="send()">Submit feedback</button>
          </pp-drawer-footer>
        </pp-drawer>
      }
    }
  `,
})
export class FeedbackSheet {
  private readonly api = inject(HireApi);
  readonly item = input<Item | null>(null);
  readonly first = input('');
  readonly last = input('');
  readonly roleTitle = input<string | null>(null);
  readonly phone = input(false);
  readonly closed = output<void>();
  readonly saved = output<void>();
  protected readonly words = (v: number) => `${v} out of 5, ${SCALE[v - 1]}`;
  protected readonly decisions = [
    { value: 'STRONG_NO', label: 'Strong no', description: 'Do not hire, and say why' },
    { value: 'NO', label: 'No', description: 'Not this time' },
    { value: 'YES', label: 'Yes', description: 'Hire' },
    { value: 'STRONG_YES', label: 'Strong yes', description: 'Hire, and move fast' },
  ];
  protected readonly person = signal<string | null>(null);
  protected readonly scores = signal<Record<string, number | null>>({});
  protected readonly rating = signal<string | null>(null);
  protected readonly comment = signal('');
  protected readonly sending = signal(false);
  protected readonly failure = signal<string | null>(null);
  /** One key per opening: the record draws a fresh sheet each time, and a retry keeps it. */
  private readonly key = newKey();
  protected readonly title = computed(() => `Interview feedback for ${this.first()} ${this.last()}`);
  protected readonly line = computed(() => { const x = this.item(); return `${this.roleTitle() ? this.roleTitle() + ' · ' : ''}${typeWords(x?.type) ?? ''} interview on ${x?.at ? day(x.at) : ''}`; });
  protected readonly criteria = computed(() => (this.item()?.criteria_snapshot ?? []) as Array<{ key: string; label: string }>);
  protected readonly people = computed(() => (this.item()?.panel ?? []).filter((e) => e.kind === 'PERSON' && e.feedback === 'WAITING' && e.person_id).map((e) => ({ value: e.person_id as string, label: e.name ?? '' })));
  protected readonly ready = computed(() => !!this.person() && !!this.rating() && this.criteria().every((c) => Number.isInteger(this.scores()[c.key])));

  protected setScore(key: string, v: number) { this.scores.update((s) => ({ ...s, [key]: v })); }
  protected cancel() { if (!this.sending()) this.closed.emit(); }

  protected async send() {
    const x = this.item();
    if (!x || !this.ready() || this.sending()) return;
    this.sending.set(true);
    this.failure.set(null);
    const body: Record<string, unknown> = { scores: Object.fromEntries(this.criteria().map((c) => [c.key, this.scores()[c.key]])), rating: this.rating(), on_behalf_of: this.person() };
    if (this.comment()) body['comment'] = this.comment().slice(0, 2000);
    const r = await this.api.call<{ code?: string }>('POST', `/v1/interviews/${encodeURIComponent(x.id ?? '')}/votes`, body, this.key);
    this.sending.set(false);
    if (r?.status === 201) { this.saved.emit(); return; }
    this.failure.set(r?.status === 409 && r.body?.code === 'NOT_STARTED' ? 'You can give feedback once the interview has started.' : 'Your change could not be saved. Try again.');
  }
}
