import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { RequirementType, ItTask, ItQueue, TaskSlaStatus } from '../../models/it-provisioning.models';
import { ItProvisioningApiService } from '../../services/it-provisioning-api.service';
import { ItProvisioningStateService } from '../../services/it-provisioning-state.service';
import { TalentFlowAuthService } from '../../../talent-flow/services/talent-flow-auth.service';
import { TalentFlowApiService } from '../../../talent-flow/services/talent-flow-api.service';
import { IntelligenceService } from '../../../talent-flow/services/intelligence.service';
import { IntelligenceTileComponent } from '../../../talent-flow/components/intelligence-tile/intelligence-tile.component';
import { AuthService } from '../../../../core/services/auth.service';
import { ITQueue } from '../../../talent-flow/pages/admin/it-request-config/it-request.models';
import { IntelligenceTile, TileAction } from '../../../talent-flow/models/talent-flow.models';

@Component({
  selector: 'ip-it-queue-page',
  standalone: true,
  imports: [CardModule, IntelligenceTileComponent],
  templateUrl: './it-queue-page.component.html',
  styleUrl: './it-queue-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItQueuePageComponent implements OnInit {
  private readonly api          = inject(ItProvisioningApiService);
  private readonly itState      = inject(ItProvisioningStateService);
  private readonly tfAuth       = inject(TalentFlowAuthService);
  private readonly tfApi        = inject(TalentFlowApiService);
  protected readonly intelligence = inject(IntelligenceService);
  private readonly nalekoAuth   = inject(AuthService);
  private readonly router       = inject(Router);

  protected readonly loading = signal<boolean>(true);
  protected readonly tasks   = signal<ItTask[]>([]);
  protected readonly queues  = signal<ItQueue[]>([]);
  protected readonly selectedQueue = signal<RequirementType | 'ALL'>('ALL');
  protected readonly actionPending = signal<string | null>(null); // task id in flight

  // ── Signal strip counts ────────────────────────────────────────────────────
  protected readonly breachedCount = computed(() =>
    this.tasks().filter(t => t.slaStatus === 'BREACHED').length);

  protected readonly atRiskCount = computed(() =>
    this.tasks().filter(t => t.slaStatus === 'AT_RISK').length);

  protected readonly claimedByMeCount = computed(() =>
    this.tasks().filter(t => t.taskStatus === 'CLAIMED' && t.claimedBy === this.specialistId()).length);

  protected readonly onTrackCount = computed(() =>
    this.tasks().filter(t => t.slaStatus === 'ON_TRACK').length);

  // ── Filtered + sorted task list ────────────────────────────────────────────
  protected readonly filteredTasks = computed<ItTask[]>(() => {
    let list = this.tasks();
    const q = this.selectedQueue();
    if (q !== 'ALL') {
      list = list.filter(t => t.queue === q);
    }
    // Sort: breached first, then at-risk, then on-track; within each group: soonest start date
    const order: Record<TaskSlaStatus, number> = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2 };
    return [...list].sort((a, b) => {
      const diff = order[a.slaStatus] - order[b.slaStatus];
      if (diff !== 0) return diff;
      return a.newHire.daysRemaining - b.newHire.daysRemaining;
    });
  });

  /**
   * Specialist sub — used to compare task.claimedBy with current user.
   * Prefer TF pool sub (ITAdmin / ITSpecialist groups); fall back to Naleko staffId.
   */
  protected readonly specialistId = computed<string>(() =>
    this.tfAuth.currentUser()?.sub ?? this.nalekoAuth.currentUser()?.staffId ?? '',
  );

  async ngOnInit(): Promise<void> {
    // Load intelligence tiles for IT role
    this.intelligence.loadTiles('IT');

    // 1. Fetch tasks and IT_QUEUES config in parallel.
    const [taskList, configRes] = await Promise.all([
      this.api.getMyTasks(),
      this.tfApi.getConfig('IT_QUEUES').toPromise().catch(() => null),
    ]);

    this.tasks.set(taskList);
    this.itState.tasks.set(taskList);

    // 2. Derive queue tabs from admin config, filtered to queues where the
    //    specialist's email appears in assignedSpecialists (or show all if
    //    no config is available yet / user is ITAdmin).
    const userEmail   = this.tfAuth.currentUser()?.email ?? this.nalekoAuth.currentUser()?.email ?? '';
    const isAdmin     = this.tfAuth.isAdmin() || this.tfAuth.hasGroup('ITAdmin');
    const allQueues   = (configRes?.data as { queues?: ITQueue[] })?.queues ?? [];
    const activeQueues = allQueues.filter((q) => q.active);

    const assigned: string[] = isAdmin
      ? activeQueues.map((q) => q.name)  // ITAdmin sees all active queues
      : activeQueues
          .filter((q) => q.assignedSpecialists.includes(userEmail))
          .map((q) => q.name);

    const fallback = ['Hardware', 'Access & Identity', 'Software', 'Facilities'];
    const queueNames = assigned.length ? assigned : fallback;
    this.queues.set(this.api.buildQueues(taskList, queueNames as any));
    this.loading.set(false);
  }

  protected selectQueue(type: RequirementType | 'ALL'): void {
    this.selectedQueue.set(type);
  }

  protected async claimTask(taskId: string): Promise<void> {
    this.actionPending.set(taskId);
    const name = this.nalekoAuth.currentUser()?.givenName
      ? `${this.nalekoAuth.currentUser()!.givenName} ${this.nalekoAuth.currentUser()!.familyName}`.trim()
      : 'Tom Mokoena';
    await this.api.claimTask(taskId);
    const updated = await this.api.getMyTasks();
    this.tasks.set(updated);
    this.itState.tasks.set(updated);
    this.actionPending.set(null);
    // Navigate to task detail after claiming
    void this.router.navigate(['/platform/it-requests/task', taskId]);
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  protected daysClass(days: number): string {
    if (days <= 14) return 'days--red';
    if (days <= 30) return 'days--amber';
    return 'days--green';
  }

  protected cardBorderClass(task: ItTask): string {
    if (task.slaStatus === 'BREACHED') return 'task-card--breached';
    if (task.slaStatus === 'AT_RISK')  return 'task-card--at-risk';
    if (task.taskStatus === 'CLAIMED' && task.claimedBy === this.specialistId()) return 'task-card--claimed';
    return '';
  }

  protected ctaLabel(task: ItTask): string {
    if (task.slaStatus === 'BREACHED' && task.taskStatus === 'UNASSIGNED') return 'Claim & resolve';
    if (task.taskStatus === 'CLAIMED' && task.claimedBy === this.specialistId()) return 'View & complete';
    return 'Claim task';
  }

  protected ctaClass(task: ItTask): string {
    if (task.slaStatus === 'BREACHED' && task.taskStatus === 'UNASSIGNED') return 'cta--red';
    if (task.taskStatus === 'CLAIMED' && task.claimedBy === this.specialistId()) return 'cta--indigo';
    return 'cta--indigo';
  }

  protected viewTask(taskId: string): void {
    void this.router.navigate(['/platform/it-requests/task', taskId]);
  }

  protected onCta(task: ItTask): void {
    if (task.taskStatus === 'CLAIMED' && task.claimedBy === this.specialistId()) {
      // Open task detail to work through checklist and complete
      this.viewTask(task.id);
    } else {
      void this.claimTask(task.id);
    }
  }

  // ── Intelligence tile handlers (Zone 0) ─────────────────────────────────────

  protected handleTileAction(event: { action: TileAction; tile: IntelligenceTile }): void {
    const { action, tile } = event;
    if (action.route) {
      void this.router.navigate([action.route]);
    } else if (action.apiAction) {
      console.info('[IT Queue] API action:', action.apiAction, tile.entityId);
    }
  }

  protected handleTileDismiss(tileId: string): void {
    this.intelligence.handleDismiss(tileId);
  }

  protected handleTileSnooze(event: { tileId: string; hours: number }): void {
    this.intelligence.handleSnooze(event.tileId, event.hours);
  }
}
