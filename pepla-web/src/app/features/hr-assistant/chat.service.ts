import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter, firstValueFrom, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { ScreenContext } from '../../core/screen-context';
import type { ChatGroup, PanelCard, PanelCheck, PanelDecision, PanelMessage } from '../../ds';
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
  loadFailed: 'We could not load your chats.',
  openFailed: 'We could not open this chat.',
  newChat: 'New chat',
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
  | { kind: 'open-failed' }
  | { kind: 'limit'; minutes: number };

/** One chat in the list: what GET /v1/chats gives. */
export interface ChatHead { chatId: string; title: string; updated: string; }
interface StoredMessage { role?: string; text?: string; at?: string; blocks?: AnswerBlock[]; }
interface StoredChat { chatId?: string; title?: string; messages?: StoredMessage[]; }
export const OPEN_RETRY = '\u0000open';

interface ChatAnswer {
  message?: string;
  chatId?: string;
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

const SA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' });
const SA_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', month: 'long', year: 'numeric' });
/** The calendar day in South Africa as a number of days, so two days can be told apart. */
export function saDays(d: Date): number { const [y, m, day] = SA_DAY.format(d).split('-').map(Number); return Date.UTC(y!, m! - 1, day!) / 86_400_000; }
export function groupOf(updated: string, now: Date): string {
  const d = new Date(updated);
  const back = saDays(now) - saDays(d);
  if (back <= 0) return 'Today';
  if (back === 1) return 'Yesterday';
  if (back <= 7) return 'Previous 7 days';
  return SA_MONTH.format(d);
}
/** A stored message's time: "15:12" today, "Yesterday 15:12", else "12 Nov 2026, 15:12". */
function stamp(iso: string | undefined): string {
  const d = new Date(iso ?? NaN);
  if (Number.isNaN(d.getTime())) return '';
  const back = saDays(new Date()) - saDays(d);
  if (back <= 0) return time(d);
  if (back === 1) return `Yesterday ${time(d)}`;
  return when(d);
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
  /** The open chat: its id once it is stored, and its title. Null for a new chat. */
  readonly chatId = signal<string | null>(null);
  readonly title = signal<string | null>(null);
  readonly chats = signal<ChatHead[]>([]);
  readonly listState = signal<'loading' | 'ok' | 'error' | 'off'>('loading');
  /** The number of chats is known only when every page was read. */
  readonly listComplete = signal(false);
  readonly openState = signal<'idle' | 'loading' | 'failed'>('idle');
  readonly confirmOne = signal(false);
  readonly confirmAll = signal(false);
  readonly deleting = signal(false);
  /** Every chat was deleted: Delete all my chats is not shown again until the list is read with chats in it. */
  readonly allDeleted = signal(false);
  readonly deleteFailed = signal(false);
  readonly focusRequest = signal<{ what: 'heading' | 'box'; n: number } | null>(null);
  private focusN = 0;
  private listGen = 0;
  private view = 0;
  private lastOpen: { id: string; title?: string } | null = null;
  /** CHAT-17: the full page, loaded in the browser, opens the person's last chat once the first list read answers. */
  private lastChatPending = true;
  /** CHAT-17 (Iggie, 20 Nov 18:50 SAST, "Match full page"): the side panel, opened first on a visit, starts on the last chat too. */
  private panelPending = false;

  private readonly url = toSignal(this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), map((e) => e.urlAfterRedirects)), { initialValue: this.router.url });
  readonly onPage = computed(() => this.url().split('?')[0] === CHAT_PAGE);
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
      if (url.split('?')[0] === CHAT_PAGE) { untracked(() => { if (this.auth.user()) void this.loadList(); }); return; }
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
      case 'open-failed': return { from: 'alert', heading: SAID.openFailed };
      case 'limit': return { from: 'warning', heading: SAID.limit(e.minutes) };
    }
  }));
  readonly started = computed(() => this.entries().some((e) => e.kind === 'person') || this.chatId() !== null || this.openState() !== 'idle');
  readonly reopened = signal(false);
  readonly heading = computed(() => this.title() ?? SAID.newChat);
  /** The list as the left column draws it: newest first, under Today, Yesterday, Previous 7 days and then each month. */
  readonly groups = computed<ChatGroup[]>(() => {
    const now = new Date();
    const current = this.chatId();
    const sorted = [...this.chats()].sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
    const out: ChatGroup[] = [];
    for (const c of sorted) {
      const name = groupOf(c.updated, now);
      const item = { id: c.chatId, title: c.title, current: c.chatId === current };
      const g = out.find((x) => x.name === name);
      if (g) g.items.push(item); else out.push({ name, items: [item] });
    }
    return out;
  });
  /** Delete all my chats is offered when there are chats, or when the list could not be read (there may be some). */
  readonly canDeleteAll = computed(() => {
    if (this.allDeleted()) return false;
    const s = this.listState();
    return s === 'error' || s === 'off' || (s === 'ok' && this.chats().length > 0);
  });
  private chatsApi(path = ''): string { return `${environment.agentApiUrl}/v1/chats${path}`; }

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
    this.listGen++;
    this.view++;
    this.chatId.set(null);
    this.title.set(null);
    this.chats.set([]);
    this.listState.set('loading');
    this.listComplete.set(false);
    this.openState.set('idle');
    this.reopened.set(false);
    this.confirmOne.set(false);
    this.confirmAll.set(false);
    this.deleting.set(false);
    this.allDeleted.set(false);
    this.deleteFailed.set(false);
    this.waiting.set(0);
    this.focus.set(null);
    this.returnTo.set('/hr');
    this.lastOpen = null;
    this.lastChatPending = true;
    this.panelPending = false;
  }

  /** The panel's Open as a full page: the same conversation, never switched to the last chat. */
  fromPanel(): void { this.lastChatPending = false; this.panelPending = false; }
  /** The side panel opened: on a fresh visit with a blank conversation, read the list and open the last chat. */
  panelOpened(): void {
    if (!this.lastChatPending || this.onPage() || this.chatId() || this.entries().length || this.working()) return;
    this.panelPending = true;
    void this.loadList();
  }

  async ask(text: string): Promise<void> {
    const question = text.trim();
    if (!question || this.working() || !this.online() || this.notOn()) return;
    this.lastChatPending = false;
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
    const view = this.view;
    this.working.set(true);
    const screen = this.looking();
    const body = { message: question, ...(this.chatId() ? { chatId: this.chatId() } : {}), screenContext: { view: screen ? 'person' : this.returnTo().startsWith('/hr/documents') ? 'documents' : 'today', ...(screen ? { employeeId: screen.id } : {}) } };
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
    if (mine !== this.generation) { if (view !== this.view && answer?.chatId) void this.loadList(); return; } // Stop, sign-out or another chat came first: a late answer is dropped
    this.working.set(false);
    const now = time(new Date());
    if (failure) {
      const status = failure instanceof HttpErrorResponse ? failure.status : 0;
      if (status === 404 && body.chatId) { this.chatId.set(null); this.title.set(null); this.entries.update((e) => [...e, { kind: 'batsi', text: SAID.error, at: now }, { kind: 'retry', question }]); void this.loadList(); return; }
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
    if (typeof a.chatId === 'string' && a.chatId) this.chatId.set(a.chatId);
    const added: Entry[] = [{ kind: 'batsi', text: String(a.message ?? ''), at: now, ...(Array.isArray(a.structuredData?.checks) ? { checks: a.structuredData!.checks } : {}), ...(Array.isArray(a.blocks) ? { blocks: a.blocks } : {}) }];
    for (const p of a.proposals ?? []) {
      added.push({ kind: 'card', canApprove: p.canApprove, card: { id: p.actionId, title: p.title, quote: p.draft, state: 'waiting', ...(!p.canApprove && p.approver ? { blockedBy: p.approver.name } : {}) } });
    }
    this.entries.update((e) => [...e, ...added]);
    void this.loadWaiting();
    if (a.chatId) void this.loadList();
  }

  private chatsHeaders(token: string): HttpHeaders { return this.headers(token); }

  /** Reads every page of the person's chats (up to 20), showing what has come as pages arrive. */
  async loadList(): Promise<void> {
    const gen = ++this.listGen;
    if (this.listState() === 'error') this.listState.set('loading');
    let all: ChatHead[] = [];
    let next: string | undefined;
    let pages = 0;
    try {
      const token = await this.auth.idToken();
      if (!token) throw new Error('not signed in');
      do {
        const params = next ? { nextToken: next } : undefined;
        const res = await firstValueFrom(this.http.get<{ chats?: ChatHead[]; nextToken?: string }>(this.chatsApi(), { headers: this.chatsHeaders(token), ...(params ? { params } : {}) }));
        if (gen !== this.listGen) return;
        if (!res || !Array.isArray(res.chats)) throw new Error('no list');
        all = [...all, ...res.chats.filter((c) => c && typeof c.chatId === 'string' && typeof c.title === 'string' && typeof c.updated === 'string')];
        this.chats.set(all);
        if (all.length) this.allDeleted.set(false);
        this.listState.set('ok');
        if (pages === 0) this.openLastChat(all);
        next = typeof res.nextToken === 'string' && res.nextToken ? res.nextToken : undefined;
        pages++;
      } while (next && pages < 20);
      this.listComplete.set(!next);
    } catch (err) {
      if (gen !== this.listGen) return;
      this.lastChatPending = false;
      if (err instanceof HttpErrorResponse && err.status === 403) {
        this.chats.set([]);
        this.listState.set('off');
        this.entries.update((e) => (e.some((x) => x.kind === 'not-on') ? e : [...e, { kind: 'not-on' }]));
        return;
      }
      this.listComplete.set(false);
      this.listState.set('error');
    }
  }

  private openLastChat(all: ChatHead[]): void {
    const armed = this.lastChatPending;
    this.lastChatPending = false;
    const panel = this.panelPending;
    this.panelPending = false;
    if (!armed || !(this.onPage() || panel) || this.chatId() || this.entries().length || this.openState() !== 'idle' || this.working()) return;
    const last = [...all].sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0))[0];
    if (last) void this.openChat(last.chatId, last.title, true);
  }

  /** An old chat, read from the server and shown like a live one. */
  async openChat(id: string, title?: string, auto = false): Promise<void> {
    this.lastChatPending = false;
    const view = ++this.view;
    this.generation++;
    this.inFlight?.unsubscribe();
    this.working.set(false);
    this.lastOpen = { id, ...(title ? { title } : {}) };
    this.chatId.set(id);
    this.title.set(title ?? this.chats().find((c) => c.chatId === id)?.title ?? null);
    this.reopened.set(true);
    this.openState.set('loading');
    this.entries.set([]);
    try {
      const token = await this.auth.idToken();
      if (!token) throw new Error('not signed in');
      const chat = await firstValueFrom(this.http.get<StoredChat>(this.chatsApi(`/${encodeURIComponent(id)}`), { headers: this.chatsHeaders(token) }));
      if (view !== this.view) return;
      const messages = Array.isArray(chat?.messages) ? chat.messages : [];
      this.title.set(typeof chat?.title === 'string' && chat.title ? chat.title : this.title());
      this.entries.set(messages.map((m): Entry => (m.role === 'person' ? { kind: 'person', text: String(m.text ?? ''), at: stamp(m.at) } : { kind: 'batsi', text: String(m.text ?? ''), at: stamp(m.at), ...(Array.isArray(m.blocks) ? { blocks: m.blocks } : {}) })));
      this.openState.set('idle');
      if (!auto) this.focusHeading();
    } catch (err) {
      if (view !== this.view) return;
      const status = err instanceof HttpErrorResponse ? err.status : 0;
      if (status === 404) { this.startNew(!auto); void this.loadList(); return; }
      if (status === 403) { this.chatId.set(null); this.title.set(null); this.reopened.set(false); this.openState.set('idle'); this.entries.set([{ kind: 'not-on' }]); return; }
      this.openState.set('failed');
      this.entries.set([{ kind: 'open-failed' }, { kind: 'retry', question: OPEN_RETRY }]);
    }
  }

  /** Try again, after an old chat could not be opened. */
  reopen(): void { if (this.lastOpen) void this.openChat(this.lastOpen.id, this.lastOpen.title); }

  private startNew(focus = true): void {
    this.view++;
    this.generation++;
    this.inFlight?.unsubscribe();
    this.working.set(false);
    this.chatId.set(null);
    this.title.set(null);
    this.reopened.set(false);
    this.openState.set('idle');
    this.lastOpen = null;
    this.entries.set(this.listState() === 'off' ? [{ kind: 'not-on' }] : []);
    if (focus) this.focusBox();
  }
  newChat(): void { this.lastChatPending = false; this.startNew(); }

  /** The visible "Back to Today" link (the list column on desktop, the chat header on phone). */
  private focusBackLink(): void {
    if (typeof document === 'undefined') return;
    const links = Array.from(document.querySelectorAll<HTMLElement>('a')).filter((a) => a.textContent?.trim() === 'Back to Today' && a.getClientRects().length > 0);
    links[0]?.focus();
  }

  focusHeading(): void { this.focusRequest.set({ what: 'heading', n: ++this.focusN }); }
  focusBox(): void { this.focusRequest.set({ what: 'box', n: ++this.focusN }); }

  /** Delete the open chat, after the person said yes. 404 counts as done. */
  async deleteOpen(): Promise<void> { await this.remove(this.chatId(), false); }
  async deleteEvery(): Promise<void> { await this.remove(null, true); }

  private async remove(id: string | null, all: boolean): Promise<void> {
    if (this.deleting() || (!all && !id)) return;
    this.deleting.set(true);
    this.deleteFailed.set(false);
    try {
      const token = await this.auth.idToken();
      if (!token) throw new Error('not signed in');
      try {
        await firstValueFrom(this.http.delete(all ? this.chatsApi() : this.chatsApi(`/${encodeURIComponent(id!)}`), { headers: this.chatsHeaders(token) }));
      } catch (err) {
        if (!(err instanceof HttpErrorResponse && err.status === 404 && !all)) throw err;
      }
    } catch {
      this.deleting.set(false);
      this.deleteFailed.set(true);
      return;
    }
    this.deleting.set(false);
    this.confirmOne.set(false);
    this.confirmAll.set(false);
    if (all) { this.chats.set([]); this.allDeleted.set(true); }
    else this.chats.update((l) => l.filter((c) => c.chatId !== id));
    this.startNew();
    if (all && this.listState() === 'error') { /* the list could not be read before: still unknown */ } else void this.loadList();
    // The message box is off when Ask Batsi is switched off, and the button just pressed is gone: focus goes to Back to Today.
    setTimeout(() => (this.listState() === 'off' || this.notOn() ? this.focusBackLink() : this.focusBox()), 60);
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
