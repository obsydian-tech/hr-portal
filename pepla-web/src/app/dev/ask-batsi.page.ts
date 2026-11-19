import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { PpAgentPanel, PpAppShell, PpButton, PpButtonGroup, PpInlineMessage, PpSideNavigation, PpTopNavigation, NavSection, PanelMessage, PanelSuggestion, Proposal } from '../ds';
import words from './ask-batsi.words.json';

/**
 * Prototype of the Ask Batsi chat: the top bar Ask Batsi button opens the side panel (no bubble), and the panel expands to a full page with past chats.
 * Fake data and fixed replies: nothing here calls an AI or any network. Every sentence comes from ask-batsi.words.json
 * (approved or "proposed, not approved").
 */
type W = Record<string, { text: string; status: string }>;
const T = words as unknown as W;
const w = (k: string, v: Record<string, string> = {}) => Object.entries(v).reduce((t, [a, b]) => t.replaceAll(`{${a}}`, b), T[k].text);
type Mode = 'normal' | 'error' | 'limit' | 'off' | 'offline';

const PROPOSAL: Proposal = {
  title: w('W10', { name: 'Kagiso' }),
  whyNow: w('P05', { 'first name': 'Kagiso' }),
  sources: [],
  destinations: [{ where: 'Naleko People', what: 'a message to Kagiso', external: false }],
  confidence: 'high',
};
const ROWS = `ID document: Matches\nBank letter: Matches\nTax number: Captured\nContract: Signed\nUIF reference number: Missing`;
const READY: PanelMessage[] = [
  { day: 'Today', from: 'person', text: w('W05', { name: 'Kagiso' }), at: '09:41' },
  { from: 'pepla', text: `${w('W08')}\n${ROWS}`, at: '09:41' },
  { from: 'proposal', proposal: PROPOSAL },
];
export interface PastChat { id: string; group: string; title: string; messages: PanelMessage[]; }
const PAST: PastChat[] = [
  { id: '1', group: 'Today', title: w('W05', { name: 'Kagiso' }), messages: [...READY.slice(0, 2), { from: 'proposal', proposal: PROPOSAL, outcome: w('W13', { approver: 'Thandeka Dlamini' }) }, { from: 'pepla', text: w('W14', { name: 'Kagiso' }), at: '09:42' }] },
  { id: '2', group: 'Today', title: w('W07'), messages: [{ day: 'Today', from: 'person', text: w('W07'), at: '08:10' }, { from: 'pepla', text: 'Two candidates need attention.\nCandidate 3 · Interview: No reply in 5 days\nCandidate 1 · Offer: Offer expires in 2 days', at: '08:10' }] },
  { id: '3', group: 'Yesterday', title: w('W06'), messages: [{ day: 'Yesterday', from: 'person', text: w('W06'), at: '15:12' }, { from: 'pepla', text: 'Two new employees are waiting on documents.\nKagiso Molefe: UIF reference number\nNew employee 2: Bank letter', at: '15:12' }] },
];

/** The live chat shared by the panel and the full page, so expanding keeps the conversation. */
@Injectable({ providedIn: 'root' })
export class FakeChat {
  readonly mode = signal<Mode>('normal');
  readonly working = signal<string | undefined>(undefined);
  readonly messages = signal<PanelMessage[]>([{ day: 'Today', from: 'pepla', text: w('P02', { 'first name': 'Thandeka' }), at: '09:40' }]);
  private timer?: ReturnType<typeof setTimeout>;
  say(m: PanelMessage) { this.messages.update((c) => [...c, m]); }
  reset() { this.stop(false); this.messages.set([{ day: 'Today', from: 'pepla', text: w('P02', { 'first name': 'Thandeka' }), at: '09:40' }]); }
  stop(note = true) { clearTimeout(this.timer); this.working.set(undefined); if (note) this.say({ from: 'pepla', text: w('P04'), at: '09:44' }); }
  ask(text: string) {
    this.say({ from: 'person', text, at: '09:41' });
    const m = this.mode();
    if (m === 'off') return this.say({ from: 'pepla', text: `${w('P12')} ${w('P13')}`, at: '09:41' });
    if (m === 'offline') return this.say({ from: 'pepla', text: w('P14'), at: '09:41' });
    if (m === 'limit') return this.say({ from: 'pepla', text: w('P11', { n: '12' }), at: '09:41' });
    this.working.set(w('P03'));
    this.timer = setTimeout(() => {
      this.working.set(undefined);
      if (m === 'error') return this.say({ from: 'pepla', text: `${w('P09')} (${w('P10')})`, at: '09:41' });
      const q = text.toLowerCase();
      if (q.includes('ready') || q.includes('monday')) { this.say({ from: 'pepla', text: `${w('W08')}\n${ROWS}`, at: '09:41' }); this.say({ from: 'proposal', proposal: PROPOSAL }); }
      else if (q.includes('document')) this.say({ from: 'pepla', text: PAST[2].messages[1] && (PAST[2].messages[1] as { text: string }).text, at: '09:41' });
      else if (q.includes('risk') || q.includes('candidate')) this.say({ from: 'pepla', text: (PAST[1].messages[1] as { text: string }).text, at: '09:41' });
      else this.say({ from: 'pepla', text: w('P08'), at: '09:41' });
    }, 900);
  }
  approve() {
    this.messages.update((c) => c.map((m) => (m.from === 'proposal' ? { ...m, outcome: w('W13', { approver: 'Thandeka Dlamini' }) } : m)));
    this.say({ from: 'pepla', text: w('W14', { name: 'Kagiso' }), at: '09:42' });
  }
}

