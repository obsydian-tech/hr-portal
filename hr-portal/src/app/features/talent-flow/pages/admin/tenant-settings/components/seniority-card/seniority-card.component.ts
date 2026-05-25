import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../../services/talent-flow-api.service';
import {
  ConfigResponse,
  DEFAULT_SCORING_WEIGHTS,
} from '../../../../../models/talent-flow.models';
import {
  SeniorityDefinitionsConfig,
  SeniorityLevel,
  DEFAULT_SENIORITY_LEVELS,
} from '../../../../../models/admin.models';
import { ConfigVersionBadgeComponent } from '../../../components/config-version-badge/config-version-badge.component';

/** Card 2 — Seniority Level Definitions */
@Component({
  selector: 'tf-seniority-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    ConfigVersionBadgeComponent,
  ],
  templateUrl: './seniority-card.component.html',
  styleUrl:    './seniority-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeniorityCardComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading        = signal(true);
  readonly saving         = signal(false);
  readonly configVersion  = signal<string | null>(null);
  readonly updatedAt      = signal<string | null>(null);
  readonly levels         = signal<SeniorityLevel[]>(
    structuredClone(DEFAULT_SENIORITY_LEVELS),
  );

  ngOnInit(): void {
    this.api.getConfig('SENIORITY_DEFINITIONS').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<SeniorityDefinitionsConfig>;
        if (d.levels?.length) {
          this.levels.set(d.levels.map((l) => ({ ...l })));
        }
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => {
        // Fall back to defaults — config may not exist yet
        this.loading.set(false);
      },
    });
  }

  patchLevel(
    index: number,
    field: keyof Omit<SeniorityLevel, 'key' | 'colour'>,
    value: string,
  ): void {
    this.levels.update((levels) => {
      const updated = [...levels];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message:
        'Save seniority level definitions? These labels appear across scoring, offers and workflow stages.',
      header: 'Save Seniority Definitions',
      icon:   'pi pi-exclamation-triangle',
      accept: () => this.doSave(),
    });
  }

  private doSave(): void {
    this.saving.set(true);
    const payload: SeniorityDefinitionsConfig = { levels: this.levels() };
    this.api.updateConfig('SENIORITY_DEFINITIONS', payload as unknown as Record<string, unknown>).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Saved',
          detail:   'Seniority definitions updated.',
          life:      4000,
        });
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save failed',
          detail:   'Could not save seniority definitions. Please try again.',
          life:      4000,
        });
      },
    });
  }
}
