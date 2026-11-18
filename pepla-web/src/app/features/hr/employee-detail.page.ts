import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  PpBreadcrumbs, PpButton, PpCard, PpDescriptionList, PpEmptyState, PpEmptyStateActions, PpLink, PpLozenge, PpPersonHeader,
  PpInlineMessage, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpVerification, formatDate, mask,
  type Crumb, type DlItem, type IconName, type PersonFact, type Status,
} from '../../ds';
import { EmployeeDetailError, EmployeeDetailService } from '../../core/employees/employee-detail.service';
import { CHECK_WORD, DECISION_WORD, type Check, type EmployeeDetail, type EmployeeDocument } from '../../core/employees/employee-detail';
import { RISK_HEADING, RISK_NONE, RISK_WORD } from '../../core/employees/risk-words';
import type { Step } from '../../core/employees/employee';
import { InviteService, type InviteInfo } from '../../core/employees/invite.service';

const SOUTH_AFRICA = 'Africa/Johannesburg';
const TITLE = 'Naleko People';

const STEP_LOZENGE: Record<Step, { status: Status; icon?: IconName }> = {
  Invited: { status: 'neutral' },
  Documents: { status: 'information' },
  'In review': { status: 'warning', icon: 'clock' },
  Verified: { status: 'success', icon: 'circle-check' },
};

const RESULT: Record<Check, 'reading' | 'matches' | 'check' | 'mismatch'> = {
  READING: 'reading',
  MATCHES: 'matches',
  NEEDS_A_LOOK: 'check',
  DOESNT_MATCH: 'mismatch',
};

/** "9 Nov 2026" on the South African calendar day of an ISO time. */
function dayOf(iso: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: SOUTH_AFRICA }).format(new Date(iso));
  return formatDate(`${day}T12:00:00`, { year: true });
}

