import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { TalentFlowApiService } from '../../../services/talent-flow-api.service';
import { HiringStage } from '../../../models/talent-flow.models';
import { STAGE_LABELS } from '../../../components/stage-selector/stage-selector.component';

/**
 * SLAThresholdsPageComponent — FE-007 / NH-140
 *
 * Route: /talent-flow/config/sla  (adminGuard protected)
 *
 * Loads current SLA_THRESHOLDS config on init.
 * Per-stage hour inputs for all 11 HiringStage values.
 * PUT updateConfig('SLA_THRESHOLDS', thresholds)
 */

const DEFAULT_THRESHOLDS: Record<HiringStage, number> = {
  APPLICATION_REVIEW:  48,
  PHONE_SCREENING:     72,
  TECHNICAL_INTERVIEW: 120,
  PANEL_INTERVIEW:     120,
  EVALUATION:          48,
  BACKGROUND_CHECK:    72,
  OFFER_PREPARATION:   72,
  OFFER_APPROVAL:      48,
  OFFER_DELIVERY:      24,
  CONTRACT_SIGNING:    72,
  PRE_BOARDING:        168,
  ONBOARDING:          240,
};

@Component({
  selector: 'tf-sla-thresholds-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule],
  templateUrl: './sla-thresholds-page.component.html',
  styleUrl:    './sla-thresholds-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SLAThresholdsPageComponent implements OnInit {
  private readonly api = inject(TalentFlowApiService);

  readonly stages: HiringStage[] = Object.keys(DEFAULT_THRESHOLDS) as HiringStage[];
  readonly stageLabels = STAGE_LABELS;

  readonly loading      = signal(true);
  readonly saving       = signal(false);
  readonly saveError    = signal<string | null>(null);
  readonly saveSuccess  = signal(false);
  readonly configVersion = signal<string>('—');

  readonly thresholds = signal<Record<HiringStage, number>>({ ...DEFAULT_THRESHOLDS });

  ngOnInit(): void {
    this.api.getConfig('SLA_THRESHOLDS').subscribe({
      next: (cfg: import('../../../models/talent-flow.models').ConfigResponse) => {
        const data = cfg.data as Partial<Record<HiringStage, number>>;
        const merged = { ...this.thresholds() };
        (Object.keys(data) as HiringStage[]).forEach((k) => {
          if (data[k] !== undefined) merged[k] = data[k] as number;
        });
        this.thresholds.set(merged);
        this.configVersion.set(cfg.version);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  updateThreshold(stage: HiringStage, value: number): void {
    this.thresholds.update((t) => ({ ...t, [stage]: value }));
    this.saveSuccess.set(false);
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.saveSuccess.set(false);

    this.api.updateConfig('SLA_THRESHOLDS', this.thresholds()).subscribe({
      next: (cfg: import('../../../models/talent-flow.models').ConfigResponse) => {
        this.configVersion.set(cfg.version);
        this.saving.set(false);
        this.saveSuccess.set(true);
      },
      error: (err: { userMessage?: string }) => {
        this.saveError.set(err.userMessage ?? 'Failed to save config.');
        this.saving.set(false);
      },
    });
  }
}
