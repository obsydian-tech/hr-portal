import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse, HiringStage } from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';

const ALL_STAGES: HiringStage[] = [
  'APPLICATION_REVIEW',
  'INTERVIEWING',
  'EVALUATION',
  'BACKGROUND_CHECK',
  'OFFER_PREPARATION',
  'OFFER_APPROVAL',
  'OFFER_DELIVERY',
  'CONTRACT_SIGNING',
  'PRE_BOARDING',
  'ONBOARDING',
];

const STAGE_LABELS: Record<HiringStage, string> = {
  APPLICATION_REVIEW: 'Application Review',
  INTERVIEWING:       'Interviewing',
  EVALUATION:         'Evaluation',
  BACKGROUND_CHECK:   'Background Check',
  OFFER_PREPARATION:  'Offer Preparation',
  OFFER_APPROVAL:     'Offer Approval',
  OFFER_DELIVERY:     'Offer Delivery',
  CONTRACT_SIGNING:   'Contract Signing',
  PRE_BOARDING:       'Pre-Boarding',
  ONBOARDING:         'Onboarding',
};

const STAGE_PHASE: Record<HiringStage, string> = {
  APPLICATION_REVIEW: 'Phase 1 — Interview & Evaluation',
  INTERVIEWING:       'Phase 1 — Interview & Evaluation',
  EVALUATION:         'Phase 1 — Interview & Evaluation',
  BACKGROUND_CHECK:   'Phase 2 — Offer & Acceptance',
  OFFER_PREPARATION:  'Phase 2 — Offer & Acceptance',
  OFFER_APPROVAL:     'Phase 2 — Offer & Acceptance',
  OFFER_DELIVERY:     'Phase 2 — Offer & Acceptance',
  CONTRACT_SIGNING:   'Phase 2 — Offer & Acceptance',
  PRE_BOARDING:       'Phase 3 — Pre-Onboarding',
  ONBOARDING:         'Phase 4 — Onboarding & Day 1',
};

@Component({
  selector: 'tf-admin-stage-config',
  standalone: true,
  imports: [FormsModule, ToggleButtonModule, ConfigVersionBadgeComponent],
  templateUrl: './admin-stage-config.component.html',
  styleUrl:    './admin-stage-config.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminStageConfigComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly allStages     = ALL_STAGES;
  readonly stageLabels   = STAGE_LABELS;
  readonly stagePhase    = STAGE_PHASE;

  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);
  readonly enabled       = signal<Set<HiringStage>>(new Set(ALL_STAGES));

  ngOnInit(): void {
    this.api.getConfig('STAGE_CONFIG').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<{ enabled: HiringStage[] }>;
        const list = d.enabled && d.enabled.length > 0 ? d.enabled : ALL_STAGES;
        this.enabled.set(new Set(list));
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  isEnabled(stage: HiringStage): boolean {
    return this.enabled().has(stage);
  }

  toggle(stage: HiringStage, on: boolean): void {
    this.enabled.update((s) => {
      const next = new Set(s);
      on ? next.add(stage) : next.delete(stage);
      return next;
    });
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save stage configuration? The enabled stages define the hiring pipeline for all new candidates.',
      header:  'Save Stage Config',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset to all 10 stages enabled?',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => {
        this.enabled.set(new Set(ALL_STAGES));
        this.doSave();
      },
    });
  }

  private doSave(): void {
    this.saving.set(true);
    // preserve plan order when serialising
    const payload = { enabled: ALL_STAGES.filter((s) => this.enabled().has(s)) };
    this.api.updateConfig('STAGE_CONFIG', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Stage config saved as version ${cfg.version}.`, life: 4000 });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: err.userMessage ?? 'Could not save stage config.', life: 5000 });
      },
    });
  }
}