const WHEN = new Intl.DateTimeFormat('en-GB', { timeZone: SOUTH_AFRICA, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
/** "11 Nov 2026, 14:32" in South Africa time. */
function when(iso: string): string {
  const parts = Object.fromEntries(WHEN.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${parts['day']} ${String(parts['month']).replace('Sept', 'Sep')} ${parts['year']}, ${parts['hour']}:${parts['minute']}`;
}

/**
 * One new employee: who they are, their step, and every document with Batsi's check and HR's decision.
 * The ID number shows its last four digits until HR presses Show. Reads one answer from the document
 * upload API and calls nothing else.
 */
@Component({
  selector: 'app-employee-detail',
  imports: [
    RouterLink, PpBreadcrumbs, PpButton, PpCard, PpDescriptionList, PpEmptyState, PpEmptyStateActions, PpLink, PpLozenge, PpPersonHeader,
    PpInlineMessage, PpSectionMessage, PpSectionMessageActions, PpSkeleton, PpSkeletonGroup, PpVerification,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-stack pp-gap-300">
      <pp-breadcrumbs [items]="crumbs" />

      @switch (status()) {
        @case ('loading') {
          <pp-skeleton-group label="Loading this employee" class="pp-stack pp-gap-200">
            <pp-skeleton shape="avatar" />
            <pp-skeleton shape="heading" width="40%" />
            <pp-skeleton shape="text" width="60%" />
            <pp-skeleton shape="text" width="50%" />
          </pp-skeleton-group>
          <pp-skeleton-group label="Loading documents" class="pp-stack pp-gap-200">
            @for (n of placeholders; track n) { <pp-skeleton shape="card" /> }
          </pp-skeleton-group>
        }
        @case ('not-found') {
          <pp-empty-state heading="This employee could not be found.">
            <pp-empty-state-actions>
              <a ppLink routerLink="/hr">Back to Home</a>
            </pp-empty-state-actions>
          </pp-empty-state>
        }
        @case ('failed') {
          <pp-section-message tone="danger" heading="This employee could not be loaded.">
            Check your connection and try again.
            <pp-section-message-actions>
              <button ppButton type="button" (click)="load()">Try again</button>
            </pp-section-message-actions>
          </pp-section-message>
        }
        @default {
          @if (person(); as p) {
            <pp-person-header [name]="p.name" [role]="p.jobTitle" [facts]="facts()">
              @if (p.step; as step) {
                <pp-lozenge [status]="stepLozenge(step).status" [icon]="stepLozenge(step).icon">{{ step }}</pp-lozenge>
              }
            </pp-person-header>

            @if (p.risk; as r) {
              @if (r.band; as band) {
                <pp-section-message [tone]="riskWord[band].tone" [heading]="riskHeading">
                  {{ riskWord[band].text }}{{ r.assessedAt ? ' on ' + when(r.assessedAt) : '' }}.
                  @if (r.reason) { {{ r.reason }} }
                </pp-section-message>
              } @else {
                <pp-section-message tone="information" [heading]="riskHeading">{{ riskNone }}</pp-section-message>
              }
            }

            @if (invite(); as inv) {
              <pp-card heading="Invite link" [level]="2">
                <div class="pp-stack pp-gap-200">
                  <p class="pp-text">{{ firstName(p) }} sets their own password from this link</p>
                  <div aria-live="polite">
                    @if (inv.status !== 'none') { <pp-description-list [items]="inviteItems(inv)" /> }
                    @if (notSent()) { <pp-inline-message tone="error">The welcome email was not sent.</pp-inline-message> }
                  </div>
                  @if (inv.status !== 'none') { <p class="pp-text">Resending closes this link and sends a new one that works for 7 days.</p> }
                  <div><button ppButton type="button" size="large" [busy]="sending()" [disabled]="sending()" (click)="resend(p.id)">Resend link</button></div>
                </div>
              </pp-card>
            }

            <section class="pp-stack pp-gap-200" aria-labelledby="documents-heading">
              <h2 id="documents-heading" class="pp-heading pp-heading--medium">Documents</h2>
              @for (group of p.byType; track group.type) {
                @for (d of group.documents; track d.id) {
                  <pp-verification [heading]="group.name" [subheading]="d.fileName + ' · Uploaded ' + day(d.uploadedAt)" [result]="result(d)">
                    <div class="pp-stack pp-gap-100">
                      @if (group.required) { <div><pp-lozenge status="neutral">Required</pp-lozenge></div> }
                      <a ppLink [routerLink]="['/hr/documents', d.id]" [state]="{ employeeId: p.id }">Open {{ group.name }}</a>
                      <p class="pp-text">Check: {{ checkWord(d) }}</p>
                      <p class="pp-text">HR decision: {{ decisionText(d) }}</p>
                      @if (idItems(p, d); as items) { <pp-description-list [items]="items" /> }
                    </div>
                  </pp-verification>
                } @empty {
                  <pp-card [heading]="group.name" [level]="3">
                    @if (group.required) { <div><pp-lozenge status="neutral">Required</pp-lozenge></div> }
                    <p class="pp-text pp-text--subtle">Not uploaded yet</p>
                  </pp-card>
                }
              }
            </section>
          }
        }
      }
    </div>
  `,
})
export class EmployeeDetailPage {
  private readonly service = inject(EmployeeDetailService);
  private readonly title = inject(Title);
  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((m) => m.get('id') ?? '')), { initialValue: '' });

  protected readonly riskWord = RISK_WORD;
  protected readonly riskHeading = RISK_HEADING;
  protected readonly riskNone = RISK_NONE;
  protected readonly when = when;
  protected readonly crumbs: Crumb[] = [{ label: 'Home', link: '/hr' }];
  protected readonly placeholders = [1, 2, 3, 4];
  protected readonly status = signal<'loading' | 'ready' | 'not-found' | 'failed'>('loading');
  protected readonly person = signal<EmployeeDetail | null>(null);
  private readonly invites = inject(InviteService);
  protected readonly invite = signal<InviteInfo | null>(null);
  protected readonly sending = signal(false);
  protected readonly notSent = signal(false);

  protected readonly facts = computed<PersonFact[]>(() => {
    const p = this.person();
    if (!p) return [];
    const facts: PersonFact[] = [];
    if (p.department) facts.push({ icon: 'building-2', text: p.department, hiddenLabel: 'Department:' });
    if (p.email) facts.push({ icon: 'mail', text: p.email, hiddenLabel: 'Email:' });
    if (p.phone) facts.push({ icon: 'phone', text: p.phone, hiddenLabel: 'Phone:' });
    facts.push({ icon: 'hash', text: p.id, hiddenLabel: 'Employee ID:' });
    facts.push({ icon: 'calendar-days', text: p.startDate ? `Starts ${formatDate(`${p.startDate}T12:00:00`, { year: true })}` : 'Start date not set' });
    facts.push({ icon: 'user-round', text: p.hrPartner ? `HR partner: ${p.hrPartner}` : 'HR partner not assigned' });
    return facts;
  });

  constructor() {
    effect(() => {
      this.id();
      void this.load();
    });
  }

  protected async load(): Promise<void> {
    const id = this.id();
    this.status.set('loading');
    this.person.set(null);
    try {
      const person = await this.service.load(id);
      if (id !== this.id()) return;
      this.person.set(person);
      this.title.setTitle(`${person.name} · ${TITLE}`);
      this.status.set('ready');
      this.invite.set(null);
      this.notSent.set(false);
      if (person.step === 'Invited') {
        const inv = await this.invites.load(id);
        if (id === this.id() && inv && (inv.status === 'ok' || inv.status === 'expired' || inv.status === 'none')) {
          this.invite.set(inv);
          this.notSent.set(inv.status === 'none');
        }
      }
    } catch (err) {
      if (id !== this.id()) return;
      this.title.setTitle(`Employee · ${TITLE}`);
      this.status.set(err instanceof EmployeeDetailError && err.reason === 'not-found' ? 'not-found' : 'failed');
    }
  }

  protected firstName(p: EmployeeDetail): string {
    return p.name.split(' ')[0] ?? '';
  }

  protected inviteItems(inv: InviteInfo): DlItem[] {
    return [
      { term: 'Link sent', value: `${when(inv.sentAt!)}, to ${inv.sentTo ?? ''}` },
      { term: inv.status === 'expired' ? 'Link expired' : 'Link expires', value: when(inv.expiresAt!) },
    ];
  }

  protected async resend(id: string): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    const r = await this.invites.resend(id);
    this.sending.set(false);
    if (id !== this.id()) return; // HR moved to another person while the call was out
    if (r.kind === 'not-invited') { void this.load(); return; }
    if (r.kind === 'failed') { this.notSent.set(true); return; }
    this.invite.set({ status: 'ok', sentAt: r.sentAt, expiresAt: r.expiresAt, sentTo: r.sentTo });
    this.notSent.set(!r.emailSent && !r.skipped);
  }

  protected stepLozenge(step: Step) {
    return STEP_LOZENGE[step];
  }

  protected result(d: EmployeeDocument) {
    return RESULT[d.check];
  }

  protected checkWord(d: EmployeeDocument): string {
    return CHECK_WORD[d.check];
  }

  protected day(iso: string): string {
    return iso ? dayOf(iso) : 'date not known';
  }

  protected decisionText(d: EmployeeDocument): string {
    if (!d.decision) return 'Not decided';
    return d.decidedAt ? `${DECISION_WORD[d.decision]}, ${dayOf(d.decidedAt)}` : DECISION_WORD[d.decision];
  }

  /** The ID number on a National ID card: its last four digits, with Show when the full number is there. */
  protected idItems(p: EmployeeDetail, d: EmployeeDocument): DlItem[] | null {
    if (d.type !== 'NATIONAL_ID') return null;
    if (d.idAvailable && d.idLast4) return [{ term: 'ID number', value: null, reveal: { record: p.name, ref: { documentId: d.id, employeeId: p.id, field: 'id_number' }, masked: mask(`xxxxxxxxx${d.idLast4}`), maskedLabel: 'ID number', notice: true } }];
    if (d.idLast4) return [{ term: 'ID number', value: `${'•'.repeat(9)}${d.idLast4}` }];
    return null;
  }
}
