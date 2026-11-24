import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { PpButton, PpField, PpForm, PpRadioGroup, PpSectionMessage, PpSignInPage, PpSlider, PpTextarea } from '../../ds';
import { environment } from '../../../environments/environment';

// REC-UI-03 step 1: the guest scoring page at /score#token=<token>. No sign-in: the guest opens the emailed link, scores, submits.
type Answer = { candidate_first: string; candidate_last: string; role_title: string | null; interview_type: string; interview_at: string; criteria: Array<{ key: string; label: string }>; expires_at: string };
const SCALE = ['poor', 'fair', 'good', 'strong', 'excellent'];
const TYPES: Record<string, string> = { PHONE_SCREEN: 'Phone screen', TECHNICAL: 'Technical', BEHAVIORAL: 'Behavioral', CULTURE_FIT: 'Culture fit', FINAL: 'Final' };
const typeWords = (code: string) => TYPES[code] ?? ((w: string) => w.charAt(0).toUpperCase() + w.slice(1))(code.toLowerCase().replace(/_/g, ' '));
function day(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${parseInt(get('day'), 10)} ${get('month').replace('.', '')} ${get('year')}`;
}

@Component({
  selector: 'app-score-page',
  imports: [PpSignInPage, PpSlider, PpField, PpRadioGroup, PpTextarea, PpButton, PpForm, PpSectionMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('form') {
        @let a = answer()!;
        <pp-sign-in-page [heading]="'Interview feedback for ' + a.candidate_first + ' ' + a.candidate_last" [company]="line()">
          <p class="pp-text pp-text--small pp-text--subtle">This link expires {{ expires() }}.</p>
          <form ppForm class="pp-stack pp-gap-200" (submit)="$event.preventDefault(); send()">
            @for (c of a.criteria; track c.key) {
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
            @if (saveFailed()) { <pp-section-message tone="danger">Your change could not be saved. Try again.</pp-section-message> }
            <button ppButton appearance="primary" type="submit" icon="send" [disabled]="!ready() || sending()">Submit feedback</button>
          </form>
        </pp-sign-in-page>
      }
      @case ('done') {
        @let d = answer()!;
        <pp-sign-in-page [heading]="'Interview feedback for ' + d.candidate_first + ' ' + d.candidate_last" [company]="line()"><p class="pp-text">Thank you. Your feedback is saved with your name and the time.</p></pp-sign-in-page>
      }
      @case ('failed') {
        <pp-sign-in-page heading="Interview feedback could not be loaded.">
          <button ppButton appearance="default" type="button" (click)="load()">Try again</button>
        </pp-sign-in-page>
      }
      @case ('refused') { <pp-sign-in-page heading="This link could not be found." /> }
    }
  `,
})
export class ScorePage {
  private readonly meta = inject(Meta);
  private token: string | null = null;
  protected readonly state = signal<'loading' | 'form' | 'done' | 'failed' | 'refused'>('loading');
  protected readonly answer = signal<Answer | null>(null);
  protected readonly scores = signal<Record<string, number | null>>({});
  protected readonly rating = signal<string | null>(null);
  protected readonly comment = signal('');
  protected readonly sending = signal(false);
  protected readonly saveFailed = signal(false);
  protected readonly words = (v: number) => `${v} out of 5, ${SCALE[v - 1]}`;
  protected readonly decisions = [
    { value: 'STRONG_NO', label: 'Strong no', description: 'Do not hire, and say why' },
    { value: 'NO', label: 'No', description: 'Not this time' },
    { value: 'YES', label: 'Yes', description: 'Hire' },
    { value: 'STRONG_YES', label: 'Strong yes', description: 'Hire, and move fast' },
  ];
  protected readonly line = computed(() => { const a = this.answer()!; return `${a.role_title ? a.role_title + ' · ' : ''}${typeWords(a.interview_type)} interview on ${day(a.interview_at)}`; });
  protected readonly expires = computed(() => day(this.answer()!.expires_at));
  protected readonly ready = computed(() => { const a = this.answer(); return !!a && !!this.rating() && a.criteria.every((c) => Number.isInteger(this.scores()[c.key])); });

  constructor() {
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    this.meta.updateTag({ name: 'referrer', content: 'no-referrer' });
    const router = inject(Router);
    let first = true;
    const sub = router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      const t = /(?:^#|&)token=([^&]*)/.exec(window.location.hash)?.[1] ?? null;
      const wasFirst = first;
      first = false;
      if (window.location.hash) {
        // Take the token out of the address, through the router so it does not put it back, and only then ask for the link.
        void router.navigateByUrl('/score', { replaceUrl: true }).then(() => this.takeToken(t));
      } else if (wasFirst) this.takeToken(null);
    });
    inject(DestroyRef).onDestroy(() => { sub.unsubscribe(); this.meta.removeTag('name="robots"'); this.meta.removeTag('name="referrer"'); });
  }

  private takeToken(t: string | null): void {
    this.token = t || null;
    this.answer.set(null); this.scores.set({}); this.rating.set(null); this.comment.set(''); this.saveFailed.set(false);
    if (!this.token) { this.state.set('refused'); return; }
    void this.load();
  }

  protected async load(): Promise<void> {
    const token = this.token;
    this.state.set('loading');
    try {
      const res = await fetch(`${environment.talentFlowApiUrl}/v1/scoring-links/${encodeURIComponent(token!)}`);
      if (token !== this.token) return;
      if (res.status === 410) { this.state.set('refused'); return; }
      if (!res.ok) { this.state.set('failed'); return; }
      const a = (await res.json()) as Answer;
      this.answer.set({ candidate_first: a.candidate_first, candidate_last: a.candidate_last, role_title: a.role_title, interview_type: a.interview_type, interview_at: a.interview_at, criteria: a.criteria, expires_at: a.expires_at });
      this.scores.set(Object.fromEntries(a.criteria.map((c) => [c.key, null])));
      this.state.set('form');
    } catch {
      if (token === this.token) this.state.set('failed');
    }
  }

  protected setScore(key: string, v: number): void { this.scores.update((s) => ({ ...s, [key]: v })); }

  protected async send(): Promise<void> {
    if (!this.ready() || this.sending()) return;
    this.sending.set(true);
    this.saveFailed.set(false);
    const body: Record<string, unknown> = { scores: this.scores(), rating: this.rating() };
    if (this.comment()) body['comment'] = this.comment().slice(0, 2000);
    try {
      const res = await fetch(`${environment.talentFlowApiUrl}/v1/scoring-links/${encodeURIComponent(this.token!)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { this.state.set('done'); this.token = null; } else this.saveFailed.set(true);
    } catch { this.saveFailed.set(true); }
    this.sending.set(false);
  }
}
