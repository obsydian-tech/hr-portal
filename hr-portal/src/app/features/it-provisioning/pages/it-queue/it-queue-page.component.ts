import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { RequirementType, ItTask, ItQueue, TaskSlaStatus } from '../../models/it-provisioning.models';
import { ItProvisioningApiService } from '../../services/it-provisioning-api.service';
import { ItProvisioningAuthService } from '../../services/it-provisioning-auth.service';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'ip-it-queue-page',
  standalone: true,
  imports: [],
  templateUrl: './it-queue-page.component.html',
  styleUrl: './it-queue-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItQueuePageComponent implements OnInit {
  private readonly api       = inject(ItProvisioningApiService);
  private readonly itAuth    = inject(ItProvisioningAuthService);
  private readonly nalekoAuth = inject(AuthService);

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

  protected readonly specialistId = computed<string>(() => {
    // Use Naleko sub as stable ID when IT pool is not authenticated
    return this.itAuth.currentUser()?.sub ?? this.nalekoAuth.currentUser()?.staffId ?? 'specialist-001';
  });

  async ngOnInit(): Promise<void> {
    const [taskList, itUser, nalekoUser] = await Promise.all([
      this.api.getMyTasks(this.specialistId()),
      Promise.resolve(this.itAuth.currentUser()),
      Promise.resolve(this.nalekoAuth.currentUser()),
    ]);
    this.tasks.set(taskList);

    // Derive assigned queues from IT pool (preferred) or default to all
    const assigned: string[] = itUser?.assignedQueues ?? ['Hardware', 'Access & Identity', 'Software', 'Facilities'];
    this.queues.set(this.api.getQueues(assigned));
    this.loading.set(false);
  }

  protected selectQueue(type: RequirementType | 'ALL'): void {
    this.selectedQueue.set(type);
  }

  protected async claimTask(taskId: string): Promise<void> {
    this.actionPending.set(taskId);
    await this.api.claimTask(taskId, this.specialistId());
    // Refresh task list
    const updated = await this.api.getMyTasks(this.specialistId());
    this.tasks.set(updated);
    this.actionPending.set(null);
  }

  protected async completeTask(taskId: string): Promise<void> {
    this.actionPending.set(taskId);
    await this.api.completeTask(taskId);
    const updated = await this.api.getMyTasks(this.specialistId());
    this.tasks.set(updated);
    this.actionPending.set(null);
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

  protected onCta(task: ItTask): void {
    if (task.taskStatus === 'CLAIMED' && task.claimedBy === this.specialistId()) {
      void this.completeTask(task.id);
    } else {
      void this.claimTask(task.id);
    }
  }
}
