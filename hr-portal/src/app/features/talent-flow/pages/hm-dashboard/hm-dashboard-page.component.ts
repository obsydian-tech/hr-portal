import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';

import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { CardModule } from 'primeng/card';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { TalentFlowAuthService } from '../../services/talent-flow-auth.service';
import { IntelligenceService } from '../../services/intelligence.service';
import { AuthService } from '../../../../core/services/auth.service';
import { HmTaskCardComponent } from '../../components/hm-task-card/hm-task-card.component';
import { IntelligenceTileComponent } from '../../components/intelligence-tile/intelligence-tile.component';
import { Candidate, IntelligenceTile, TileAction } from '../../models/talent-flow.models';

/**
 * HM Dashboard — D044–D051
 * 3-tab view: My Tasks | My Candidates | Decisions
 * Loads only candidates where hiringManagerId matches the logged-in HM's sub.
 */
@Component({
  selector: 'tf-hm-dashboard-page',
  standalone: true,
  imports: [Tabs, TabList, Tab, TabPanels, TabPanel, ProgressSpinnerModule, CardModule, HmTaskCardComponent, IntelligenceTileComponent, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hm-dashboard">

      <div class="hm-dashboard__header">
        <h1 class="hm-dashboard__title">My Hiring Dashboard</h1>
        <p class="hm-dashboard__sub">
          Hello{{ currentUser()?.givenName ? ', ' + currentUser()!.givenName : '' }} —
          you have {{ taskCandidates().length }} active candidate{{ taskCandidates().length === 1 ? '' : 's' }}.
        </p>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════════
           ZONE 0 — Intelligence Alerts (Phase 6.3)
      ═══════════════════════════════════════════════════════════════════════ -->
      @if (intelligence.hasTiles()) {
        <p-card styleClass="hm-zone-0">
          <div class="hm-zone-0__head">
            <i class="pi pi-bolt hm-zone-0__icon"></i>
            <h2 class="hm-zone-0__title">Intelligence Alerts</h2>
            <div class="hm-zone-0__badges">
              @if (intelligence.criticalCount() > 0) {
                <span class="hm-badge hm-badge--red">{{ intelligence.criticalCount() }} critical</span>
              }
              @if (intelligence.highCount() > 0) {
                <span class="hm-badge hm-badge--amber">{{ intelligence.highCount() }} high</span>
              }
            </div>
            @if (intelligence.tilesCount() > 3) {
              <button class="hm-link-btn" (click)="viewAllTiles()">View all {{ intelligence.tilesCount() }} →</button>
            }
          </div>
          <div class="hm-tiles">
            @for (tile of intelligence.tiles().slice(0, 3); track tile.id) {
              <tf-intelligence-tile
                [tile]="tile"
                (actionClicked)="handleTileAction($event)"
                (dismissed)="handleTileDismiss($event)"
                (snoozed)="handleTileSnooze($event)"
              />
            }
          </div>
        </p-card>
      }

      <p-tabs [value]="activeTab()" (valueChange)="setActiveTab($event)">

        <p-tablist>
          <p-tab value="tasks">My Tasks</p-tab>
          <p-tab value="candidates">My Candidates</p-tab>
          <p-tab value="decisions">Decisions</p-tab>
        </p-tablist>

        <p-tabpanels>

          <!-- ── My Tasks ─────────────────────────────────────────────── -->
          <p-tabpanel value="tasks">
            @if (loading()) {
              <div class="hm-loading">
                <p-progressSpinner strokeWidth="3" />
              </div>
            } @else if (loadError()) {
              <div class="hm-error">
                <i class="pi pi-exclamation-triangle"></i>
                <p>{{ loadError() }}</p>
              </div>
            } @else if (taskCandidates().length === 0) {
              <div class="hm-empty">
                <i class="pi pi-inbox"></i>
                <p>No active tasks — all candidates are up to date.</p>
              </div>
            } @else {
              <div class="hm-task-list">
                @for (c of taskCandidates(); track c.id) {
                  <tf-hm-task-card
                    [candidate]="c"
                    [voted]="evaluatedCandidateIds().has(c.id)"
                    (voteSubmitted)="onVoteSubmitted($event)"
                  />
                }
              </div>
            }
          </p-tabpanel>

          <!-- ── My Candidates ─────────────────────────────────────── -->
          <p-tabpanel value="candidates">
            @if (loading()) {
              <div class="hm-loading"><p-progressSpinner strokeWidth="3" /></div>
            } @else if (allCandidates().length === 0) {
              <div class="hm-empty">
                <i class="pi pi-users"></i>
                <p>No candidates assigned to you yet.</p>
              </div>
            } @else {
              <div class="hm-candidate-list">
                @for (c of allCandidates(); track c.id) {
                  <div class="hm-candidate-row hm-candidate-row--clickable"
                    [routerLink]="['/platform/talentflow/candidates', c.id]">
                    <div class="hm-candidate-row__avatar">{{ candidateInitials(c) }}</div>
                    <div class="hm-candidate-row__info">
                      <span class="hm-candidate-row__name">{{ c.firstName }} {{ c.lastName }}</span>
                      <span class="hm-candidate-row__role">{{ c.role }}</span>
                    </div>
                    <span class="hm-candidate-row__stage">{{ stageLabel(c.currentStage) }}</span>
                    <span class="hm-candidate-row__sla hm-candidate-row__sla--{{ c.slaStatus ?? 'ON_TRACK' }}">●</span>
                  </div>
                }
              </div>
            }
          </p-tabpanel>

          <!-- ── Decisions ─────────────────────────────────────────── -->
          <p-tabpanel value="decisions">
            @if (decisionCandidates().length === 0) {
              <div class="hm-empty">
                <i class="pi pi-check-circle"></i>
                <p>No evaluation results yet.</p>
                <p style="font-size:0.8125rem;margin-top:0.25rem">Completed evaluations will appear here once all votes are in.</p>
              </div>
            } @else {
              <div class="hm-candidate-list">
                @for (c of decisionCandidates(); track c.id) {
                  <div class="hm-candidate-row hm-candidate-row--clickable"
                    [routerLink]="['/platform/talentflow/candidates', c.id]">
                    <div class="hm-candidate-row__avatar">{{ candidateInitials(c) }}</div>
                    <div class="hm-candidate-row__info">
                      <span class="hm-candidate-row__name">{{ c.firstName }} {{ c.lastName }}</span>
                      <span class="hm-candidate-row__role">{{ c.role }}</span>
                    </div>
                    <span class="hm-candidate-row__result"
                      [class.hm-candidate-row__result--passed]="isResultPassed(c.evaluationResult!)"
                      [class.hm-candidate-row__result--failed]="!isResultPassed(c.evaluationResult!)">
                      {{ resultLabel(c.evaluationResult!) }}
                    </span>
                  </div>
                }
              </div>
            }
          </p-tabpanel>

        </p-tabpanels>
      </p-tabs>

    </div>
  `,
  styles: [`
    .hm-dashboard {
      max-width: 800px;
      margin: 0 auto;
      padding: 1.5rem 1rem;
    }

    .hm-dashboard__header { margin-bottom: 1.5rem; }

    .hm-dashboard__title {
      font-family: var(--naleko-font-display);
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--naleko-on-surface);
      margin: 0 0 0.375rem;
      letter-spacing: -0.01em;
    }

    .hm-dashboard__sub {
      font-size: 0.875rem;
      color: var(--naleko-on-surface-variant);
      margin: 0;
    }

    .hm-loading {
      display: flex;
      justify-content: center;
      padding: 3rem 0;
    }

    .hm-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 3rem 0;
      color: var(--naleko-on-surface-variant);
      text-align: center;
    }

    .hm-empty i { font-size: 2rem; }
    .hm-empty p { margin: 0; font-size: 0.9375rem; }

    .hm-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2rem 0;
      color: var(--naleko-danger);
      text-align: center;
    }

    .hm-task-list { padding-top: 1rem; }
    .hm-candidate-list { padding-top: 1rem; }

    .hm-candidate-row {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      padding: 0.875rem 1rem;
      background: var(--naleko-surface-container-lowest);
      border: 1.5px solid rgba(200, 197, 205, 0.2);
      border-radius: var(--naleko-radius-lg);
      box-shadow: var(--naleko-shadow-card);
      margin-bottom: 0.625rem;
      transition:
        border-color var(--naleko-duration) var(--naleko-ease),
        box-shadow var(--naleko-duration) var(--naleko-ease);
    }

    .hm-candidate-row--clickable {
      cursor: pointer;
      text-decoration: none;
    }

    .hm-candidate-row--clickable:hover {
      border-color: color-mix(in srgb, var(--naleko-secondary) 30%, transparent);
      box-shadow: var(--naleko-shadow-lg);
    }

    .hm-candidate-row__avatar {
      width: 36px;
      height: 36px;
      min-width: 36px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--naleko-secondary) 13%, transparent);
      color: var(--naleko-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      font-weight: 700;
    }

    .hm-candidate-row__info { flex: 1; }

    .hm-candidate-row__name {
      display: block;
      font-weight: 600;
      font-size: 0.9375rem;
      color: var(--naleko-on-surface);
    }

    .hm-candidate-row__role {
      display: block;
      font-size: 0.8125rem;
      color: var(--naleko-on-surface-variant);
      margin-top: 0.125rem;
    }

    .hm-candidate-row__stage {
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      padding: 0.2rem 0.6rem;
      border-radius: var(--naleko-radius-pill);
      background: color-mix(in srgb, var(--naleko-secondary) 10%, transparent);
      color: var(--naleko-secondary);
      white-space: nowrap;
    }

    .hm-candidate-row__result {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.25rem 0.625rem;
      border-radius: var(--naleko-radius-pill);
      white-space: nowrap;
    }

    .hm-candidate-row__result--passed {
      background: color-mix(in srgb, var(--naleko-success) 13%, transparent);
      color: var(--naleko-success);
    }

    .hm-candidate-row__result--failed {
      background: color-mix(in srgb, var(--naleko-danger) 12%, transparent);
      color: var(--naleko-danger);
    }

    .hm-candidate-row__sla { font-size: 0.625rem; }
    .hm-candidate-row__sla--ON_TRACK { color: var(--naleko-success); }
    .hm-candidate-row__sla--AT_RISK  { color: var(--naleko-warning); }
    .hm-candidate-row__sla--BREACHED { color: var(--naleko-danger); }

    :host ::ng-deep .p-tabs .p-tab[aria-selected="true"] {
      color: var(--naleko-secondary);
      border-color: var(--naleko-secondary);
    }

    :host ::ng-deep .p-tabs .p-tablist-active-bar {
      background: var(--naleko-secondary);
    }

    /* ── Zone 0: Intelligence Alerts (Phase 6.3) ─────────────────────────── */
    :host ::ng-deep .hm-zone-0 {
      &.p-card {
        background: var(--naleko-surface-container-lowest) !important;
        border: none !important;
        box-shadow: var(--naleko-shadow-card) !important;
        border-radius: var(--naleko-radius-xl);
        padding: 1.25rem 1.5rem;
        margin-bottom: 1.5rem;
        border-left: 3px solid var(--naleko-secondary);
      }
      .p-card-body, .p-card-content { padding: 0 !important; }
    }

    .hm-zone-0__head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }

    .hm-zone-0__icon {
      font-size: 1rem;
      color: var(--naleko-secondary);
    }

    .hm-zone-0__title {
      font-family: var(--naleko-font-display);
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--naleko-on-surface);
      margin: 0;
      flex-shrink: 0;
    }

    .hm-zone-0__badges {
      display: flex;
      gap: 0.4rem;
    }

    .hm-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 9px;
      border-radius: var(--naleko-radius-pill);
      font-size: 0.68rem;
      font-weight: 700;
      line-height: 1.6;
    }

    .hm-badge--red {
      background: color-mix(in srgb, var(--naleko-error) 15%, transparent);
      color: var(--naleko-error);
    }

    .hm-badge--amber {
      background: color-mix(in srgb, var(--naleko-warning) 18%, transparent);
      color: var(--naleko-warning-dark, var(--naleko-warning));
    }

    .hm-link-btn {
      background: none;
      border: none;
      padding: 0;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--naleko-primary);
      cursor: pointer;
      margin-left: auto;
      white-space: nowrap;
    }

    .hm-link-btn:hover { text-decoration: underline; }

    .hm-tiles {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
  `],
})
export class HmDashboardPageComponent implements OnInit {
  private readonly api          = inject(TalentFlowApiService);
  protected readonly tfAuth     = inject(TalentFlowAuthService);
  protected readonly intelligence = inject(IntelligenceService);
  private readonly nalekoAuth   = inject(AuthService);
  private readonly router       = inject(Router);
  private readonly route        = inject(ActivatedRoute);

  protected readonly activeTab            = signal<string>('tasks');
  protected readonly loading              = signal(true);
  protected readonly loadError            = signal('');
  private readonly candidates             = signal<Candidate[]>([]);
  // Tracks candidate IDs the HM has voted on this session — prevents re-evaluation
  protected readonly evaluatedCandidateIds  = signal<Set<string>>(new Set());

  constructor() {
    // Read ?tab= query param to activate correct tab on direct navigation
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    if (tabParam) this.activeTab.set(tabParam);
    // nalekoAuth.checkSession() already ran via APP_INITIALIZER before routing
    this.loadCandidates();
  }

  ngOnInit(): void {
    // Load intelligence tiles for HM role
    this.intelligence.loadTiles('HM');
  }

  protected readonly currentUser = computed(() =>
    this.tfAuth.currentUser() ?? (this.nalekoAuth.currentUser() as any),
  );
  protected readonly taskCandidates    = computed(() =>
    this.candidates().filter((c) =>
      // Option E: remove from queue once evaluationResult is written by completeEvaluation
      !c.evaluationResult &&
      ['INTERVIEWING', 'EVALUATION'].includes(c.currentStage),
    ),
  );
  protected readonly allCandidates     = this.candidates.asReadonly();
  // Show candidates where evaluation has completed — HM can see the outcome
  protected readonly decisionCandidates = computed(() =>
    this.candidates().filter((c) => !!c.evaluationResult),
  );

  protected setActiveTab(val: string | number): void {
    this.activeTab.set(String(val));
  }

  protected onVoteSubmitted(candidateId: string): void {
    // Mark as voted in this session immediately so the badge shows
    this.evaluatedCandidateIds.update(set => {
      const next = new Set(set);
      next.add(candidateId);
      return next;
    });
    // Delay refresh to give completeEvaluation Lambda time to propagate
    setTimeout(() => this.loadCandidates(), 2500);
  }

  protected resultLabel(result: string): string {
    const labels: Record<string, string> = {
      PASSED:            'Evaluation Passed',
      FAILED:            'Evaluation Failed',
      STRONG_NO_VETO:    'Strong No — Vetoed',
      EVALUATION_FAILED: 'Evaluation Failed',
    };
    return labels[result] ?? result;
  }

  protected isResultPassed(result: string): boolean {
    return result === 'PASSED';
  }

  protected stageLabel(stage: string): string {
    const labels: Record<string, string> = {
      APPLICATION_REVIEW:  'Application Review',
      SCREENING:           'Screening',
      INTERVIEWING:        'Interviewing',
      TECHNICAL_INTERVIEW: 'Technical Interview',
      EVALUATION:          'Evaluation',
      BACKGROUND_CHECK:    'Background Check',
      OFFER_PREPARATION:   'Offer Preparation',
      OFFER_ACCEPTED:      'Offer Accepted',
      OFFER_DECLINED:      'Offer Declined',
      ONBOARDING:          'Onboarding',
      WITHDRAWN:           'Withdrawn',
      REJECTED:            'Rejected',
    };
    return labels[stage] ?? stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  protected candidateInitials(c: Candidate): string {
    return ((c.firstName?.[0] ?? '') + (c.lastName?.[0] ?? '')).toUpperCase();
  }

  private loadCandidates(): void {
    this.loading.set(true);
    this.loadError.set('');
    const nalekoUser = this.nalekoAuth.currentUser();
    // After pool consolidation, the DynamoDB hiringManagerId is the Naleko Cognito sub.
    // TalentFlowAuthService is a separate pool no longer used for API auth.
    const hmId = nalekoUser?.sub ?? '';
    if (!hmId) {
      this.loadError.set('Could not identify your account. Please sign in again.');
      this.loading.set(false);
      return;
    }
    this.api.getCandidates({ hiringManagerId: hmId }).subscribe({
      next: (res) => {
        this.candidates.set(res.candidates);
        this.loading.set(false);
      },
      error: (err: { message?: string }) => {
        this.loadError.set(err?.message ?? 'Failed to load candidates.');
        this.loading.set(false);
      },
    });
  }

  // ── Intelligence tile handlers (Zone 0) ─────────────────────────────────────

  protected handleTileAction(event: { action: TileAction; tile: IntelligenceTile }): void {
    const { action, tile } = event;
    if (action.route) {
      void this.router.navigate([action.route]);
    } else if (action.apiAction) {
      console.info('[HM Dashboard] API action:', action.apiAction, tile.entityId);
    }
  }

  protected handleTileDismiss(tileId: string): void {
    this.intelligence.handleDismiss(tileId);
  }

  protected handleTileSnooze(event: { tileId: string; hours: number }): void {
    this.intelligence.handleSnooze(event.tileId, event.hours);
  }

  protected viewAllTiles(): void {
    // Navigate to a dedicated tiles view or show modal (future)
    console.info('[HM Dashboard] View all tiles');
  }
}
