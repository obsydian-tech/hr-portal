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
import { TalentFlowApiService } from '../../../services/talent-flow-api.service';
import { ScoringWeights, DEFAULT_SCORING_WEIGHTS } from '../../../models/talent-flow.models';

/**
 * ScoringWeightsPageComponent — FE-007 / NH-140
 *
 * Route: /talent-flow/config/scoring  (adminGuard protected)
 *
 * Loads current active SCORING_WEIGHTS config on init.
 * Sliders for 4 criteria — realtime sum displayed.
 * Save disabled until sum === 100.
 * PUT updateConfig('SCORING_WEIGHTS', weights) → new version created.
 */

interface WeightCriterion {
  key: keyof ScoringWeights;
  label: string;
  icon: string;
}

const CRITERIA: WeightCriterion[] = [
  { key: 'technical',      label: 'Technical Skills',   icon: 'pi-code' },
  { key: 'communication',  label: 'Communication',       icon: 'pi-comments' },
  { key: 'culturalFit',    label: 'Cultural Fit',        icon: 'pi-heart' },
  { key: 'problemSolving', label: 'Problem Solving',     icon: 'pi-lightbulb' },
];

@Component({
  selector: 'tf-scoring-weights-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule],
  templateUrl: './scoring-weights-page.component.html',
  styleUrl:    './scoring-weights-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScoringWeightsPageComponent implements OnInit {
  private readonly api = inject(TalentFlowApiService);

  readonly criteria   = CRITERIA;
  readonly loading    = signal(true);
  readonly saving     = signal(false);
  readonly saveError  = signal<string | null>(null);
  readonly saveSuccess = signal(false);
  readonly configVersion = signal<string>('—');

  readonly weights = signal<ScoringWeights>({ ...DEFAULT_SCORING_WEIGHTS });

  readonly total = computed(() => {
    const w = this.weights();
    return w.technical + w.communication + w.culturalFit + w.problemSolving;
  });

  readonly remaining = computed(() => 100 - this.total());
  readonly valid     = computed(() => this.total() === 100);

  ngOnInit(): void {
    this.api.getConfig('SCORING_WEIGHTS').subscribe({
      next: (cfg: import('../../../models/talent-flow.models').ConfigResponse) => {
        const d = cfg.data as Partial<ScoringWeights>;
        this.weights.set({
          technical:      d.technical      ?? DEFAULT_SCORING_WEIGHTS.technical,
          communication:  d.communication  ?? DEFAULT_SCORING_WEIGHTS.communication,
          culturalFit:    d.culturalFit    ?? DEFAULT_SCORING_WEIGHTS.culturalFit,
          problemSolving: d.problemSolving ?? DEFAULT_SCORING_WEIGHTS.problemSolving,
        });
        this.configVersion.set(cfg.version);
        this.loading.set(false);
      },
      error: () => {
        // Fall back to defaults if no config exists yet
        this.loading.set(false);
      },
    });
  }

  updateWeight(key: keyof ScoringWeights, value: number): void {
    this.weights.update((w) => ({ ...w, [key]: value }));
    this.saveSuccess.set(false);
  }

  save(): void {
    if (!this.valid() || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.saveSuccess.set(false);

    this.api.updateConfig('SCORING_WEIGHTS', this.weights()).subscribe({
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
