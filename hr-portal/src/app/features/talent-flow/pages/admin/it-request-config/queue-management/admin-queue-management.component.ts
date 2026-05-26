import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';
import { QueueFormDrawerComponent } from './components/queue-form-drawer/queue-form-drawer.component';
import { ITQueue } from '../it-request.models';
export type { ITQueue } from '../it-request.models';

/**
 * AdminQueueManagementComponent — Admin-S2 / IT Request Config
 *
 * Route: /platform/talentflow/admin/it-request/queues
 *
 * CRUD management for IT fulfilment queues.
 * Each queue defines a category, SLA window, and assigned specialist pool.
 */
@Component({
  selector: 'tf-admin-queue-management',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule, TagModule, TooltipModule, ConfigVersionBadgeComponent, QueueFormDrawerComponent],
  templateUrl: './admin-queue-management.component.html',
  styleUrl:    './admin-queue-management.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminQueueManagementComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly queues        = signal<ITQueue[]>([]);
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);

  // Drawer state
  readonly drawerVisible = signal(false);
  readonly editingQueue  = signal<ITQueue | null>(null);

  // Specialist expand
  readonly expandedRows = signal<Set<string>>(new Set());

  readonly activeCount   = computed(() => this.queues().filter((q) => q.active !== false).length);

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('IT_QUEUES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as { queues?: Partial<ITQueue>[] };
        // Normalize: ensure every queue has id and active (backward-compat with older saved data)
        const normalized: ITQueue[] = Array.isArray(d.queues)
          ? d.queues.map((q) => ({
              id: q.id ?? crypto.randomUUID(),
              name: q.name ?? '',
              description: q.description ?? '',
              category: q.category ?? 'HARDWARE',
              slaHours: q.slaHours ?? 48,
              assignedSpecialists: q.assignedSpecialists ?? [],
              active: q.active !== false,
            }))
          : [];
        this.queues.set(normalized);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  openCreateDrawer(): void {
    this.editingQueue.set(null);
    this.drawerVisible.set(true);
  }

  openEditDrawer(queue: ITQueue): void {
    this.editingQueue.set({ ...queue });
    this.drawerVisible.set(true);
  }

  closeDrawer(): void {
    this.drawerVisible.set(false);
    this.editingQueue.set(null);
  }

  saveQueue(queue: ITQueue): void {
    const existing = this.queues();
    const idx      = existing.findIndex((q) => q.id === queue.id);
    const updated  = idx >= 0
      ? existing.map((q) => (q.id === queue.id ? queue : q))
      : [...existing, queue];

    this.persistQueues(updated, () => {
      this.closeDrawer();
      this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Queue "${queue.name}" saved.`, life: 4000 });
    });
  }

  confirmDelete(queue: ITQueue): void {
    this.confirmService.confirm({
      message: `Delete queue "${queue.name}"? This cannot be undone.`,
      header:  'Delete Queue',
      icon:    'pi pi-trash',
      accept:  () => {
        const updated = this.queues().filter((q) => q.id !== queue.id);
        this.persistQueues(updated, () => {
          this.messageService.add({ severity: 'success', summary: 'Deleted', detail: `Queue "${queue.name}" deleted.`, life: 4000 });
        });
      },
    });
  }

  toggleActive(queue: ITQueue): void {
    const updated = this.queues().map((q) =>
      q.id === queue.id ? { ...q, active: !q.active } : q,
    );
    this.persistQueues(updated);
  }

  toggleSpecialists(queueId: string): void {
    this.expandedRows.update((s) => {
      const next = new Set(s);
      next.has(queueId) ? next.delete(queueId) : next.add(queueId);
      return next;
    });
  }

  private persistQueues(queues: ITQueue[], onSuccess?: () => void): void {
    this.saving.set(true);
    this.api.updateConfig('IT_QUEUES', { queues }).subscribe({
      next: (cfg: ConfigResponse) => {
        this.queues.set(queues);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        onSuccess?.();
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: err.userMessage ?? 'Save failed.', life: 5000 });
      },
    });
  }
}
