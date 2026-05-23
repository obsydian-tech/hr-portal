import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { UpperCasePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TalentFlowApiService } from '../../services/talent-flow-api.service';
import { TalentFlowAuthService } from '../../services/talent-flow-auth.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  ProvisioningBundleProgress,
  ProvisioningItemProgress,
  ProvisioningRequirementType,
  SlaHealthStatus,
} from '../../models/talent-flow.models';

/**
 * HmBundleProgressPageComponent — Screen 3
 * IT Request Module — Bundle fulfilment progress view (post-approval).
 *
 * Two-column layout:
 *   Left  — Candidate strip, progress bar + 4-count summary, Signal Intelligence (when breached),
 *            task list (completed dimmed, breached = red border + Unassigned + inline actions)
 *   Right — Day 1 Readiness gauge, Action Required panel (breach-conditional), Activity Log
 * Footer — Back to Provisioning
 *
 * Locked decisions (Screen 3):
 *   - Escalate Now = in-app notification only (MVP 1) — email MVP 2
 *   - Tasks self-claimed by IT specialists from Queue — not auto-assigned
 *   - Activity log = bundle-level events only (approvals, completions, breaches)
 *   - Task-level notes remain on the task row only — not duplicated to activity log
 *   - Completed tasks dimmed but visible (audit trail preserved)
 */
