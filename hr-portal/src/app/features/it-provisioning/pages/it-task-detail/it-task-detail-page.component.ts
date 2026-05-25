import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { ItTask, ChecklistItem, FulfilmentData } from '../../models/it-provisioning.models';
import { ItProvisioningApiService } from '../../services/it-provisioning-api.service';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'ip-it-task-detail-page',
  standalone: true,
  imports: [FormsModule, UpperCasePipe],
  templateUrl: './it-task-detail-page.component.html',
  styleUrl: './it-task-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItTaskDetailPageComponent implements OnInit {
  private readonly route      = inject(ActivatedRoute);
  private readonly router     = inject(Router);
  private readonly api        = inject(ItProvisioningApiService);
  private readonly nalekoAuth = inject(AuthService);

  // ── State ────────────────────────────────────────────────────────────────
  protected readonly loading       = signal(true);
  protected readonly task          = signal<ItTask | null>(null);
  protected readonly submitting    = signal(false);
  protected readonly showRelease   = signal(false);

  // Mutable local checklist (user ticks items, does not mutate shared mock)
  protected readonly checklist = signal<ChecklistItem[]>([]);

  // Fulfilment form
  protected assetReference   = '';
  protected fulfilmentMethod = 'Delivered to desk';
  protected additionalNotes  = '';

  // Release reason form
  protected releaseReason = '';

  // ── Computed ─────────────────────────────────────────────────────────────
  protected readonly allChecked = computed(() =>
    this.checklist().length > 0 && this.checklist().every(i => i.completed)
  );

  protected readonly canComplete = computed(() =>
    this.allChecked() && this.assetReference.trim().length > 0
  );

  protected readonly isClaimedByMe = computed(() => {
    const t = this.task();
    if (!t) return false;
    // In mock context specialist-001 = current user
    return t.taskStatus === 'CLAIMED';
  });

  protected readonly slaBarWidth = computed(() => {
    const t = this.task();
    if (!t) return 0;
    return Math.min(t.slaProgress, 100);
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/platform/it-requests/queue']);
      return;
    }
    const loaded = await this.api.getTaskById(id);
    if (!loaded) {
      void this.router.navigate(['/platform/it-requests/queue']);
      return;
    }
    this.task.set(loaded);
    // Clone checklist to allow local mutation without touching mock array
    this.checklist.set(loaded.checklist.map(c => ({ ...c })));
    this.loading.set(false);
  }

  // ── Checklist ────────────────────────────────────────────────────────────
  protected toggleChecklist(id: string): void {
    this.checklist.update(list =>
      list.map(item => item.id === id ? { ...item, completed: !item.completed } : item)
    );
  }

  // ── CTA actions ──────────────────────────────────────────────────────────
  protected async markComplete(): Promise<void> {
    if (!this.canComplete() || this.submitting()) return;
    this.submitting.set(true);
    const data: FulfilmentData = {
      assetReference:   this.assetReference.trim(),
      fulfilmentMethod: this.fulfilmentMethod,
      additionalNotes:  this.additionalNotes.trim(),
    };
    await this.api.completeTaskWithFulfilment(this.task()!.id, data);
    this.submitting.set(false);
    void this.router.navigate(['/platform/it-requests/queue']);
  }

  protected backToQueue(): void {
    void this.router.navigate(['/platform/it-requests/queue']);
  }

  protected openReleaseDialog(): void {
    this.releaseReason = '';
    this.showRelease.set(true);
  }

  protected cancelRelease(): void {
    this.showRelease.set(false);
  }

  protected async confirmRelease(): Promise<void> {
    if (!this.releaseReason.trim() || this.submitting()) return;
    this.submitting.set(true);
    await this.api.releaseTask(this.task()!.id, this.releaseReason.trim());
    this.submitting.set(false);
    void this.router.navigate(['/platform/it-requests/queue']);
  }

  // ── Template helpers ────────────────────────────────────────────────────
  protected daysClass(days: number): string {
    if (days <= 7)  return 'days--red';
    if (days <= 14) return 'days--amber';
    return 'days--green';
  }

  protected slaBarClass(slaStatus: string): string {
    if (slaStatus === 'BREACHED') return 'sla-bar__fill--breached';
    if (slaStatus === 'AT_RISK')  return 'sla-bar__fill--at-risk';
    return 'sla-bar__fill--on-track';
  }

  protected slaLabel(slaStatus: string): string {
    if (slaStatus === 'BREACHED') return 'SLA BREACHED';
    if (slaStatus === 'AT_RISK')  return 'AT RISK';
    return 'ON TRACK';
  }

  protected activityIcon(type: string): string {
    switch (type) {
      case 'claim':    return 'pi-user-plus';
      case 'release':  return 'pi-times-circle';
      case 'complete': return 'pi-check-circle';
      case 'sla':      return 'pi-exclamation-triangle';
      case 'create':   return 'pi-plus-circle';
      default:         return 'pi-circle';
    }
  }

  protected initials(name: string | null): string {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }
}
