import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter, firstValueFrom, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { ScreenContext } from '../../core/screen-context';
import type { PanelCard, PanelCheck, PanelDecision, PanelMessage } from '../../ds';
import type { AnswerBlock } from '../../ds/agent/answer-text';

/** The full page route. The panel's Expand button goes here; "Back to Today" comes back from it. */
export const CHAT_PAGE = '/hr/ask-batsi';

/** Words the person reads (approved 18 Nov 2026, ask-batsi-chat/words.json). */
export const SAID = {
  working: 'Batsi is working on it',
  stopped: 'Stopped. Nothing was changed.',
  error: 'I could not answer that. Try again in a few minutes.',
  notOn: 'Ask Batsi is not switched on for your company.',
  notOnNext: 'Ask your administrator to switch it on.',
  offline: 'You are offline. You can ask again when you are back online.',
  limit: (minutes: number) => `You have reached the hourly limit for questions. Try again in ${minutes} minutes.`,
  approvedBy: (who: string) => `Approved by ${who}.`,
  failed: 'It did not go through. Nothing was changed.',
  greeting: (first: string) => `Hi ${first}. Pick a question or ask me.`,
  today: 'Looking at Today',
  looking: (name: string) => `Looking at ${name}`,
  placeholderToday: 'Ask Batsi',
  placeholderPerson: (first: string) => `Ask anything about ${first}`,
};

type Entry =
  | { kind: 'person'; text: string; at: string }
  | { kind: 'batsi'; text: string; at: string; checks?: PanelCheck[]; blocks?: AnswerBlock[] }
  | { kind: 'card'; card: PanelCard; canApprove: boolean; last?: 'approve' | 'decline' }
  | { kind: 'retry'; question: string }
  | { kind: 'not-on' }
  | { kind: 'limit'; minutes: number };

interface ChatAnswer {
  message?: string;
  structuredData?: { checks?: PanelCheck[] };
  blocks?: AnswerBlock[];
  proposals?: Array<{ actionId: string; title: string; draft: string; canApprove: boolean; approver?: { name: string } }>;
}