@Component({
  selector: 'tf-hm-bundle-progress-page',
  standalone: true,
  imports: [RouterLink, ButtonModule, ProgressSpinnerModule, UpperCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hm-bundle-progress-page.component.html',
  styleUrl:    './hm-bundle-progress-page.component.scss',
})
export class HmBundleProgressPageComponent implements OnInit {
  private readonly api      = inject(TalentFlowApiService);
  private readonly route    = inject(ActivatedRoute);
  private readonly router   = inject(Router);
  protected readonly tfAuth = inject(TalentFlowAuthService);
  private readonly auth     = inject(AuthService);

  // ── State ──────────────────────────────────────────────────────────────

  protected readonly loading        = signal(true);
  protected readonly loadError      = signal('');
  protected readonly escalating     = signal(false);
  protected readonly escalated      = signal(false);
  protected readonly addNoteOpen    = signal<string | null>(null); // item id
  protected readonly addNoteText    = signal('');

  private readonly _bundle = signal<ProvisioningBundleProgress | null>(null);

  // ── Computed ───────────────────────────────────────────────────────────

  protected readonly bundle = computed(() => this._bundle());

  protected readonly daysToStart = computed(() => {
    const b = this._bundle();
    if (!b) return null;
    const diff = Math.ceil(
      (new Date(b.startDate).getTime() - Date.now()) / 86400000,
    );
    return diff;
  });

  protected readonly completedCount  = computed(() =>
    this._bundle()?.items.filter(i => i.status === 'COMPLETE').length ?? 0);
  protected readonly breachedCount   = computed(() =>
    this._bundle()?.items.filter(i => i.status === 'BREACHED').length ?? 0);
  protected readonly inProgressCount = computed(() =>
    this._bundle()?.items.filter(i => i.status === 'IN_PROGRESS').length ?? 0);
  protected readonly pendingCount    = computed(() =>
    this._bundle()?.items.filter(i => i.status === 'PENDING').length ?? 0);
  protected readonly totalCount      = computed(() =>
    this._bundle()?.items.length ?? 0);

  protected readonly progressPct = computed(() => {
    const total = this.totalCount();
    if (!total) return 0;
    return Math.round((this.completedCount() / total) * 100);
  });

  /** True when at least one task is BREACHED — fires Signal Intelligence + Action Required */
  protected readonly hasBreachedTask = computed(() => this.breachedCount() > 0);

  protected readonly breachedItems = computed(() =>
    this._bundle()?.items.filter(i => i.status === 'BREACHED') ?? []);

  protected readonly firstBreachedId = computed(() =>
    this.breachedItems()[0]?.id ?? '');

  /** Readiness label: plain language for Day 1 Readiness panel */
  protected readonly readinessLabel = computed(() => {
    const pct = this.progressPct();
    const b   = this._bundle();
    if (pct === 100) return 'All requirements fulfilled. Priya is ready for Day 1.';
    const breached = this.breachedItems();
    if (breached.length) {
      const names = breached.map(i => i.label).join(', ');
      return `${breached.length} task breached. ${b?.candidateName?.split(' ')[0] ?? 'Candidate'} is not fully ready for Day 1. Resolve ${names} to reach 100%.`;
    }
    return `${pct}% complete. Fulfilment in progress — on track for Day 1 readiness.`;
  });

  protected readonly readinessColour = computed(() => {
    const pct = this.progressPct();
    if (this.hasBreachedTask()) return 'breached';
    if (pct >= 75) return 'warning';
    return 'on-track';
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────

  ngOnInit(): void {
    const bundleId = this.route.snapshot.paramMap.get('bundleId') ?? '';
    this.api.getProvisioningBundleProgress(bundleId).subscribe({
      next:  (b) => {
        this._bundle.set(b ?? null);
        if (!b) this.loadError.set('Bundle not found.');
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.message ?? 'Failed to load bundle progress.');
        this.loading.set(false);
      },
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────

  protected goBack(): void {
    void this.router.navigate(['/platform/talentflow/hm-provisioning']);
  }

  /**
   * Escalate to IT Manager — MVP 1: in-app notification only.
   * Email notifications are deferred to MVP 2 (locked decision).
   * TODO: wire to POST /v1/provisioning/bundles/:id/escalate
   */
  protected escalateToManager(): void {
    this.escalating.set(true);
    // Simulate async notification dispatch
    setTimeout(() => {
      this.escalating.set(false);
      this.escalated.set(true);
    }, 900);
  }

  protected openAddNote(itemId: string): void {
    this.addNoteOpen.set(itemId);
    this.addNoteText.set('');
  }

  protected cancelNote(): void {
    this.addNoteOpen.set(null);
    this.addNoteText.set('');
  }

  /**
   * TODO: wire to POST /v1/provisioning/items/:id/notes
   * Note is appended to the task row only — not duplicated to activity log (locked decision).
   */
  protected saveNote(itemId: string): void {
    const text = this.addNoteText();
    if (!text.trim()) { this.cancelNote(); return; }
    this._bundle.update(b => {
      if (!b) return b;
      return {
        ...b,
        items: b.items.map(i =>
          i.id === itemId ? { ...i, notes: text } : i,
        ),
      };
    });
    this.cancelNote();
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  typeIcon(type: ProvisioningRequirementType): string {
    const map: Record<ProvisioningRequirementType, string> = {
      HARDWARE:   'pi-desktop',
      ACCESS:     'pi-envelope',
      SOFTWARE:   'pi-th-large',
      FACILITIES: 'pi-id-card',
    };
    return map[type] ?? 'pi-box';
  }

  typeColour(type: ProvisioningRequirementType): string {
    const map: Record<ProvisioningRequirementType, string> = {
      HARDWARE:   '#5b21b6',
      ACCESS:     '#0e7490',
      SOFTWARE:   '#065f46',
      FACILITIES: '#92400e',
    };
    return map[type] ?? '#475569';
  }

  startDateFormatted(iso: string): string {
    return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  avatarInitials(name: string): string {
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  avatarColour(name: string): string {
    const palette = ['#6366f1','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#0d9488'];
    let hash = 0;
    for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
    return palette[Math.abs(hash) % palette.length];
  }

  slaBarClass(status: SlaHealthStatus): string {
    return `bp-task__bar--${status}`;
  }

  activityIcon(type: string): string {
    const map: Record<string, string> = {
      BREACH:   'pi-exclamation-triangle',
      COMPLETE: 'pi-check-circle',
      APPROVAL: 'pi-check',
      INFO:     'pi-info-circle',
    };
    return map[type] ?? 'pi-circle';
  }
}
