import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HiringStage } from '../../models/talent-flow.models';

/**
 * StageSelector
 *
 * Design source: naleko-design-handoff/preview/22-wizard-stepper.html
 * - .wz-dot.done  → completed stage: naleko-success (#2e7d32), pi-check icon
 * - .wz-dot.act   → current stage:  naleko-primary (#16124d), ring shadow
 * - .wz-dot       → pending stage:  #e9ecef grey, locked
 * - .wz-line.done → green connector; .wz-line → grey connector
 *
 * Tech stack: Angular 19 standalone, input(), output(), computed(),
 * PrimeIcons, PrimeFlex, --naleko-* tokens, OnPush.
 */

/** Human-readable labels for HiringStage values */
export const STAGE_LABELS: Record<HiringStage, string> = {
  CREATED:                     'Created',
  INTERVIEW_1_SCHEDULED:       'Interview 1',
  INTERVIEW_1_COMPLETED:       'Interview 1',
  EVALUATION_IN_PROGRESS:      'Evaluation',
  SHORTLISTED:                 'Shortlisted',
  INTERVIEW_2_SCHEDULED:       'Interview 2',
  INTERVIEW_2_COMPLETED:       'Interview 2',
  FINAL_EVALUATION_IN_PROGRESS:'Final Eval',
  HIRE_APPROVED:               'Approved',
  OFFER_IN_PROGRESS:           'Offer',
  OFFER_SENT:                  'Offer Sent',
  OFFER_ACCEPTED:              'Accepted',
  OFFER_REJECTED:              'Rejected',
  OFFER_EXPIRED:               'Expired',
  REJECTED:                    'Rejected',
  ONBOARDING_INITIATED:        'Onboarding',
  COMPLIANCE_IN_PROGRESS:      'Compliance',
  COMPLIANCE_CLEARED:          'Cleared',
  COMPLIANCE_FAILED:           'Comp. Failed',
  PROVISIONING_IN_PROGRESS:    'Provisioning',
  PROVISIONING_COMPLETE:       'Provisioned',
  AWAITING_DAY1:               'Awaiting Day 1',
  ENGAGEMENT_AT_RISK:          'Eng. At Risk',
  ACTIVE:                      'Active',
  TERMINATED:                  'Terminated',
};

export type StageState = 'completed' | 'current' | 'pending';

export interface StageItem {
  stage: HiringStage;
  label: string;
  state: StageState;
  index: number;
}

@Component({
  selector: 'tf-stage-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stage-selector.component.html',
  styleUrl: './stage-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageSelectorComponent {
  readonly stages       = input.required<HiringStage[]>();
  readonly currentStage = input.required<HiringStage>();
  readonly readonly     = input<boolean>(false);

  /** Emits the selected stage when a completed stage dot is clicked */
  readonly stageSelected = output<HiringStage>();

  readonly stageItems = computed<StageItem[]>(() => {
    const stages       = this.stages();
    const currentStage = this.currentStage();
    const currentIdx   = stages.indexOf(currentStage);

    return stages.map((stage, index) => ({
      stage,
      label: STAGE_LABELS[stage] ?? stage,
      index,
      state: index < currentIdx ? 'completed' : index === currentIdx ? 'current' : 'pending',
    }));
  });

  onStageClick(item: StageItem): void {
    if (this.readonly()) return;
    if (item.state === 'completed') {
      this.stageSelected.emit(item.stage);
    }
  }
}
