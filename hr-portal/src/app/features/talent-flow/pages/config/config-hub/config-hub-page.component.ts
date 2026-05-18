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
import { SliderModule } from 'primeng/slider';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { AccordionModule } from 'primeng/accordion';
import { TalentFlowApiService } from '../../../services/talent-flow-api.service';
import {
  ScoringWeights,
  DEFAULT_SCORING_WEIGHTS,
  HiringStage,
  PositionLevel,
  ConfigResponse,
} from '../../../models/talent-flow.models';
import { STAGE_LABELS } from '../../../components/stage-selector/stage-selector.component';

// ─── Scoring Weights ─────────────────────────────────────────────────────────

interface WeightCriterion {
  key: keyof ScoringWeights;
  label: string;
  icon: string;
}

const CRITERIA: WeightCriterion[] = [
  { key: 'technical',      label: 'Technical Skills', icon: 'pi-code' },
  { key: 'communication',  label: 'Communication',    icon: 'pi-comments' },
  { key: 'culturalFit',    label: 'Cultural Fit',     icon: 'pi-heart' },
  { key: 'problemSolving', label: 'Problem Solving',  icon: 'pi-lightbulb' },
];

// ─── SLA Thresholds ──────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: Record<HiringStage, number> = {
  APPLICATION_REVIEW:  48,
  PHONE_SCREENING:     72,
  TECHNICAL_INTERVIEW: 120,
  PANEL_INTERVIEW:     120,
  EVALUATION:          48,
  OFFER_PREPARATION:   72,
  OFFER_APPROVAL:      48,
  OFFER_DELIVERY:      24,
  CONTRACT_SIGNING:    72,
  PRE_BOARDING:        168,
  ONBOARDING:          240,
};

// ─── Panel Rules ─────────────────────────────────────────────────────────────

export interface PanelRulesData {
  votesRequired: Record<PositionLevel, number>;
  strongNoVetoEnabled: boolean;
}

const DEFAULT_PANEL_RULES: PanelRulesData = {
  votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 3, DIRECTOR: 4 },
  strongNoVetoEnabled: true,
};

const LEVELS: { value: PositionLevel; label: string; icon: string }[] = [
  { value: 'JUNIOR',   label: 'Junior',   icon: 'pi-user' },
  { value: 'MID',      label: 'Mid',      icon: 'pi-users' },
  { value: 'SENIOR',   label: 'Senior',   icon: 'pi-star' },
  { value: 'DIRECTOR', label: 'Director', icon: 'pi-crown' },
];

// ─── Hub Component ────────────────────────────────────────────────────────────

