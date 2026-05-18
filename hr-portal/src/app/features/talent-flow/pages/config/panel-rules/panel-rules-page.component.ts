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
import { TalentFlowApiService } from '../../../services/talent-flow-api.service';
import { PositionLevel } from '../../../models/talent-flow.models';

/**
 * PanelRulesPageComponent — FE-007 / NH-140
 *
 * Route: /talent-flow/config/panel  (adminGuard protected)
 *
 * Loads current PANEL_CONFIG on init.
 * votesRequired per PositionLevel (JUNIOR/MID/SENIOR/DIRECTOR).
 * strongNoVetoEnabled global toggle.
 * PUT updateConfig('PANEL_CONFIG', rules)
 */

export interface PanelRulesData {
  votesRequired: Record<PositionLevel, number>;
  strongNoVetoEnabled: boolean;
}

const DEFAULT_PANEL_RULES: PanelRulesData = {
  votesRequired: {
    JUNIOR:   2,
    MID:      3,
    SENIOR:   3,
    DIRECTOR: 4,
  },
  strongNoVetoEnabled: true,
};

const LEVELS: { value: PositionLevel; label: string; icon: string }[] = [
  { value: 'JUNIOR',   label: 'Junior',   icon: 'pi-user' },
  { value: 'MID',      label: 'Mid',      icon: 'pi-users' },
  { value: 'SENIOR',   label: 'Senior',   icon: 'pi-star' },
  { value: 'DIRECTOR', label: 'Director', icon: 'pi-crown' },
];

@Component({
  selector: 'tf-panel-rules-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, ToggleButtonModule],
  templateUrl: './panel-rules-page.component.html',
  styleUrl:    './panel-rules-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelRulesPageComponent implements OnInit {
  private readonly api = inject(TalentFlowApiService);

  readonly levels        = LEVELS;
  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly saveError     = signal<string | null>(null);
  readonly saveSuccess   = signal(false);
  readonly configVersion = signal<string>('—');

  readonly rules = signal<PanelRulesData>({
    votesRequired: { ...DEFAULT_PANEL_RULES.votesRequired },
    strongNoVetoEnabled: DEFAULT_PANEL_RULES.strongNoVetoEnabled,
  });

  ngOnInit(): void {
    this.api.getConfig('PANEL_CONFIG').subscribe({
      next: (cfg: import('../../../models/talent-flow.models').ConfigResponse) => {
        const data = cfg.data as Partial<PanelRulesData>;
        this.rules.set({
          votesRequired: {
            ...DEFAULT_PANEL_RULES.votesRequired,
            ...(data.votesRequired ?? {}),
          },
          strongNoVetoEnabled: data.strongNoVetoEnabled ?? DEFAULT_PANEL_RULES.strongNoVetoEnabled,
        });
        this.configVersion.set(cfg.version);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  updateVotesRequired(level: PositionLevel, value: number): void {
    this.rules.update((r) => ({
      ...r,
      votesRequired: { ...r.votesRequired, [level]: value },
    }));
    this.saveSuccess.set(false);
  }

  toggleStrongNo(enabled: boolean): void {
    this.rules.update((r) => ({ ...r, strongNoVetoEnabled: enabled }));
    this.saveSuccess.set(false);
  }

  save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.saveSuccess.set(false);

    this.api.updateConfig('PANEL_CONFIG', this.rules()).subscribe({
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