const SA_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });
const SA_WHEN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const time = (d: Date) => SA_TIME.format(d);
function when(d: Date): string {
  const p = Object.fromEntries(SA_WHEN.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p['day']} ${String(p['month']).replace('Sept', 'Sep')} ${p['year']}, ${p['hour']}:${p['minute']}`;
}

/**
 * The HR person's conversation with Batsi, shared by the side panel and the full page (one conversation, two forms).
 * It calls the Agent API (`environment.agentApiUrl` + /agent/v1/...) with the person's own sign-in and nothing else:
 * never the company, never an API key. Nothing is asked on page load; what waits is read when Ask Batsi is opened.
 * Spec: CHAT-01 (the contract is in e2e/acceptance/cards/chat-01.md). Past chats are stored by CHAT-02, not here.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly screen = inject(ScreenContext);

  private readonly entries = signal<Entry[]>([]);
  readonly working = signal(false);
  /** How many proposals wait for this person. Read when Ask Batsi is opened and after each answer or decision. */
  readonly waiting = signal(0);
  /** The company has not switched Ask Batsi on (the API said 403). */
  readonly notOn = computed(() => this.entries().some((e) => e.kind === 'not-on'));
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

  private generation = 0;
  private inFlight?: Subscription;

  private readonly url = toSignal(this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), map((e) => e.urlAfterRedirects)), { initialValue: this.router.url });
  /** The page the person was on before the full page: where "Back to Today" goes. */
  readonly returnTo = signal('/hr');
  /** The person the last page was about, kept while the full page is open so the conversation stays about them. */
  private readonly focus = signal<{ id: string; name: string } | null>(null);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.online.set(true));
      window.addEventListener('offline', () => this.online.set(false));
    }
    // A different person (or nobody) is signed in now, for any reason, sign-out or an expired session included:
    // nothing of the last person's conversation, waiting count or page may be shown to the next.
    let signedInAs: string | null | undefined;
    effect(() => {
      const sub = this.auth.user()?.sub ?? null;
      untracked(() => {
        if (signedInAs !== undefined && sub !== signedInAs) this.clear();
        signedInAs = sub;
      });
    });
    effect(() => {
      const url = this.url();
      if (url.split('?')[0] === CHAT_PAGE) return;
      this.returnTo.set(url);
      this.focus.set(this.screen.person());
    });
  }

  /** What Batsi is looking at: the person this page is about, or today's work. */
  readonly looking = computed(() => this.focus());
  readonly contextLine = computed(() => { const p = this.focus(); return p ? SAID.looking(p.name) : SAID.today; });
  readonly placeholder = computed(() => { const p = this.focus(); return p ? SAID.placeholderPerson(p.name.split(' ')[0] ?? '') : SAID.placeholderToday; });
  readonly firstName = computed(() => (this.auth.user()?.fullName ?? '').split(' ')[0] ?? '');
  readonly messages = computed<PanelMessage[]>(() => this.entries().map((e): PanelMessage => {
    switch (e.kind) {
      case 'person': return { from: 'person', text: e.text, at: e.at };
      case 'batsi': return { from: 'pepla', text: e.text, at: e.at, ...(e.checks?.length ? { checks: e.checks, checksLabel: 'Checks' } : {}), ...(e.blocks ? { blocks: e.blocks } : {}) };
      case 'card': return { from: 'card', card: e.card };
      case 'retry': return { from: 'retry', question: e.question };
      case 'not-on': return { from: 'empty', icon: 'lock', heading: SAID.notOn, body: SAID.notOnNext };
      case 'limit': return { from: 'warning', heading: SAID.limit(e.minutes) };
    }
  }));
  readonly started = computed(() => this.entries().some((e) => e.kind === 'person'));

  private headers(token: string): HttpHeaders { return new HttpHeaders({ Authorization: `Bearer ${token}` }); }
  private api(path: string): string { return `${environment.agentApiUrl}/agent/v1/${path}`; }

  /** Reads what waits for this person. A failed read changes nothing and shows nothing. */
  async loadWaiting(): Promise<void> {
    try {
      const token = await this.auth.idToken();
      if (!token) return;
      const answer = await firstValueFrom(this.http.get<{ count?: number }>(this.api('actions/pending'), { headers: this.headers(token) }));
      this.waiting.set(Math.max(0, Number(answer.count) || 0));
    } catch { /* the button stays as it was */ }
  }

  /** Back to an empty conversation (sign-out). */
  clear(): void {
    this.generation++;
    this.inFlight?.unsubscribe();
    this.entries.set([]);
    this.working.set(false);
    this.waiting.set(0);
    this.focus.set(null);
    this.returnTo.set('/hr');
  }

  async ask(text: string): Promise<void> {
    const question = text.trim();
    if (!question || this.working() || !this.online() || this.notOn()) return;
    this.entries.update((e) => [...e, { kind: 'person', text: question, at: time(new Date()) }]);
    await this.run(question);
  }

  /** Try again: the same question, asked again without showing it twice. */
  async retry(question: string): Promise<void> {
    if (this.working()) return;
    this.entries.update((e) => e.filter((x) => !(x.kind === 'retry' && x.question === question)));
    await this.run(question);
  }

  stop(): void {
    if (!this.working()) return;
    this.generation++;
    this.inFlight?.unsubscribe();
    this.working.set(false);
    this.entries.update((e) => [...e, { kind: 'batsi', text: SAID.stopped, at: time(new Date()) }]);
  }

  private async run(question: string): Promise<void> {
    const mine = ++this.generation;
    this.working.set(true);
    const screen = this.looking();
    const body = { message: question, screenContext: { view: screen ? 'person' : this.returnTo().startsWith('/hr/documents') ? 'documents' : 'today', ...(screen ? { employeeId: screen.id } : {}) } };
    let answer: ChatAnswer | null = null;
    let failure: HttpErrorResponse | Error | null = null;
    try {
      const token = await this.auth.idToken();
      if (!token) throw new Error('not signed in');
      answer = await new Promise<ChatAnswer>((resolve, reject) => {
        this.inFlight = this.http.post<ChatAnswer>(this.api('ai-chat'), body, { headers: this.headers(token) }).subscribe({ next: resolve, error: reject });
      });
    } catch (err) {
      failure = err as HttpErrorResponse | Error;
    }
    if (mine !== this.generation) return; // Stop (or sign-out) came first: a late answer is dropped
    this.working.set(false);
    const now = time(new Date());
    if (failure) {
      const status = failure instanceof HttpErrorResponse ? failure.status : 0;
      if (status === 403) { this.entries.update((e) => [...e, { kind: 'not-on' }]); return; }
      if (status === 429) {
        const seconds = Number((failure as HttpErrorResponse).error?.retryAfter ?? (failure as HttpErrorResponse).headers?.get('retry-after')) || 60;
        this.entries.update((e) => [...e, { kind: 'limit', minutes: Math.max(1, Math.ceil(seconds / 60)) }]);
        return;
      }
      this.entries.update((e) => [...e, { kind: 'batsi', text: SAID.error, at: now }, { kind: 'retry', question }]);
      return;
    }
    const a = answer!;
    const added: Entry[] = [{ kind: 'batsi', text: String(a.message ?? ''), at: now, ...(Array.isArray(a.structuredData?.checks) ? { checks: a.structuredData!.checks } : {}), ...(Array.isArray(a.blocks) ? { blocks: a.blocks } : {}) }];
    for (const p of a.proposals ?? []) {
      added.push({ kind: 'card', canApprove: p.canApprove, card: { id: p.actionId, title: p.title, quote: p.draft, state: 'waiting', ...(!p.canApprove && p.approver ? { blockedBy: p.approver.name } : {}) } });
    }
    this.entries.update((e) => [...e, ...added]);
    void this.loadWaiting();
  }

  /** The person's decision on a card: Approve or Decline go to the Agent API as that person. Edit has no behaviour yet. */
  async decide(d: PanelDecision): Promise<void> {
    const found = this.entries().find((e): e is Extract<Entry, { kind: 'card' }> => e.kind === 'card' && e.card.id === d.id);
    if (!found) return;
    const action = d.action === 'retry' ? found.last : d.action === 'edit' ? undefined : d.action;
    if (!action) return;
    this.setCard(d.id, { state: 'working' }, action);
    try {
      const token = await this.auth.idToken();
      if (!token) throw new Error('not signed in');
      const path = `actions/${encodeURIComponent(d.id)}/${action === 'approve' ? 'approve' : 'reject'}`;
      await firstValueFrom(this.http.post(this.api(path), action === 'decline' && d.reason ? { reason: d.reason } : {}, { headers: this.headers(token) }));
    } catch {
      this.setCard(d.id, { state: 'failed', outcome: { text: SAID.failed, at: new Date().toISOString(), when: when(new Date()) } }, action);
      return;
    }
    const now = new Date();
    if (action === 'approve') this.setCard(d.id, { state: 'approved', outcome: { text: SAID.approvedBy(this.auth.user()?.fullName ?? ''), at: now.toISOString(), when: when(now) }, auditLink: '/hr' }, action);
    else this.setCard(d.id, { state: 'declined', outcome: undefined }, action);
    void this.loadWaiting();
  }

  private setCard(id: string, change: Partial<PanelCard>, last?: 'approve' | 'decline'): void {
    this.entries.update((all) => all.map((e) => (e.kind === 'card' && e.card.id === id ? { ...e, ...(last ? { last } : {}), card: { ...e.card, ...change } } : e)));
  }
}
