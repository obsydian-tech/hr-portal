import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { DemoClock } from '../demo-clock';
import { PpSiteReveal } from '../motion';

type Tab = 'api' | 'mcp' | 'ev';
const ORDER: readonly Tab[] = ['api', 'mcp', 'ev'];

/**
 * The code is written as ⟦colour|text⟧ runs so each character carries its colour while it types:
 * c comment, k keyword, f function, s string, n number. Words are the kit's (site-editor).
 */
const SRC: Record<Tab, { file: string; code: string }> = {
  api: { file: 'check-new-hire.ts', code:
    '⟦c|// Ask Batsi to check a new hire from any system⟧\n⟦k|const⟧ check = ⟦k|await⟧ naleko.checks.⟦f|run⟧({\n  employee: ⟦s|\'John Doe\'⟧,\n  documents: [⟦s|\'id\'⟧, ⟦s|\'matric\'⟧, ⟦s|\'bank_letter\'⟧],\n  approver: ⟦s|\'Jane Smith\'⟧\n});\n⟦c|// check.status → "waiting_for_approval"⟧\n⟦c|// check.flags  → ["uif_reference_missing"]⟧' },
  mcp: { file: 'AI assistant · MCP', code:
    '⟦c|// An AI assistant asks Batsi through MCP⟧\n⟦f|call_tool⟧(⟦s|"list_missing_documents"⟧, {\n  team: ⟦s|"Operations"⟧,\n  due_within_days: ⟦n|7⟧\n});\n⟦c|// → John Doe: UIF reference number⟧\n⟦c|// → Candidate 3: bank letter, matric⟧\n⟦f|call_tool⟧(⟦s|"draft_reminder"⟧,\n  { to: ⟦s|"Candidate 3"⟧ });\n⟦c|// Writes wait for HR approval⟧' },
  ev: { file: 'webhook · employee.onboarded', code:
    '⟦c|// Naleko People posts each change⟧\n⟦k|POST⟧ /hooks/naleko\n{\n  ⟦s|"event"⟧: ⟦s|"employee.onboarded"⟧,\n  ⟦s|"employee"⟧: ⟦s|"John Doe"⟧,\n  ⟦s|"start_date"⟧: ⟦s|"2026-12-01"⟧,\n  ⟦s|"approved_by"⟧: ⟦s|"Jane Smith"⟧\n}\n⟦c|// → 200 OK in 182 ms⟧' },
};
interface Ch { c: string; t: string }
interface Run { c: string; t: string }
/** Flattens a source into single characters that each carry their colour. */
function chars(src: string): Ch[] {
  const out: Ch[] = [];
  const re = /⟦(\w)\|([^⟧]*)⟧/g;
  let last = 0, m: RegExpExecArray | null;
  const push = (t: string, c: string): void => { for (const ch of t) out.push({ c, t: ch }); };
  while ((m = re.exec(src))) { push(src.slice(last, m.index), ''); push(m[2], m[1]); last = re.lastIndex; }
  push(src.slice(last), '');
  return out;
}
const CHARS: Record<Tab, Ch[]> = { api: chars(SRC.api.code), mcp: chars(SRC.mcp.code), ev: chars(SRC.ev.code) };
/** The first `n` characters grouped into runs of one colour (one span each). */
function runs(cs: Ch[], n: number): Run[] {
  const out: Run[] = [];
  for (let i = 0; i < n; i++) {
    const last = out[out.length - 1];
    if (last && last.c === cs[i].c) last.t += cs[i].t; else out.push({ c: cs[i].c, t: cs[i].t });
  }
  return out;
}

/**
 * The landing page's Integrations section: a dark code editor that types itself in (17ms a character, 170ms a new line) with three tabs
 * (REST API, MCP server, Events); the Naleko People panel beside it reacts as the code lands, then the next tab plays. A violet light and
 * graph paper follow a mouse pointer, or drift on their own (transform only). The menu's MCP server and Events links switch the tab.
 * Timings and words are the approved page's (the kit's). Spec: SITE-04, kit: project/components/site/site-integrations.md, site-editor.md, site-connect.md
 */