@Component({
  selector: 'app-ask-batsi-page',
  imports: [PpAgentPanel, PpAppShell, PpButton, PpButtonGroup, PpInlineMessage, PpSideNavigation, PpTopNavigation],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-inline-message tone="warning">{{ banner }}</pp-inline-message>
    <pp-button-group>
      @for (m of modes; track m.id) { <button ppButton size="small" [appearance]="chat.mode() === m.id ? 'primary' : 'default'" type="button" (click)="chat.mode.set(m.id)">{{ m.label }}</button> }
    </pp-button-group>
    <pp-app-shell [inline]="true" [inlineHeight]="narrow() ? 1100 : 800" [phone]="narrow()">
      @if (!narrow()) { <pp-side-navigation company="Mokoena Logistics" [inline]="true" [inlineHeight]="800" [sections]="sections()" /> }
      @if (!fullPage()) { <pp-top-navigation userName="Thandeka Dlamini" [inline]="true" [compact]="narrow()" [showAsk]="true" [waiting]="2" [askOpen]="panelOpen()" (ask)="panelOpen.set(!panelOpen())" /> }
      @if (narrow() && fullPage()) {
        <pp-button-group>
          <button ppButton size="small" icon="arrow-left" type="button" (click)="go('/dev/ask-batsi')">{{ backLabel }}</button>
          <button ppButton size="small" icon="plus" type="button" (click)="go('/dev/ask-batsi/chat')">{{ newLabel }}</button>
          @for (p of past; track p.id) { <button ppButton size="small" type="button" (click)="go('/dev/ask-batsi/chat/' + p.id)">{{ p.title }}</button> }
        </pp-button-group>
      }
      @if (fullPage()) {
        <pp-agent-panel [open]="true" [inline]="true" [page]="true" [heading]="heading()" [context]="pastChat() ? 'Looking at Today' : 'Looking at Today'" placeholder="Ask Batsi"
          [messages]="shown()" [suggestions]="empty() ? suggestions : []" [working]="pastChat() ? undefined : chat.working()"
          (send)="send($event)" (stop)="chat.stop()" (approve)="chat.approve()" (review)="chat.approve()" />
      } @else {
        <h1 class="pp-heading pp-heading--large">Kagiso Molefe</h1>
        <p class="pp-text">Finance · Starts 16 Nov 2026 · Documents submitted</p>
        @if (panelOpen()) {
          <pp-agent-panel [open]="panelOpen()" [inline]="true" [inlineHeight]="640" context="Looking at Kagiso Molefe" [placeholder]="placeholder" [expandable]="true"
            [messages]="chat.messages()" [suggestions]="chat.messages().length > 1 ? [] : suggestions" [working]="chat.working()"
            (send)="chat.ask($event)" (stop)="chat.stop()" (approve)="chat.approve()" (review)="chat.approve()" (expand)="expand()" (openChange)="panelOpen.set($event)" />
        }
      }
    </pp-app-shell>`,
})
export class AskBatsiPage {
  protected readonly chat = inject(FakeChat);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.paramMap);
  protected readonly banner = w('P16');
  protected readonly narrow = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected readonly past = PAST;
  protected readonly backLabel = w('P17');
  protected readonly newLabel = w('P18');
  protected go(url: string) { this.router.navigateByUrl(url); }
  protected readonly placeholder = w('W04', { name: 'Kagiso' });
  protected readonly panelOpen = signal(false);
  protected readonly fullPage = computed(() => this.route.snapshot.routeConfig?.path?.includes('chat') ?? false);
  protected readonly pastChat = computed(() => PAST.find((p) => p.id === this.params()?.get('id')));
  protected readonly shown = computed(() => this.pastChat()?.messages ?? this.chat.messages());
  protected readonly empty = computed(() => !this.pastChat() && this.chat.messages().length <= 1);
  protected readonly heading = computed(() => this.pastChat()?.title ?? (this.empty() ? w('P18') : this.chat.messages().find((m) => m.from === 'person') ? (this.chat.messages().find((m) => m.from === 'person') as { text: string }).text : w('P18')));
  protected readonly modes: { id: Mode; label: string }[] = [
    { id: 'normal', label: 'Normal' }, { id: 'error', label: 'Could not answer' }, { id: 'limit', label: 'Hourly limit' }, { id: 'off', label: 'Not switched on' }, { id: 'offline', label: 'Offline' },
  ];
  protected readonly suggestions: PanelSuggestion[] = [
    { icon: 'user-check', label: w('W05', { name: 'Kagiso' }), link: '/dev/ask-batsi' },
    { icon: 'file-text', label: w('W06'), link: '/dev/ask-batsi' },
    { icon: 'user-search', label: w('W07'), link: '/dev/ask-batsi' },
  ];
  protected readonly sections = computed<NavSection[]>(() => {
    if (!this.fullPage()) return [{ items: [{ label: 'Today', icon: 'house', link: '/dev/ask-batsi/today' }, { label: 'People', icon: 'users', link: '/dev/ask-batsi' }] }];
    const groups = ['Today', 'Yesterday'];
    return [
      { items: [{ label: w('P17'), icon: 'arrow-left', link: '/dev/ask-batsi' }, { label: w('P18'), icon: 'plus', link: '/dev/ask-batsi/chat' }] },
      ...groups.map((g) => ({ heading: g, items: PAST.filter((p) => p.group === g).map((p) => ({ label: p.title, icon: 'messages-square' as const, link: `/dev/ask-batsi/chat/${p.id}` })) })),
    ];
  });
  protected send(text: string) { if (this.pastChat()) { this.chat.reset(); this.router.navigateByUrl('/dev/ask-batsi/chat'); } this.chat.ask(text); }
  protected expand() { this.router.navigateByUrl('/dev/ask-batsi/chat'); }
}
