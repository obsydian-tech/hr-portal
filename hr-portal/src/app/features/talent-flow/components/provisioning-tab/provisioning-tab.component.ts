import {
  Component,
  ChangeDetectionStrategy,
  Input,
  OnInit,
  inject,
  signal,
  computed,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ProvisioningBundleProgress,
  ProvisioningItemProgress,
  ActivityLogEntry,
} from '../../models/talent-flow.models';
import { TalentFlowProvisioningService } from '../../services/talent-flow-provisioning.service';

@Component({
  selector: 'tf-provisioning-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './provisioning-tab.component.html',
  styleUrl: './provisioning-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvisioningTabComponent implements OnInit {
  @Input({ required: true }) candidateId!: string;

  /** Emits the number of breached items once data loads (for the tab badge). */
  readonly breachCount = output<number>();

  private readonly svc = inject(TalentFlowProvisioningService);

  protected readonly loading = signal(true);
  protected readonly bundle  = signal<ProvisioningBundleProgress | null>(null);

  protected readonly completeCount = computed(() =>
    this.bundle()?.items.filter(i => i.status === 'COMPLETE').length ?? 0,
  );
  protected readonly breachedCount = computed(() =>
    this.bundle()?.items.filter(i => i.status === 'BREACHED').length ?? 0,
  );
  protected readonly readyPct = computed(() => {
    const b = this.bundle();
    if (!b || b.items.length === 0) return 0;
    return Math.round((this.completeCount() / b.items.length) * 100);
  });
  protected readonly readinessLabel = computed(() => {
    const p = this.readyPct();
    const bc = this.breachedCount();
    if (bc > 0) return `${p}% · At risk`;
    if (p === 100) return '100% · Ready';
    return `${p}% · In progress`;
  });
  protected readonly hasActiveBreach = computed(() => this.breachedCount() > 0);

  async ngOnInit(): Promise<void> {
    const data = await this.svc.getBundleProgressByCandidateId(this.candidateId);
    this.bundle.set(data);
    this.loading.set(false);
    this.breachCount.emit(data?.items.filter(i => i.status === 'BREACHED').length ?? 0);
  }

  protected itemTypeLabel(item: ProvisioningItemProgress): string {
    const map: Record<string, string> = {
      HARDWARE:   'HARDWARE',
      ACCESS:     'ACCESS & IDENTITY',
      SOFTWARE:   'SOFTWARE',
      FACILITIES: 'FACILITIES',
    };
    return map[item.type] ?? item.type;
  }

  protected itemTypeClass(item: ProvisioningItemProgress): string {
    const map: Record<string, string> = {
      HARDWARE:   'pt-type--hardware',
      ACCESS:     'pt-type--access',
      SOFTWARE:   'pt-type--software',
      FACILITIES: 'pt-type--facilities',
    };
    return map[item.type] ?? '';
  }

  protected activityIcon(entry: ActivityLogEntry): string {
    switch (entry.type) {
      case 'BREACH':   return 'pi-exclamation-circle';
      case 'COMPLETE': return 'pi-check-circle';
      case 'APPROVAL': return 'pi-verified';
      default:         return 'pi-info-circle';
    }
  }

  protected activityIconClass(entry: ActivityLogEntry): string {
    switch (entry.type) {
      case 'BREACH':   return 'pt-act__icon--breach';
      case 'COMPLETE': return 'pt-act__icon--complete';
      case 'APPROVAL': return 'pt-act__icon--approval';
      default:         return 'pt-act__icon--info';
    }
  }
}
