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
import { ToggleButtonModule } from 'primeng/togglebutton';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse, PositionLevel } from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';

export interface PanelVotesRequired {
  JUNIOR: number;
  MID:    number;
  SENIOR: number;
}

export interface PanelRulesData {
  votesRequired:      PanelVotesRequired;
  strongNoVeto:       boolean;
  unanimousForSenior: boolean;
}

const DEFAULT_PANEL_RULES: PanelRulesData = {
  votesRequired:      { JUNIOR: 2, MID: 3, SENIOR: 3 },
  strongNoVeto:       true,
  unanimousForSenior: false,
};

// ── Interview Requirements (saved to PANEL_CONFIG) ────────────────────────────

export type InterviewType = 'PHONE_SCREEN' | 'TECHNICAL' | 'BEHAVIORAL' | 'CULTURE_FIT' | 'FINAL';

const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  PHONE_SCREEN: 'Phone Screen',
  TECHNICAL:    'Technical',
  BEHAVIORAL:   'Behavioral',
  CULTURE_FIT:  'Culture Fit',
  FINAL:        'Final',
};

const ALL_INTERVIEW_TYPES: InterviewType[] = ['PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL', 'CULTURE_FIT', 'FINAL'];

const ALL_LEVELS: PositionLevel[] = ['JUNIOR', 'MID', 'SENIOR'];

/** Default: Phone Screen required for all; Technical required for MID+SENIOR; Behavioral for SENIOR */
const DEFAULT_INTERVIEW_REQS: Record<PositionLevel, Record<InterviewType, boolean>> = {
  JUNIOR: { PHONE_SCREEN: true,  TECHNICAL: false, BEHAVIORAL: false, CULTURE_FIT: false, FINAL: false },
  MID:    { PHONE_SCREEN: true,  TECHNICAL: true,  BEHAVIORAL: false, CULTURE_FIT: false, FINAL: false },
  SENIOR: { PHONE_SCREEN: true,  TECHNICAL: true,  BEHAVIORAL: true,  CULTURE_FIT: false, FINAL: false },
};

/**
 * AdminPanelRulesComponent — Admin-S2 / TalentFlow Config
 *
 * Route: /platform/talentflow/admin/talentflow/panel-rules
 *
 * Configures the interview panel decision rules:
 *   • Minimum affirmative votes required per seniority level
 *   • Strong-No veto flag (one panellist's strong-no blocks an advance)
 *   • Unanimous agreement required for senior-level hires
 */
