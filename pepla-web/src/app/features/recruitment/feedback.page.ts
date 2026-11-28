import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PpButton, PpField, PpForm, PpRadioGroup, PpSectionMessage, PpSignInPage, PpSkeleton, PpSlider, PpTextarea } from '../../ds';
import { AuthService } from '../../core/auth/auth.service';
import { landingFor } from '../../core/nav';
import { rolesOf } from '../../core/roles';
import { HireApi, newKey } from './hire-api';
import { feedbackLine, typeWords } from './interviews/interview-words';

// REC-UI-03 step 4 (NH-292): the panel member's own feedback page /hire/feedback/:interviewId, in the guest page's frame.
type Answer = {
  id: string; candidate_first: string; candidate_last: string; role_title: string | null; type: string; at: string; status: string;
  criteria: Array<{ key: string; label: string }>; my_feedback: string; my_vote: { rating: string | null; overall: number | null } | null;
  can: { capture_feedback: boolean }; why?: string;
};
const SCALE = ['poor', 'fair', 'good', 'strong', 'excellent'];
function day(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${parseInt(get('day'), 10)} ${get('month').replace('.', '')} ${get('year')}`;
}

@Component({
  selector: 'app-feedback-page',
  imports: [PpSignInPage, PpSkeleton, PpSlider, PpField, PpRadioGroup, PpTextarea, PpButton, PpForm, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('loading') { <pp-sign-in-page heading=" "><pp-skeleton shape="field" /><pp-skeleton shape="field" /><pp-skeleton shape="button" /></pp-sign-in-page> }
      @case ('form') {
        <pp-sign-in-page [heading]="title()" [company]="line()">
          <form ppForm class="pp-stack pp-gap-200" (submit)="$event.preventDefault(); send()">
            @for (c of answer()!.criteria; track c.key) {
              <pp-slider [label]="c.label" [min]="1" [max]="5" [value]="$any(scores()[c.key])" (valueChange)="setScore(c.key, $event)" [words]="words" />
            }
            <pp-field label="Decision" group="radio" options="none">
              <div class="pp-grid pp-grid--2 pp-gap-100">
                @for (d of decisions; track d.value) {
                  <pp-radio-group [tiles]="true" [options]="[d]" [value]="rating()" (valueChange)="rating.set($event)" />
                }
              </div>
            </pp-field>
            <pp-field label="Notes" [optional]="true">
              <textarea ppTextarea rows="3" maxlength="2000" [value]="comment()" (input)="comment.set($any($event.target).value)"></textarea>
            </pp-field>
            @if (failure(); as f) { <pp-section-message tone="danger">{{ f }}</pp-section-message> }
            <button ppButton appearance="primary" type="submit" icon="send" [disabled]="!ready() || sending()">Submit feedback</button>
            <button ppButton type="button" (click)="cancel()">Cancel</button>
          </form>
        </pp-sign-in-page>
      }
      @case ('done') { <pp-sign-in-page [heading]="title()" [company]="line()"><p class="pp-text">Thank you. Your feedback is saved with your name and the time.</p></pp-sign-in-page> }
      @case ('notStarted') { <pp-sign-in-page [heading]="title()" [company]="line()"><p class="pp-text">You can give feedback once the interview has started.</p></pp-sign-in-page> }
      @case ('given') {
        <pp-sign-in-page [heading]="title()" [company]="line()">@if (own(); as o) { <p class="pp-text">{{ o }}</p> }</pp-sign-in-page>
      }
      @case ('failed') {
        <pp-sign-in-page heading="Interview feedback could not be loaded.">
          <button ppButton appearance="default" type="button" (click)="load()">Try again</button>
        </pp-sign-in-page>
      }
      @case ('notFound') { <pp-sign-in-page heading="This interview could not be found." /> }
    }
  `,
})
export class FeedbackPage {
  private readonly api = inject(HireApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private id = '';
  private key = newKey();
  private run = 0;
  protected readonly state = signal<'loading' | 'form' | 'done' | 'notStarted' | 'given' | 'failed' | 'notFound'>('loading');
  protected readonly answer = signal<Answer | null>(null);
  protected readonly scores = signal<Record<string, number | null>>({});
  protected readonly rating = signal<string | null>(null);
  protected readonly comment = signal('');
  protected readonly sending = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly words = (v: number) => `${v} out of 5, ${SCALE[v - 1]}`;
  protected readonly decisions = [
    { value: 'STRONG_NO', label: 'Strong no', description: 'Do not hire, and say why' },
    { value: 'NO', label: 'No', description: 'Not this time' },
    { value: 'YES', label: 'Yes', description: 'Hire' },
    { value: 'STRONG_YES', label: 'Strong yes', description: 'Hire, and move fast' },
  ];
  protected readonly title = computed(() => { const a = this.answer()!; return `Interview feedback for ${a.candidate_first} ${a.candidate_last}`; });
  protected readonly line = computed(() => { const a = this.answer()!; return `${a.role_title ? a.role_title + ' · ' : ''}${typeWords(a.type) ?? ''} interview on ${day(a.at)}`; });
  protected readonly own = computed(() => feedbackLine(this.answer()?.my_vote));
  protected readonly ready = computed(() => { const a = this.answer(); return !!a && !!this.rating() && a.criteria.every((c) => Number.isInteger(this.scores()[c.key])); });

  constructor() {
    const route = inject(ActivatedRoute);
    const sub = route.paramMap.subscribe((p) => { this.id = p.get('interviewId') ?? ''; this.key = newKey(); void this.load(); });
    inject(DestroyRef).onDestroy(() => { sub.unsubscribe(); this.run++; });
  }

  protected async load(): Promise<void> {
    const run = ++this.run;
    this.state.set('loading');
    this.answer.set(null); this.scores.set({}); this.rating.set(null); this.comment.set(''); this.failure.set(null);
    const r = await this.api.call<Answer>('GET', `/v1/interviews/${encodeURIComponent(this.id)}`);
    if (run !== this.run) return;
    if (r?.status === 404 || r?.status === 403) { this.state.set('notFound'); return; }
    if (r?.status !== 200 || !r.body) { this.state.set('failed'); return; }
    const a = r.body;
    if (a.can?.capture_feedback === false && a.why === 'CLOSED') { this.state.set('notFound'); return; }
    this.answer.set(a);
    if (a.can?.capture_feedback === false) { this.state.set(a.why === 'NOT_STARTED' ? 'notStarted' : 'given'); return; }
    if (!Array.isArray(a.criteria) || !a.criteria.length) { this.answer.set(null); this.state.set('failed'); return; }
    this.scores.set(Object.fromEntries(a.criteria.map((c) => [c.key, null])));
    this.state.set('form');
  }

  protected setScore(key: string, v: number): void { this.scores.update((s) => ({ ...s, [key]: v })); }

  protected cancel(): void {
    if ((history.state?.navigationId ?? 1) > 1) { history.back(); return; }
    const { roles, perms } = rolesOf(this.auth.user()?.groups ?? []);
    void this.router.navigateByUrl(landingFor(roles, perms, []));
  }

  protected async send(): Promise<void> {
    const a = this.answer();
    if (!a || !this.ready() || this.sending()) return;
    const run = this.run;
    this.sending.set(true);
    this.failure.set(null);
    const body: Record<string, unknown> = { scores: Object.fromEntries(a.criteria.map((c) => [c.key, this.scores()[c.key]])), rating: this.rating() };
    if (this.comment()) body['comment'] = this.comment().slice(0, 2000);
    const r = await this.api.call<{ code?: string }>('POST', `/v1/interviews/${encodeURIComponent(this.id)}/votes`, body, this.key);
    if (run !== this.run) return;
    this.sending.set(false);
    if (r?.status === 201) { this.state.set('done'); return; }
    this.failure.set(r?.status === 409 && r.body?.code === 'NOT_STARTED' ? 'You can give feedback once the interview has started.' : 'Your change could not be saved. Try again.');
  }
}