@Component({
  selector: 'tf-config-hub-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SliderModule,
    InputNumberModule,
    ToggleButtonModule,
    AccordionModule,
  ],
  templateUrl: './config-hub-page.component.html',
  styleUrl: './config-hub-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigHubPageComponent implements OnInit {
  private readonly api = inject(TalentFlowApiService);

  // ── Scoring Weights ────────────────────────────────────────────────────────
  readonly criteria = CRITERIA;
  readonly swLoading     = signal(true);
  readonly swSaving      = signal(false);
  readonly swError       = signal<string | null>(null);
  readonly swSuccess     = signal(false);
  readonly swVersion     = signal<string>('—');
  readonly weights       = signal<ScoringWeights>({ ...DEFAULT_SCORING_WEIGHTS });

  readonly total     = computed(() => {
    const w = this.weights();
    return w.technical + w.communication + w.culturalFit + w.problemSolving;
  });
  readonly remaining = computed(() => 100 - this.total());
  readonly valid     = computed(() => this.total() === 100);

  // ── SLA Thresholds ─────────────────────────────────────────────────────────
  readonly stages: HiringStage[] = Object.keys(DEFAULT_THRESHOLDS) as HiringStage[];
  readonly stageLabels = STAGE_LABELS;

  readonly slaLoading   = signal(true);
  readonly slaSaving    = signal(false);
  readonly slaError     = signal<string | null>(null);
  readonly slaSuccess   = signal(false);
  readonly slaVersion   = signal<string>('—');
  readonly thresholds   = signal<Record<HiringStage, number>>({ ...DEFAULT_THRESHOLDS });

  // ── Panel Rules ────────────────────────────────────────────────────────────
  readonly levels = LEVELS;

  readonly panelLoading  = signal(true);
  readonly panelSaving   = signal(false);
  readonly panelError    = signal<string | null>(null);
  readonly panelSuccess  = signal(false);
  readonly panelVersion  = signal<string>('—');
  readonly rules         = signal<PanelRulesData>({
    votesRequired: { ...DEFAULT_PANEL_RULES.votesRequired },
    strongNoVetoEnabled: DEFAULT_PANEL_RULES.strongNoVetoEnabled,
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.api.getConfig('SCORING_WEIGHTS').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<ScoringWeights>;
        this.weights.set({
          technical:      d.technical      ?? DEFAULT_SCORING_WEIGHTS.technical,
          communication:  d.communication  ?? DEFAULT_SCORING_WEIGHTS.communication,
          culturalFit:    d.culturalFit    ?? DEFAULT_SCORING_WEIGHTS.culturalFit,
          problemSolving: d.problemSolving ?? DEFAULT_SCORING_WEIGHTS.problemSolving,
        });
        this.swVersion.set(cfg.version);
        this.swLoading.set(false);
      },
      error: () => this.swLoading.set(false),
    });

    this.api.getConfig('SLA_THRESHOLDS').subscribe({
      next: (cfg: ConfigResponse) => {
        const data = cfg.data as Partial<Record<HiringStage, number>>;
        const merged = { ...this.thresholds() };
        (Object.keys(data) as HiringStage[]).forEach((k) => {
          if (data[k] !== undefined) merged[k] = data[k] as number;
        });
        this.thresholds.set(merged);
        this.slaVersion.set(cfg.version);
        this.slaLoading.set(false);
      },
      error: () => this.slaLoading.set(false),
    });

    this.api.getConfig('PANEL_CONFIG').subscribe({
      next: (cfg: ConfigResponse) => {
        const data = cfg.data as Partial<PanelRulesData>;
        this.rules.set({
          votesRequired: {
            ...DEFAULT_PANEL_RULES.votesRequired,
            ...(data.votesRequired ?? {}),
          },
          strongNoVetoEnabled: data.strongNoVetoEnabled ?? DEFAULT_PANEL_RULES.strongNoVetoEnabled,
        });
        this.panelVersion.set(cfg.version);
        this.panelLoading.set(false);
      },
      error: () => this.panelLoading.set(false),
    });
  }

  // ── Scoring Weights actions ────────────────────────────────────────────────

  updateWeight(key: keyof ScoringWeights, value: number): void {
    this.weights.update((w) => ({ ...w, [key]: value }));
    this.swSuccess.set(false);
  }

  saveScoringWeights(): void {
    if (!this.valid() || this.swSaving()) return;
    this.swSaving.set(true);
    this.swError.set(null);
    this.swSuccess.set(false);
    this.api.updateConfig('SCORING_WEIGHTS', this.weights()).subscribe({
      next: (cfg: ConfigResponse) => {
        this.swVersion.set(cfg.version);
        this.swSaving.set(false);
        this.swSuccess.set(true);
      },
      error: (err: { userMessage?: string }) => {
        this.swError.set(err.userMessage ?? 'Failed to save.');
        this.swSaving.set(false);
      },
    });
  }

  // ── SLA Thresholds actions ─────────────────────────────────────────────────

  updateThreshold(stage: HiringStage, value: number): void {
    this.thresholds.update((t) => ({ ...t, [stage]: value }));
    this.slaSuccess.set(false);
  }

  saveSlaThresholds(): void {
    if (this.slaSaving()) return;
    this.slaSaving.set(true);
    this.slaError.set(null);
    this.slaSuccess.set(false);
    this.api.updateConfig('SLA_THRESHOLDS', this.thresholds()).subscribe({
      next: (cfg: ConfigResponse) => {
        this.slaVersion.set(cfg.version);
        this.slaSaving.set(false);
        this.slaSuccess.set(true);
      },
      error: (err: { userMessage?: string }) => {
        this.slaError.set(err.userMessage ?? 'Failed to save.');
        this.slaSaving.set(false);
      },
    });
  }

  // ── Panel Rules actions ────────────────────────────────────────────────────

  updateVotesRequired(level: PositionLevel, value: number): void {
    this.rules.update((r) => ({
      ...r,
      votesRequired: { ...r.votesRequired, [level]: value },
    }));
    this.panelSuccess.set(false);
  }

  toggleStrongNo(enabled: boolean): void {
    this.rules.update((r) => ({ ...r, strongNoVetoEnabled: enabled }));
    this.panelSuccess.set(false);
  }

  savePanelRules(): void {
    if (this.panelSaving()) return;
    this.panelSaving.set(true);
    this.panelError.set(null);
    this.panelSuccess.set(false);
    this.api.updateConfig('PANEL_CONFIG', this.rules()).subscribe({
      next: (cfg: ConfigResponse) => {
        this.panelVersion.set(cfg.version);
        this.panelSaving.set(false);
        this.panelSuccess.set(true);
      },
      error: (err: { userMessage?: string }) => {
        this.panelError.set(err.userMessage ?? 'Failed to save.');
        this.panelSaving.set(false);
      },
    });
  }
}
