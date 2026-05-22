import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { TalentFlowAuthService } from '../../services/talent-flow-auth.service';
import { HmTaskCardComponent } from '../../components/hm-task-card/hm-task-card.component';
import { Candidate } from '../../models/talent-flow.models';

/**
 * HM Dashboard — D044–D051
 * 3-tab view: My Tasks | My Candidates | Decisions
 * Loads only candidates where hiringManagerId matches the logged-in HM's sub.
 */
@Component({
  selector: 'tf-hm-dashboard-page',
  standalone: true,
  imports: [Tabs, TabList, Tab, TabPanels, TabPanel, ProgressSpinnerModule, HmTaskCardComponent],
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
                    (voteSubmitted)="onVoteSubmitted()"
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
                  <div class="hm-candidate-row">
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
                <p>No candidates awaiting a hire / reject decision.</p>
              </div>
            } @else {
              <div class="hm-candidate-list">
                @for (c of decisionCandidates(); track c.id) {
                  <div class="hm-candidate-row">
                    <div class="hm-candidate-row__info">
                      <span class="hm-candidate-row__name">{{ c.firstName }} {{ c.lastName }}</span>
                      <span class="hm-candidate-row__role">{{ c.role }}</span>
                    </div>
                    <span class="hm-candidate-row__stage hm-candidate-row__stage--decision">Awaiting Decision</span>
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
      font-size: 1.375rem;
      font-weight: 700;
      color: var(--naleko-text-primary, #1e293b);
      margin: 0 0 0.375rem;
    }

    .hm-dashboard__sub {
      font-size: 0.875rem;
      color: var(--naleko-text-secondary, #64748b);
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
      color: var(--naleko-text-muted, #94a3b8);
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
      color: var(--naleko-danger, #ef4444);
      text-align: center;
    }

    .hm-task-list { padding-top: 1rem; }

    .hm-candidate-list { padding-top: 1rem; }

    .hm-candidate-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      background: var(--naleko-surface-card, #fff);
      border: 1px solid var(--naleko-border-subtle, #e2e8f0);
      border-radius: var(--naleko-radius-lg, 12px);
      margin-bottom: 0.625rem;
    }

    .hm-candidate-row__info { flex: 1; }

    .hm-candidate-row__name {
      display: block;
      font-weight: 600;
      font-size: 0.9375rem;
      color: var(--naleko-text-primary, #1e293b);
    }

    .hm-candidate-row__role {
      display: block;
      font-size: 0.8125rem;
      color: var(--naleko-text-secondary, #64748b);
      margin-top: 0.125rem;
    }

    .hm-candidate-row__stage {
      font-size: 0.75rem;
      color: var(--naleko-text-muted, #94a3b8);
    }

    .hm-candidate-row__stage--decision {
      color: var(--naleko-warning, #f59e0b);
      font-weight: 600;
    }

    .hm-candidate-row__sla { font-size: 0.625rem; }
    .hm-candidate-row__sla--ON_TRACK { color: var(--naleko-success, #22c55e); }
    .hm-candidate-row__sla--AT_RISK  { color: var(--naleko-warning, #f59e0b); }
    .hm-candidate-row__sla--BREACHED { color: var(--naleko-danger, #ef4444); }
  `],
})
export class HmDashboardPageComponent implements OnInit {
  private readonly api      = inject(TalentFlowApiService);
  protected readonly tfAuth = inject(TalentFlowAuthService);

  protected readonly activeTab  = signal<string>('tasks');
  protected readonly loading    = signal(true);
  protected readonly loadError  = signal('');
  private readonly candidates   = signal<Candidate[]>([]);

  protected readonly currentUser       = this.tfAuth.currentUser;
  protected readonly taskCandidates    = computed(() =>
    this.candidates().filter((c) =>
      ['TECHNICAL_INTERVIEW', 'PANEL_INTERVIEW', 'EVALUATION'].includes(c.currentStage),
    ),
  );
  protected readonly allCandidates     = this.candidates.asReadonly();
  protected readonly decisionCandidates = computed(() =>
    this.candidates().filter((c) => c.currentStage === 'EVALUATION'),
  );

  ngOnInit(): void {
    this.loadCandidates();
  }

  protected setActiveTab(val: string | number): void {
    this.activeTab.set(String(val));
  }

  protected onVoteSubmitted(): void {
    this.loadCandidates();
  }

  protected stageLabel(stage: string): string {
    const labels: Record<string, string> = {
      APPLICATION_REVIEW:  'Application Review',
      PHONE_SCREENING:     'Phone Screening',
      TECHNICAL_INTERVIEW: 'Technical Interview',
      PANEL_INTERVIEW:     'Panel Interview',
      EVALUATION:          'Evaluation',
      BACKGROUND_CHECK:    'Background Check',
      OFFER_PREPARATION:   'Offer Preparation',
    };
    return labels[stage] ?? stage;
  }

  private loadCandidates(): void {
    this.loading.set(true);
    this.loadError.set('');
    const user = this.tfAuth.currentUser();
    const hmId = user?.sub ?? user?.email ?? '';
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
}
