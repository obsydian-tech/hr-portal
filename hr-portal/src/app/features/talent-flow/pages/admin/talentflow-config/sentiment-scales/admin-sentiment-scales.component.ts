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
import { InputTextModule } from 'primeng/inputtext';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { SelectModule } from 'primeng/select';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';

export type SentimentKey = 'VERY_INTERESTED' | 'INTERESTED' | 'NEUTRAL' | 'HESITANT' | 'DISENGAGED';

export interface SentimentScaleRow {
  key:            SentimentKey;
  label:          string;
  score:          number; // 1–5
  escalate:       boolean;
  escalationPath: string; // e.g. 'TA_REVIEW', 'MANAGER_ALERT', 'NONE'
}

const ESCALATION_PATHS = [
  { label: 'None',             value: 'NONE'           },
  { label: 'TA Review queue',  value: 'TA_REVIEW'      },
  { label: 'Manager alert',    value: 'MANAGER_ALERT'  },
  { label: 'Urgent re-engage', value: 'URGENT_REENGAGE' },
];

const DEFAULT_SCALES: SentimentScaleRow[] = [
  { key: 'VERY_INTERESTED', label: 'Very Interested', score: 5, escalate: false, escalationPath: 'NONE'           },
  { key: 'INTERESTED',      label: 'Interested',       score: 4, escalate: false, escalationPath: 'NONE'           },
  { key: 'NEUTRAL',         label: 'Neutral',          score: 3, escalate: false, escalationPath: 'NONE'           },
  { key: 'HESITANT',        label: 'Hesitant',         score: 2, escalate: true,  escalationPath: 'TA_REVIEW'      },
  { key: 'DISENGAGED',      label: 'Disengaged',       score: 1, escalate: true,  escalationPath: 'URGENT_REENGAGE' },
];

/**
 * AdminSentimentScalesComponent — Admin-S2 / TalentFlow Config
 *
 * Route: /platform/talentflow/admin/talentflow/sentiment-scales
 *
 * Configures the 5 fixed EngagementSentiment levels:
 *   • Display label per level
 *   • Numeric score (1–5) used in reporting aggregates
 *   • Escalate toggle — should this sentiment trigger an alert?
 *   • Escalation path — which workflow to trigger
 */
@Component({
  selector: 'tf-admin-sentiment-scales',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, InputTextModule, ToggleButtonModule, SelectModule, ConfigVersionBadgeComponent],
  templateUrl: './admin-sentiment-scales.component.html',
  styleUrl:    './admin-sentiment-scales.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSentimentScalesComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading        = signal(true);
  readonly saving         = signal(false);
  readonly scales         = signal<SentimentScaleRow[]>(DEFAULT_SCALES.map((s) => ({ ...s })));
  readonly configVersion  = signal<string | null>(null);
  readonly updatedAt      = signal<string | null>(null);
  readonly escalationPaths = ESCALATION_PATHS;

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('SENTIMENT_SCALES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as { scales?: SentimentScaleRow[] };
        if (Array.isArray(d.scales)) {
          this.scales.set(
            DEFAULT_SCALES.map((def) => {
              const saved = d.scales!.find((s) => s.key === def.key);
              return saved ? { ...def, ...saved } : { ...def };
            }),
          );
        }
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  updateRow(key: SentimentKey, patch: Partial<SentimentScaleRow>): void {
    this.scales.update((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save sentiment scales? Changes affect how candidate engagement is scored and escalated.',
      header:  'Save Sentiment Scales',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(this.scales()),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset all sentiment scales to factory defaults?',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSave(DEFAULT_SCALES.map((s) => ({ ...s }))),
    });
  }

  private doSave(payload: SentimentScaleRow[]): void {
    this.saving.set(true);
    this.api.updateConfig('SENTIMENT_SCALES', { scales: payload }).subscribe({
      next: (cfg: ConfigResponse) => {
        this.scales.set(payload);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Saved',
          detail:   `Sentiment scales saved as version ${cfg.version}.`,
          life:     4000,
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save Failed',
          detail:   err.userMessage ?? 'Could not save sentiment scales.',
          life:     5000,
        });
      },
    });
  }
}