@Component({
  selector: 'section[ppSiteLandIntegrations]',
  imports: [PpIcon, PpSiteReveal],
  providers: [DemoClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<span class="pp-site-section__anchor" id="mcp" aria-hidden="true"></span>
<span class="pp-site-section__anchor" id="events" aria-hidden="true"></span>
<div class="pp-site-glow" aria-hidden="true"><div class="pp-site-glow__grid"></div></div>
<div class="pp-site-wrap">
  <div class="pp-site-section__head">
    <div>
      <p class="pp-site-eyebrow" [ppSiteReveal]="0">Integrations</p>
      <h2 class="pp-site-section__title" id="integrations-title" [ppSiteReveal]="1">Batsi works inside existing systems.</h2>
    </div>
    <p class="pp-site-section__lead" [ppSiteReveal]="2">Naleko People connects to HR, payroll and finance systems through a REST API, an MCP server and events. Keys are issued per company. Every write from outside goes into the same approval queue as Batsi’s own suggestions.</p>
  </div>
  <div class="pp-site-integrations" [ppSiteReveal]="2">
    <div class="pp-site-editor">
      <div class="pp-site-editor__bar"><span class="pp-site-editor__dot"></span><span class="pp-site-editor__dot"></span><span class="pp-site-editor__dot"></span><span class="pp-site-editor__file">{{ file() }}</span></div>
      <div class="pp-site-editor__tabs" role="tablist" aria-label="Ways to connect">
        @for (t of tabs; track t.k) {
          <button class="pp-site-editor__tab" type="button" role="tab" [id]="'integrations-tab-' + t.k" [attr.aria-controls]="'integrations-panel-' + t.k" [attr.aria-selected]="tab() === t.k" [attr.tabindex]="tab() === t.k ? 0 : -1" (click)="choose(t.k)" (keydown)="key($event, $index)"><span class="pp-site-editor__label">{{ t.label }}</span><span class="pp-site-editor__label pp-site-editor__label--on" aria-hidden="true">{{ t.label }}</span></button>
        }
      </div>
      <pre class="pp-site-editor__code" aria-label="Sample code">@for (r of code(); track $index) {@if (r.c) {<span [class]="'pp-site-editor__' + r.c">{{ r.t }}</span>} @else {{{ r.t }}}}@if (typing()) {<span class="pp-site-editor__caret"></span>}</pre>
      <div class="pp-site-editor__foot"><span class="pp-site-editor__live"></span><span>Per-company key · Sample data</span>
        <button class="pp-site-editor__again" type="button" (click)="again()"><svg ppIcon="rotate-ccw" />Play again</button>
      </div>
    </div>
    <div class="pp-site-integrations__side">
      <div class="pp-site-connect" role="tabpanel" id="integrations-panel-api" aria-labelledby="integrations-tab-api" [hidden]="tab() !== 'api'">
        <div class="pp-site-connect__head"><span class="pp-site-connect__title">Approval queue</span><span class="pp-site-connect__note">Naleko People</span></div>
        <div class="pp-site-connect__body">
          <p class="pp-site-connect__idle" [hidden]="steps().api > 0">Waiting for a request.</p>
          <div class="pp-site-connect__item" [class.pp-site-connect__item--in]="steps().api >= 1"><span class="pp-site-connect__name">Check documents · John Doe</span>
            <span class="pp-site-state" role="status"><span class="pp-site-status pp-site-status--warning pp-site-state__item" [class.pp-site-state__item--on]="!approved()" [attr.aria-hidden]="approved() ? 'true' : null">Waiting for approval</span><span class="pp-site-status pp-site-status--brand pp-site-state__item" [class.pp-site-state__item--on]="approved()" [attr.aria-hidden]="approved() ? null : 'true'">Approved by Jane Smith</span></span>
            <span class="pp-site-connect__meta">From the API key “HR system sync” · 10:12</span></div>
          <div class="pp-site-connect__item pp-site-connect__item--batsi" [class.pp-site-connect__item--in]="steps().api >= 2"><span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span><span>UIF reference number missing. Reminder to John Doe drafted.</span></div>
          <div class="pp-site-connect__item" [class.pp-site-connect__item--in]="steps().api >= 3"><span class="pp-site-connect__name">Jane Smith</span>
            <span class="pp-site-state pp-site-state--start"><span class="pp-site-state__item" [class.pp-site-state__item--on]="!approved()" [attr.aria-hidden]="approved() ? 'true' : null">Review the check and the reminder</span><span class="pp-site-state__item" [class.pp-site-state__item--on]="approved()" [attr.aria-hidden]="approved() ? null : 'true'">Approved and sent, 10:14</span></span>
            <button class="pp-button pp-button--primary pp-button--small" [class.pp-button--pressed]="pressed()" [hidden]="approved()" type="button" (click)="approveNow()">Approve</button></div>
        </div>
      </div>
      <div class="pp-site-connect" role="tabpanel" id="integrations-panel-mcp" aria-labelledby="integrations-tab-mcp" [hidden]="tab() !== 'mcp'">
        <div class="pp-site-connect__head"><span class="pp-site-connect__title">AI assistant · connected</span><span class="pp-site-connect__note">Tools allowed</span></div>
        <div class="pp-site-connect__body">
          <div class="pp-site-connect__tools">
            <div class="pp-site-connect__tool" [class.pp-site-connect__tool--hit]="hit() === 1"><code class="pp-site-connect__code">list_missing_documents</code><span class="pp-site-status pp-site-status--success">Read</span></div>
            <div class="pp-site-connect__tool"><code class="pp-site-connect__code">get_leave_balance</code><span class="pp-site-status pp-site-status--success">Read</span></div>
            <div class="pp-site-connect__tool" [class.pp-site-connect__tool--hit]="hit() === 2"><code class="pp-site-connect__code">draft_reminder</code><span class="pp-site-status pp-site-status--warning">Needs approval</span></div>
          </div>
          <div class="pp-site-connect__item" [class.pp-site-connect__item--in]="steps().mcp >= 1"><span class="pp-site-connect__name">10:20</span><code class="pp-site-connect__code">list_missing_documents</code><span class="pp-site-status pp-site-status--success">2 people returned</span></div>
          <div class="pp-site-connect__item" [class.pp-site-connect__item--in]="steps().mcp >= 2"><span class="pp-site-connect__name">10:21</span><code class="pp-site-connect__code">draft_reminder</code><span>to Candidate 3</span><span class="pp-site-status pp-site-status--warning">Waiting for approval</span></div>
        </div>
      </div>
      <div class="pp-site-connect" role="tabpanel" id="integrations-panel-ev" aria-labelledby="integrations-tab-ev" [hidden]="tab() !== 'ev'">
        <div class="pp-site-connect__head"><span class="pp-site-connect__title">Event deliveries</span><span class="pp-site-connect__note">Today</span></div>
        <div class="pp-site-connect__body">
          <p class="pp-site-connect__idle" [hidden]="steps().ev > 0">No events yet today.</p>
          <div class="pp-site-connect__item" [class.pp-site-connect__item--in]="steps().ev >= 1"><code class="pp-site-connect__code">employee.onboarded</code><span class="pp-site-status pp-site-status--success">200 OK</span><span class="pp-site-connect__meta">John Doe · to the payroll system · 182 ms</span></div>
          <div class="pp-site-connect__item" [class.pp-site-connect__item--in]="steps().ev >= 2"><code class="pp-site-connect__code">leave.approved</code><span class="pp-site-status pp-site-status--success">200 OK</span><span class="pp-site-connect__meta">John Doe · to the payroll system · 164 ms</span></div>
          <div class="pp-site-connect__item" [class.pp-site-connect__item--in]="steps().ev >= 3"><code class="pp-site-connect__code">certificate.expiring</code><span class="pp-site-status pp-site-status--success">200 OK</span><span class="pp-site-connect__meta">John Doe · forklift licence · to the safety system · 171 ms</span></div>
          <p class="pp-site-connect__foot">Each delivery signed with the company’s own secret and logged.</p>
        </div>
      </div>
    </div>
  </div>
  <ul class="pp-site-caps">
    <li class="pp-site-caps__item" [ppSiteReveal]="0"><h3 class="pp-site-caps__title">REST API</h3><p class="pp-site-caps__text">Per-company keys. Read records, start checks and send documents from any HR, payroll or ERP system.</p></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="1"><h3 class="pp-site-caps__title">MCP server</h3><p class="pp-site-caps__text">AI assistants used inside the company ask Batsi for answers and drafts. Each tool allowed or blocked by the company.</p><span class="pp-lozenge pp-lozenge--agent"><svg ppIcon="sparkles" />Batsi</span></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="2"><h3 class="pp-site-caps__title">Events and webhooks</h3><p class="pp-site-caps__text">Onboarded, leave approved, certificate expiring. Each change posted to the systems that need it.</p></li>
    <li class="pp-site-caps__item" [ppSiteReveal]="3"><h3 class="pp-site-caps__title">Approval queue on every write</h3><p class="pp-site-caps__text">Writes from the API or an AI assistant wait for HR approval. Every call is in the audit log.</p></li>
  </ul>
  <div class="pp-site-soon" [ppSiteReveal]="0">
    <span class="pp-site-soon__item"><span class="pp-site-soon__name">Payroll providers</span><span class="pp-site-status">Coming soon</span></span>
    <span class="pp-site-soon__item"><span class="pp-site-soon__name">Verification providers</span><span class="pp-site-status">Coming soon</span></span>
  </div>
  <a class="pp-link pp-link--standalone" href="#docs" [ppSiteReveal]="0"><span>Read the developer documentation</span><svg ppIcon="arrow-right" /></a>
</div>
  `,
  host: { '[attr.data-site-live]': 'live() ? "" : null', 'data-live': '', id: 'api', class: 'pp-site-section pp-site-section--clip', 'aria-labelledby': 'integrations-title' },
})
export class PpSiteLandIntegrations {
  private readonly clock = inject(DemoClock);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tabs: readonly { k: Tab; label: string }[] = [{ k: 'api', label: 'REST API' }, { k: 'mcp', label: 'MCP server' }, { k: 'ev', label: 'Events' }];
  protected readonly tab = signal<Tab>('api');
  protected readonly live = signal(false);
  /** How many characters of the current tab's code are showing. The first frame is the finished REST API tab, as in the kit's markup. */
  protected readonly n = signal(CHARS.api.length);
  protected readonly typing = signal(false);
  protected readonly file = computed(() => SRC[this.tab()].file);
  protected readonly code = computed(() => runs(CHARS[this.tab()], this.n()));
  protected readonly steps = signal<Record<Tab, number>>({ api: 3, mcp: 2, ev: 3 });
  protected readonly approved = signal(true);
  protected readonly pressed = signal(false);
  protected readonly hit = signal(0);
  private auto = true;

  constructor() {
    afterNextRender(() => {
      this.live.set(true);
      this.clock.onView(this.el.querySelector('.pp-site-integrations')!, () => this.play('api'), 0.35);
      this.followLinks();
      this.followPointer();
    });
  }

  protected choose(k: Tab): void { this.auto = false; this.play(k); }
  protected again(): void { this.auto = true; this.play('api'); }

  /** Arrow keys move between the tabs and play the one they land on. */
  protected key(e: KeyboardEvent, i: number): void {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const k = this.tabs[(i + d + this.tabs.length) % this.tabs.length].k;
    this.choose(k);
    this.doc.getElementById(`integrations-tab-${k}`)?.focus();
  }

  protected approveNow(): void { this.clock.stop(); this.approve(); }
  private approve(): void { if (!this.approved()) { this.approved.set(true); this.pressed.set(false); } }

  private step(k: Tab, n: number): void { this.steps.update((s) => ({ ...s, [k]: Math.max(s[k], n) })); }

  /** After the code has typed, the panel beside it reacts. */
  private after(k: Tab): void {
    const c = this.clock;
    const next = (ms: number): void => { if (!this.auto) return; const i = ORDER.indexOf(k); if (i < ORDER.length - 1) c.at(ms, () => this.play(ORDER[i + 1])); };
    if (k === 'api') {
      c.at(300, () => this.step('api', 1)); c.at(1300, () => this.step('api', 2)); c.at(2400, () => this.step('api', 3));
      c.at(4200, () => { this.pressed.set(true); c.at(400, () => this.approve()); });
      next(7200);
    } else if (k === 'mcp') {
      c.at(200, () => { this.hit.set(1); this.step('mcp', 1); });
      c.at(1700, () => { this.hit.set(2); this.step('mcp', 2); });
      c.at(3600, () => this.hit.set(0));
      next(6200);
    } else {
      c.at(300, () => this.step('ev', 1)); c.at(1300, () => this.step('ev', 2)); c.at(2300, () => this.step('ev', 3));
    }
  }

  /** Each character takes 17ms, and a new line 170ms. */
  private play(k: Tab): void {
    const c = this.clock;
    c.stop();
    this.tab.set(k);
    this.steps.update((s) => ({ ...s, [k]: 0 }));
    this.hit.set(0);
    if (k === 'api') { this.approved.set(false); this.pressed.set(false); }
    const cs = CHARS[k];
    if (c.reduce) { this.n.set(cs.length); this.typing.set(false); this.steps.update((s) => ({ ...s, [k]: k === 'mcp' ? 2 : 3 })); if (k === 'api') this.approved.set(true); if (this.auto && k !== 'ev') this.play(ORDER[ORDER.indexOf(k) + 1]); return; }
    this.n.set(0);
    this.typing.set(true);
    let t = 0;
    cs.forEach((ch, i) => { c.at(t, () => this.n.set(i + 1)); t += ch.t === '\n' ? 170 : 17; });
    c.at(t, () => { this.typing.set(false); this.after(k); });
  }

  /** The menu's MCP server and Events links scroll here and switch the tab (also when the page opens on #mcp or #events). */
  private followLinks(): void {
    const win = this.doc.defaultView;
    if (!win) return;
    const pick = (href: string | null): Tab | null => { const m = /^#(mcp|events)$/.exec(href ?? ''); return m ? (m[1] === 'mcp' ? 'mcp' : 'ev') : null; };
    const onClick = (e: Event): void => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const k = a ? pick(a.getAttribute('href')) : null;
      if (k) setTimeout(() => this.choose(k), 0);
    };
    this.doc.addEventListener('click', onClick);
    this.destroyRef.onDestroy(() => this.doc.removeEventListener('click', onClick));
    const k = pick(win.location.hash);
    if (k) this.choose(k);
  }

  /** The violet light follows a mouse pointer; with no pointer it drifts slowly on its own. Only `transform` moves. */
  private followPointer(): void {
    const win = this.doc.defaultView;
    const sec = this.el;
    const lt = sec.querySelector<HTMLElement>('.pp-site-glow');
    const gr = sec.querySelector<HTMLElement>('.pp-site-glow__grid');
    if (!win || !lt || !gr) return;
    const R = 550, t0 = win.performance.now(), slow = this.clock.reduce ? 0.5 : 1;
    let px: [number, number] | null = null, vis = false, raf = 0;
    const put = (x: number, y: number): void => { lt.style.transform = `translate(${x - R}px,${y - R}px)`; gr.style.transform = `translate(${R - x}px,${R - y}px)`; };
    const move = (e: PointerEvent): void => { if (e.pointerType !== 'mouse') return; const r = sec.getBoundingClientRect(); px = [e.clientX - r.left, e.clientY - r.top]; put(px[0], px[1]); };
    const leave = (): void => { px = null; };
    const drift = (now: number): void => {
      raf = 0;
      if (!vis) return;
      if (!px) { const t = ((now - t0) / 1000) * slow; put(sec.clientWidth * (0.62 + 0.2 * Math.sin(t / 5)), sec.clientHeight * (0.4 + 0.16 * Math.cos(t / 6.5))); }
      raf = win.requestAnimationFrame(drift);
    };
    sec.addEventListener('pointermove', move);
    sec.addEventListener('pointerleave', leave);
    let io: IntersectionObserver | null = null;
    if ('IntersectionObserver' in win) {
      io = new win.IntersectionObserver((es) => { vis = !!es[0]?.isIntersecting; if (vis && !raf) raf = win.requestAnimationFrame(drift); });
      io.observe(sec);
    }
    this.destroyRef.onDestroy(() => { sec.removeEventListener('pointermove', move); sec.removeEventListener('pointerleave', leave); io?.disconnect(); if (raf) win.cancelAnimationFrame(raf); });
  }
}
