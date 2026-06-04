import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';

export interface SlaThresholdItem {
  key:         string;
  label:       string;
  description: string;
  hours:       number;
}

export interface SlaEscalation {
  warningPct:  number;
  criticalPct: number;
}

export interface AdminSlaThresholdsData {
  thresholds:  Record<string, number>;
  escalation:  SlaEscalation;
}

const DEFAULT_THRESHOLDS: SlaThresholdItem[] = [
  { key: 'firstEngagement',        label: 'First Engagement',          description: 'Time from application to first candidate contact',   hours: 24  },
  { key: 'evaluationCompletion',   label: 'Evaluation Completion',     description: 'Time from stage entry to evaluation completed',       hours: 72  },
  { key: 'offerGeneration',        label: 'Offer Generation',          description: 'Time from HM approval to offer document generated',   hours: 48  },
  { key: 'offerAcceptanceWindow',  label: 'Offer Acceptance Window',   description: 'Time window given to candidate to accept offer',      hours: 120 },
  { key: 'hmReviewBundle',         label: 'HM Review Bundle',          description: 'Time for HM to review provisioning bundle',           hours: 48  },
];

const DEFAULT_ESCALATION: SlaEscalation = { warningPct: 75, criticalPct: 90 };

/**
 * AdminSlaThresholdsComponent — Admin-S2 / TalentFlow Config
 *
 * Route: /platform/talentflow/admin/talentflow/sla-thresholds
 *
 * Manages the 5 SLA windows (hours) used across the TalentFlow
 * pipeline, plus escalation warning/critical percentage thresholds.
 */
@Component({
  selector: 'tf-admin-sla-thresholds',
  standalone: true,
  imports: [FormsModule, InputNumberModule, ConfigVersionBadgeComponent],
  templateUrl: './admin-sla-thresholds.component.html',
  styleUrl:    './admin-sla-thresholds.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSlaThresholdsComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly thresholds    = signal<SlaThresholdItem[]>(DEFAULT_THRESHOLDS.map((t) => ({ ...t })));
  readonly escalation    = signal<SlaEscalation>({ ...DEFAULT_ESCALATION });
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('SLA_THRESHOLDS').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<AdminSlaThresholdsData>;
        if (d.thresholds) {
          this.thresholds.set(
            DEFAULT_THRESHOLDS.map((t) => ({
              ...t,
              hours: (d.thresholds as Record<string, number>)[t.key] ?? t.hours,
            })),
          );
        }
        if (d.escalation) {
          this.escalation.set({ ...DEFAULT_ESCALATION, ...d.escalation });
        }
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  updateHours(key: string, value: number): void {
    this.thresholds.update((items) =>
      items.map((t) => (t.key === key ? { ...t, hours: value } : t)),
    );
  }

  updateEscalation(field: keyof SlaEscalation, value: number): void {
    this.escalation.update((e) => ({ ...e, [field]: value }));
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save SLA thresholds? Updated thresholds will apply to all new evaluations immediately.',
      header:  'Save SLA Thresholds',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(false),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset all SLA thresholds and escalation levels to factory defaults?',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSave(true),
    });
  }

  private buildPayload(resetMode: boolean): AdminSlaThresholdsData {
    if (resetMode) {
      return {
        thresholds:  Object.fromEntries(DEFAULT_THRESHOLDS.map((t) => [t.key, t.hours])),
        escalation:  { ...DEFAULT_ESCALATION },
      };
    }
    return {
      thresholds:  Object.fromEntries(this.thresholds().map((t) => [t.key, t.hours])),
      escalation:  this.escalation(),
    };
  }

  private doSave(resetMode: boolean): void {
    this.saving.set(true);
    const payload = this.buildPayload(resetMode);

    this.api.updateConfig('SLA_THRESHOLDS', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        if (resetMode) {
          this.thresholds.set(DEFAULT_THRESHOLDS.map((t) => ({ ...t })));
          this.escalation.set({ ...DEFAULT_ESCALATION });
        }
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  resetMode ? 'Reset to Defaults' : 'Saved',
          detail:   `SLA thresholds saved as version ${cfg.version}.`,
          life:     4000,
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save Failed',
          detail:   err.userMessage ?? 'Could not save SLA thresholds.',
          life:     5000,
        });
      },
    });
  }
}
