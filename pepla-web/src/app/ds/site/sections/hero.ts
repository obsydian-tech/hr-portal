import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { PpIcon } from '../../core/icon';
import { DemoClock } from '../demo-clock';
import { PpSiteHero } from '../hero';
import { SiteLight } from '../lights';

type Peek = { id: number; who: 'me' | 'ai' | 'typing'; text?: string; act?: boolean };
let ids = 0;

/** The three lights behind the landing headline, as the kit's landing page places them. */
export const LANDING_LIGHTS: readonly SiteLight[] = [
  { tone: 'violet', x: '62%', y: '30%', size: '44cqw', index: 0 },
  { tone: 'mint', x: '86%', y: '78%', size: '34cqw', index: 1 },
  { tone: 'coral', x: '18%', y: '78%', size: '36cqw', index: 2 },
];
/** The same three lights placed for a phone (the kit places them separately at 390px). */
export const LANDING_LIGHTS_PHONE: readonly SiteLight[] = [
  { tone: 'violet', x: '70%', y: '22%', size: '70cqw', index: 0 },
  { tone: 'mint', x: '90%', y: '85%', size: '60cqw', index: 1 },
  { tone: 'coral', x: '10%', y: '75%', size: '60cqw', index: 2 },
];

/**
 * The landing page's hero and its Ask Batsi peek: the Ask Batsi button opens a small chat panel that plays a short sample
 * conversation (the visitor's question at 0.2s, Batsi typing 0.9s before each answer); the close button shuts it and puts
 * focus back on the button. Words and timings are the kit's (site-hero, site-peek). The hero's own words are the kit's too.
 * Spec: SITE-03, kit: project/components/site/site-peek.md
 */
@Component({
  selector: 'div[ppSiteLandHero]',
  imports: [PpIcon, PpSiteHero],
  providers: [DemoClock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section ppSiteHero id="main" reveal [lights]="lights()" [chips]="chips" eyebrow="People, risk and compliance platform" line="Every employee"
      accent="hired, onboarded and compliant." lead="One employee record across every module, with Batsi doing the follow-ups and checks in between.">
      <p ppHeroIntro><strong>Naleko People</strong> runs recruitment, onboarding, leave and compliance for South African organisations. Batsi follows up, reads documents and flags risks. HR approves every action.</p>
      <a class="pp-site-button pp-site-button--dark pp-site-button--large" href="#demo"><span>Book a demo</span><svg ppIcon="arrow-right" /></a>
      <button #opener class="pp-site-button pp-site-button--line pp-site-button--large" type="button" aria-controls="hero-peek" [attr.aria-expanded]="open()" (click)="toggle()"><svg ppIcon="sparkles" />Ask Batsi</button>
    </section>
    <div class="pp-site-peek pp-site-chat" [class.pp-site-peek--open]="open()" id="hero-peek" role="dialog" aria-label="Ask Batsi, sample conversation" [attr.aria-hidden]="open() ? null : 'true'" [attr.inert]="open() ? null : ''">
      <div class="pp-site-chat__top">
        <span class="pp-site-chat__name"><svg ppIcon="sparkles" />Ask Batsi</span>
        <span class="pp-site-chat__note">Sample data</span>
        <button class="pp-button pp-button--default pp-button--icon pp-button--small pp-site-peek__close" type="button" aria-label="Close" (click)="close()"><svg ppIcon="x" /></button>
      </div>
      <div class="pp-site-chat__body" aria-live="polite">
        @for (m of lines(); track m.id) {
          @switch (m.who) {
            @case ('me') { <div class="pp-site-chat__msg pp-site-chat__msg--me">{{ m.text }}</div> }
            @case ('typing') { <span class="pp-site-chat__typing"><i></i><i></i><i></i></span> }
            @case ('ai') {
              <div class="pp-site-chat__msg pp-site-chat__msg--ai"><span class="pp-site-chat__who"><svg ppIcon="sparkles" />Batsi</span>{{ m.text }}
                @if (m.act) {
                  <div class="pp-site-chat__actions">
                    <button class="pp-button pp-button--primary pp-button--small" type="button" (click)="answer(m.id, true)">Send reminder</button>
                    <button class="pp-button pp-button--default pp-button--small" type="button" (click)="answer(m.id, false)">Not now</button>
                  </div>
                }
              </div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class PpSiteLandHero {
  private readonly clock = inject(DemoClock);
  private readonly opener = viewChild.required<ElementRef<HTMLButtonElement>>('opener');
  /** Where the lights sit; the page passes the phone set under 768px. */
  readonly lights = input<readonly SiteLight[]>(LANDING_LIGHTS);
  protected readonly chips = ['BCEA', 'UIF', 'SARS', 'POPIA'];
  protected readonly open = signal(false);
  protected readonly lines = signal<Peek[]>([]);

  protected toggle(): void { this.open() ? this.hide() : this.show(); }
  protected close(): void { this.hide(); this.opener().nativeElement.focus(); }

  private show(): void { this.open.set(true); this.play(); }
  private hide(): void { this.open.set(false); this.clock.stop(); }

  private add(m: Omit<Peek, 'id'>): number { const id = ++ids; this.lines.update((l) => [...l, { ...m, id }]); return id; }

  /** The visitor's question at 0.2s, Batsi typing for 0.9s before each answer, the next 0.5s later. */
  private play(): void {
    const c = this.clock;
    c.stop();
    this.lines.set([]);
    c.at(200, () => this.add({ who: 'me', text: 'Who hasn’t sent their documents?' }));
    const reply = (at: number, text: string, act: boolean): void => {
      c.at(at, () => this.add({ who: 'typing' }));
      c.at(at + 900, () => { this.lines.update((l) => l.filter((m) => m.who !== 'typing')); this.add({ who: 'ai', text, act }); });
    };
    reply(900, 'John Doe is missing his UIF reference number. A reminder went out today at 09:00.', false);
    reply(900 + 900 + 500, 'Send another reminder now?', true);
  }

  protected answer(id: number, sent: boolean): void {
    this.lines.update((l) => l.map((m) => (m.id === id ? { ...m, act: false } : m)));
    this.add({ who: 'me', text: sent ? 'Send reminder' : 'Not now' });
    this.clock.at(600, () => this.add({ who: 'ai', text: sent ? 'Sent to John Doe at 09:42. Logged as approved by you.' : 'Okay. I’ll remind you tomorrow at 09:00.' }));
  }
}
