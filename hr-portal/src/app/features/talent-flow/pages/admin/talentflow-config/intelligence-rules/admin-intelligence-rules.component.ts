import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConfirmationService } from 'primeng/api';
import { MessageService } from 'primeng/api';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { SelectModule } from 'primeng/select';

import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';
import { ConfigResponse, IntelligenceRule, IntelligenceRulesConfig } from '../../../../models/talent-flow.models';

const DEFAULT_CONFIG: IntelligenceRulesConfig = {
  rules: []
};

@Component({
  selector: 'tf-admin-intelligence-rules',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    ToggleButtonModule,
    SelectModule,
    ConfigVersionBadgeComponent,
  ],
  templateUrl: './admin-intelligence-rules.component.html',
  styleUrl:    './admin-intelligence-rules.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminIntelligenceRulesComponent implements OnInit {
  private readonly api             = inject(TalentFlowApiService);
  private readonly messageService  = inject(MessageService);
  private readonly confirmService  = inject(ConfirmationService);

  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly configData    = signal<IntelligenceRulesConfig>({ ...DEFAULT_CONFIG });
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('INTELLIGENCE_RULES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<IntelligenceRulesConfig>;
        this.configData.set({ ...DEFAULT_CONFIG, ...d });
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save Intelligence Layer rules? Changes take effect immediately.',
      header:  'Save Rules',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(this.configData()),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset to factory defaults? This will remove all configured rules.',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSave({ ...DEFAULT_CONFIG }),
    });
  }

  private doSave(payload: IntelligenceRulesConfig): void {
    this.saving.set(true);
    this.api.updateConfig('INTELLIGENCE_RULES', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configData.set(payload);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Saved',
          detail:   `Intelligence rules saved as version ${cfg.version}.`,
          life:     4000,
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save Failed',
          detail:   err.userMessage ?? 'Could not save rules.',
          life:     5000,
        });
      },
    });
  }
}
