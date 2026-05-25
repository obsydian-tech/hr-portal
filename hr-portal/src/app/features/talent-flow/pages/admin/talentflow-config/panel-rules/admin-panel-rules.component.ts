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
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../models/talent-flow.models';
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
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, ToggleButtonModule, ConfigVersionBadgeComponent],
  templateUrl: './admin-panel-rules.component.html',
  styleUrl:    './admin-panel-rules.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPanelRulesComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

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

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
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
      accept:  () => this.doSave(this.rules()),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset panel rules to factory defaults?',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSave({ ...DEFAULT_PANEL_RULES, votesRequired: { ...DEFAULT_PANEL_RULES.votesRequired } }),
    });
  }

  private doSave(payload: PanelRulesData): void {
    this.saving.set(true);
    this.api.updateConfig('PANEL_RULES', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.rules.set(payload);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Saved',
          detail:   `Panel rules saved as version ${cfg.version}.`,
          life:     4000,
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save Failed',
          detail:   err.userMessage ?? 'Could not save panel rules.',
          life:     5000,
        });
      },
    });
  }
}