@Component({
  selector: 'tf-admin-panel-rules',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, ToggleButtonModule, CheckboxModule, ConfigVersionBadgeComponent],
  templateUrl: './admin-panel-rules.component.html',
  styleUrl:    './admin-panel-rules.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPanelRulesComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  // ── Panel Rules (PANEL_RULES config) ──────────────────────────────────────
  readonly loading      = signal(true);
  readonly saving       = signal(false);
  readonly rules        = signal<PanelRulesData>({ ...DEFAULT_PANEL_RULES, votesRequired: { ...DEFAULT_PANEL_RULES.votesRequired } });
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt    = signal<string | null>(null);

  readonly levels: Array<{ key: keyof PanelVotesRequired; label: string }> = [
    { key: 'JUNIOR', label: 'Junior' },
    { key: 'MID',    label: 'Mid'    },
    { key: 'SENIOR', label: 'Senior' },
  ];

  // ── Interview Requirements (PANEL_CONFIG) ──────────────────────────────────
  readonly interviewTypes    = ALL_INTERVIEW_TYPES;
  readonly interviewLevels   = ALL_LEVELS;
  readonly interviewTypeLabels = INTERVIEW_TYPE_LABELS;

  readonly irLoading  = signal(true);
  readonly irSaving   = signal(false);
  readonly irVersion  = signal<string | null>(null);
  readonly irUpdatedAt = signal<string | null>(null);
  /** Full PANEL_CONFIG data (preserved when saving interviewRequirements) */
  private panelConfigData: Record<string, unknown> = {};
  /** UI state: matrix of required flags */
  readonly interviewReqs = signal<Record<PositionLevel, Record<InterviewType, boolean>>>(
    JSON.parse(JSON.stringify(DEFAULT_INTERVIEW_REQS)),
  );

  ngOnInit(): void {
    this.loadPanelRules();
    this.loadPanelConfig();
  }

  // ── Panel Rules load / save ───────────────────────────────────────────────

  private loadPanelRules(): void {
    this.loading.set(true);
    this.api.getConfig('PANEL_RULES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<PanelRulesData>;
        this.rules.set({
          votesRequired:      { ...DEFAULT_PANEL_RULES.votesRequired, ...(d.votesRequired ?? {}) },
          strongNoVeto:       d.strongNoVeto       ?? DEFAULT_PANEL_RULES.strongNoVeto,
          unanimousForSenior: d.unanimousForSenior ?? DEFAULT_PANEL_RULES.unanimousForSenior,
        });
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  updateVotes(level: keyof PanelVotesRequired, value: number): void {
    this.rules.update((r) => ({
      ...r,
      votesRequired: { ...r.votesRequired, [level]: value },
    }));
  }

  toggleFlag(flag: 'strongNoVeto' | 'unanimousForSenior'): void {
    this.rules.update((r) => ({ ...r, [flag]: !r[flag] }));
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save these panel rules? Changes affect all new interview panel evaluations.',
      header:  'Save Panel Rules',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSavePanelRules(this.rules()),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset panel rules to factory defaults?',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSavePanelRules({ ...DEFAULT_PANEL_RULES, votesRequired: { ...DEFAULT_PANEL_RULES.votesRequired } }),
    });
  }

  private doSavePanelRules(payload: PanelRulesData): void {
    this.saving.set(true);
    this.api.updateConfig('PANEL_RULES', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.rules.set(payload);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Panel rules saved as version ${cfg.version}.`, life: 4000 });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: err.userMessage ?? 'Could not save panel rules.', life: 5000 });
      },
    });
  }

  // ── Interview Requirements load / save ───────────────────────────────────

  private loadPanelConfig(): void {
    this.irLoading.set(true);
    this.api.getConfig('PANEL_CONFIG').subscribe({
      next: (cfg: ConfigResponse) => {
        this.panelConfigData = (cfg.data ?? {}) as Record<string, unknown>;
        const saved = this.panelConfigData['interviewRequirements'] as
          Partial<Record<PositionLevel, Array<{ type: string; required: boolean }>>> | undefined;

        if (saved) {
          const reqs = JSON.parse(JSON.stringify(DEFAULT_INTERVIEW_REQS)) as Record<PositionLevel, Record<InterviewType, boolean>>;
          for (const lvl of ALL_LEVELS) {
            const arr = saved[lvl];
            if (Array.isArray(arr)) {
              for (const entry of arr) {
                if (ALL_INTERVIEW_TYPES.includes(entry.type as InterviewType)) {
                  reqs[lvl][entry.type as InterviewType] = entry.required !== false;
                }
              }
            }
          }
          this.interviewReqs.set(reqs);
        }
        this.irVersion.set(cfg.version);
        this.irUpdatedAt.set(cfg.updatedAt);
        this.irLoading.set(false);
      },
      error: () => { this.irLoading.set(false); },
    });
  }

  toggleInterviewReq(level: PositionLevel, type: InterviewType, checked: boolean): void {
    this.interviewReqs.update((reqs) => ({
      ...reqs,
      [level]: { ...reqs[level], [type]: checked },
    }));
  }

  isReqChecked(level: PositionLevel, type: InterviewType): boolean {
    return this.interviewReqs()[level][type];
  }

  confirmSaveInterviewReqs(): void {
    if (this.irSaving()) return;
    this.confirmService.confirm({
      message: 'Save interview requirements? This determines which interview types must be completed before a candidate can advance from INTERVIEWING.',
      header:  'Save Interview Requirements',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSaveInterviewReqs(),
    });
  }

  private buildInterviewReqsPayload(): Record<PositionLevel, Array<{ type: string; required: boolean }>> {
    const reqs = this.interviewReqs();
    const result = {} as Record<PositionLevel, Array<{ type: string; required: boolean }>>;
    for (const lvl of ALL_LEVELS) {
      result[lvl] = ALL_INTERVIEW_TYPES.map((t) => ({ type: t, required: reqs[lvl][t] }));
    }
    return result;
  }

  private doSaveInterviewReqs(): void {
    this.irSaving.set(true);
    // Merge interviewRequirements into the full PANEL_CONFIG (preserve votesRequired etc.)
    const merged = { ...this.panelConfigData, interviewRequirements: this.buildInterviewReqsPayload() };
    this.api.updateConfig('PANEL_CONFIG', merged).subscribe({
      next: (cfg: ConfigResponse) => {
        this.panelConfigData = (cfg.data ?? merged) as Record<string, unknown>;
        this.irVersion.set(cfg.version);
        this.irUpdatedAt.set(cfg.updatedAt);
        this.irSaving.set(false);
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Interview requirements saved as version ${cfg.version}.`, life: 4000 });
      },
      error: (err: { userMessage?: string }) => {
        this.irSaving.set(false);
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: err.userMessage ?? 'Could not save interview requirements.', life: 5000 });
      },
    });
  }
}
