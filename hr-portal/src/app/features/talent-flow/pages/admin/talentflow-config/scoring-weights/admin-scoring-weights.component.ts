import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import {
  ScoringWeights,
  DEFAULT_SCORING_WEIGHTS,
  ConfigResponse,
} from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';

interface WeightCriterion {
  key:   keyof ScoringWeights;
  label: string;
  icon:  string;
}

const CRITERIA: WeightCriterion[] = [
  { key: 'technical',      label: 'Technical Skills',  icon: 'pi-code'       },
  { key: 'communication',  label: 'Communication',     icon: 'pi-comments'   },
  { key: 'culturalFit',    label: 'Cultural Fit',      icon: 'pi-heart'      },
  { key: 'problemSolving', label: 'Problem Solving',   icon: 'pi-lightbulb'  },
];

/**
 * AdminScoringWeightsComponent — Admin-S2 / TalentFlow Config
 *
 * Route: /platform/talentflow/admin/talentflow/scoring-weights
 *
 * Admin-managed version of the scoring weights config.
 * Adds confirm-before-save, reset-to-defaults, and version badge.
 */
@Component({
  selector: 'tf-admin-scoring-weights',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, ConfigVersionBadgeComponent],
  templateUrl: './admin-scoring-weights.component.html',
  styleUrl:    './admin-scoring-weights.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminScoringWeightsComponent implements OnInit {
  private readonly api             = inject(TalentFlowApiService);
  private readonly messageService  = inject(MessageService);
  private readonly confirmService  = inject(ConfirmationService);

  readonly criteria     = CRITERIA;
  readonly loading      = signal(true);
  readonly saving       = signal(false);
  readonly weights      = signal<ScoringWeights>({ ...DEFAULT_SCORING_WEIGHTS });
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt    = signal<string | null>(null);

  readonly total     = computed(() => {
    const w = this.weights();
    return w.technical + w.communication + w.culturalFit + w.problemSolving;
  });
  readonly remaining = computed(() => 100 - this.total());
  readonly valid     = computed(() => this.total() === 100);

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('SCORING_WEIGHTS').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<ScoringWeights>;
        this.weights.set({
          technical:      d.technical      ?? DEFAULT_SCORING_WEIGHTS.technical,
          communication:  d.communication  ?? DEFAULT_SCORING_WEIGHTS.communication,
          culturalFit:    d.culturalFit    ?? DEFAULT_SCORING_WEIGHTS.culturalFit,
          problemSolving: d.problemSolving ?? DEFAULT_SCORING_WEIGHTS.problemSolving,
        });
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  updateWeight(key: keyof ScoringWeights, value: number): void {
    this.weights.update((w) => ({ ...w, [key]: value }));
  }

  confirmSave(): void {
    if (!this.valid() || this.saving()) return;
    this.confirmService.confirm({
      message: 'Save these scoring weights? This will become the active configuration for all new evaluations.',
      header:  'Save Scoring Weights',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(this.weights()),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset all weights to factory defaults? This cannot be undone.',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSave({ ...DEFAULT_SCORING_WEIGHTS }),
    });
  }

  private doSave(payload: ScoringWeights): void {
    this.saving.set(true);
    this.api.updateConfig('SCORING_WEIGHTS', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        if (payload === this.weights()) {
          // No-op — weights signal is already set
        } else {
          this.weights.set(payload);
        }
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Saved',
          detail:   `Scoring weights saved as version ${cfg.version}.`,
          life:     4000,
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save Failed',
          detail:   err.userMessage ?? 'Could not save config. Try again.',
          life:     5000,
        });
      },
    });
  }
}
