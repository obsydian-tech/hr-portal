import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { AdminApiService } from '../../../services/admin-api.service';
import { AdminDashboardResponse } from '../../../models/admin.models';
import { STAGE_LABELS } from '../../../components/stage-selector/stage-selector.component';
import { HiringStage } from '../../../models/talent-flow.models';

@Component({
  selector: 'tf-admin-overview-page',
  standalone: true,
  imports: [RouterLink, ButtonModule, TooltipModule],
  templateUrl: './admin-overview-page.component.html',
  styleUrl: './admin-overview-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverviewPageComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly loading   = signal(true);
  protected readonly error     = signal<string | null>(null);
  protected readonly dashboard = signal<AdminDashboardResponse | null>(null);

  protected readonly kpis               = computed(() => this.dashboard()?.kpis ?? null);
  protected readonly breachedCandidates = computed(() => this.dashboard()?.breachedCandidates ?? []);

  protected readonly slaCompliancePct = computed<string>(() => {
    const k = this.kpis();
    if (!k || k.activePipeline === 0) return '—';
    return `${Math.round(((k.activePipeline - k.slaBreached) / k.activePipeline) * 100)}%`;
  });

  protected readonly lastRefreshedLabel = computed<string>(() => {
    const ts = this.dashboard()?.lastRefreshed;
    return ts ? this.relativeTime(ts) : '—';
  });

  protected readonly isHealthy = computed(() => (this.kpis()?.slaBreached ?? 1) === 0);

  protected stageLabel(stage: string): string {
    return STAGE_LABELS[stage as HiringStage] ?? stage;
  }

  ngOnInit(): void {
    this.loadDashboard();
  }

  protected refresh(): void {
    this.loadDashboard();
  }

  private loadDashboard(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getDashboard().subscribe({
      next: (data) => {
        this.dashboard.set(data);
        this.loading.set(false);
      },
      error: (err: { userMessage?: string }) => {
        this.error.set(err.userMessage ?? 'Failed to load dashboard.');
        this.loading.set(false);
      },
    });
  }

  private relativeTime(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
}
