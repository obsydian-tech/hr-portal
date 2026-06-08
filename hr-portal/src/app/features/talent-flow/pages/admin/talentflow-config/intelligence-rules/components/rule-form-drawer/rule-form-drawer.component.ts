import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  effect,
  computed,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { IntelligenceRule, RuleCondition, RuleAction } from '../../../../../../models/talent-flow.models';

// ── Signal Options ─────────────────────────────────────────────────────────────
// Available signals for condition builder
const SIGNAL_OPTIONS: Array<{ label: string; value: string; type: 'number' | 'string' | 'enum' }> = [
  // Stage & Time
  { label: 'Candidate Stage',           value: 'CANDIDATE_STAGE',           type: 'enum'   },
  { label: 'Days in Current Stage',     value: 'DAYS_IN_CURRENT_STAGE',     type: 'number' },
  { label: 'Days Since Created',        value: 'DAYS_SINCE_CANDIDATE_CREATED', type: 'number' },

  // SLA
  { label: 'SLA Status',                value: 'SLA_STATUS',                type: 'enum'   },
  { label: 'Days Since SLA Breach',     value: 'DAYS_SINCE_SLA_BREACH',     type: 'number' },

  // Scores
  { label: 'Final Score',               value: 'FINAL_SCORE',               type: 'number' },
  { label: 'Evaluation Result',         value: 'EVALUATION_RESULT',         type: 'enum'   },
  { label: 'Candidate Risk Score',      value: 'CANDIDATE_RISK_SCORE',      type: 'number' },

  // Engagement
  { label: 'Engagement Score',          value: 'ENGAGEMENT_SCORE',          type: 'number' },
  { label: 'Engagement Sentiment',      value: 'ENGAGEMENT_SENTIMENT',      type: 'enum'   },
  { label: 'Interview Sentiment',       value: 'INTERVIEW_SENTIMENT',       type: 'enum'   },

  // Offer
  { label: 'Offer Days to Expiry',      value: 'OFFER_DAYS_TO_EXPIRY',      type: 'number' },

  // HM/TA Activity
  { label: 'HM Days Since Login',       value: 'HM_DAYS_SINCE_LOGIN',       type: 'number' },
  { label: 'TA Days Since Action',      value: 'TA_DAYS_SINCE_CANDIDATE_ACTION', type: 'number' },

  // IT/Onboarding
  { label: 'Days to Start Date',        value: 'DAYS_TO_START_DATE',        type: 'number' },
  { label: 'Equipment Request Status',  value: 'EQUIPMENT_REQUEST_STATUS',  type: 'enum'   },
  { label: 'Access Provisioned',        value: 'ACCESS_PROVISIONED',        type: 'enum'   },
  { label: 'Onboarding Readiness',      value: 'ONBOARDING_READINESS',      type: 'number' },
];

const OPERATOR_OPTIONS: Array<{ label: string; value: RuleCondition['operator'] }> = [
  { label: 'Equals',                 value: 'equals'              },
  { label: 'Not Equals',             value: 'notEquals'           },
  { label: 'Greater Than',           value: 'greaterThan'         },
  { label: 'Greater Than or Equal',  value: 'greaterThanOrEqual'  },
  { label: 'Less Than',              value: 'lessThan'            },
  { label: 'Less Than or Equal',     value: 'lessThanOrEqual'     },
  { label: 'In List',                value: 'in'                  },
  { label: 'Not In List',            value: 'notIn'               },
];

const PRIORITY_OPTIONS: Array<{ label: string; value: 'HIGH' | 'MEDIUM' | 'LOW' }> = [
  { label: 'High',   value: 'HIGH'   },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'Low',    value: 'LOW'    },
];

const ACTION_TYPE_OPTIONS: Array<{ label: string; value: string; recipient: string }> = [
  // TA Actions
  { label: 'Alert TA - Urgent',           value: 'ALERT_TA_URGENT',           recipient: 'TA'    },
  { label: 'Notify TA - Follow Up',       value: 'NOTIFY_TA_FOLLOWUP',        recipient: 'TA'    },
  { label: 'Notify TA - Offer Expiry',    value: 'NOTIFY_TA_OFFER_EXPIRY',    recipient: 'TA'    },
  { label: 'Alert TA - Stale Candidate',  value: 'ALERT_TA_STALE_CANDIDATE',  recipient: 'TA'    },

  // HM Actions
  { label: 'Alert HM - Urgent',           value: 'ALERT_HM_URGENT',           recipient: 'HM'    },
  { label: 'Notify HM - Offer Expiry',    value: 'NOTIFY_HM_OFFER_EXPIRY',    recipient: 'HM'    },
  { label: 'Notify HM - Login Required',  value: 'NOTIFY_HM_LOGIN_REQUIRED',  recipient: 'HM'    },
  { label: 'Notify HM - Fast Track',      value: 'NOTIFY_HM_FAST_TRACK',      recipient: 'HM'    },

  // IT Actions
  { label: 'Alert IT - Provisioning',     value: 'ALERT_IT_PROVISIONING',     recipient: 'IT'    },
  { label: 'Notify IT - Equipment',       value: 'NOTIFY_IT_EQUIPMENT',       recipient: 'IT'    },

  // Admin Actions
  { label: 'Escalate to Admin',           value: 'ESCALATE_TO_ADMIN',         recipient: 'ADMIN' },

  // Generic
  { label: 'Custom Notification',         value: 'CUSTOM_NOTIFICATION',       recipient: 'TA'    },
];

const EMPTY_RULE = (): IntelligenceRule => ({
  id:          `RULE-${Date.now().toString(36).toUpperCase()}`,
  name:        '',
  description: '',
  enabled:     true,
  priority:    'MEDIUM',
  conditions:  [],
  action:      { type: 'CUSTOM_NOTIFICATION', priority: 'MEDIUM', cooldown: 24 },
  cooldown:    24,
});

const EMPTY_CONDITION = (): RuleCondition => ({
  signal:   'CANDIDATE_STAGE',
  operator: 'equals',
  value:    '',
});

/**
 * RuleFormDrawerComponent — 560px sidebar for create/edit intelligence rules.
 * Phase 6.5.1
 */
@Component({
  selector: 'tf-rule-form-drawer',
  standalone: true,
  imports: [FormsModule, DrawerModule, SelectModule, InputNumberModule, ToggleButtonModule],
  templateUrl: './rule-form-drawer.component.html',
  styleUrl:    './rule-form-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleFormDrawerComponent {
  readonly visible = input<boolean>(false);
  readonly rule    = input<IntelligenceRule | null>(null);

  readonly saved   = output<IntelligenceRule>();
  readonly deleted = output<string>();
  readonly closed  = output<void>();

  readonly form       = signal<IntelligenceRule>(EMPTY_RULE());
  readonly isEditMode = signal(false);

  // Dropdown options
  readonly signalOptions   = SIGNAL_OPTIONS;
  readonly operatorOptions = OPERATOR_OPTIONS;
  readonly priorityOptions = PRIORITY_OPTIONS;
  readonly actionOptions   = ACTION_TYPE_OPTIONS;

  readonly valid = computed(() => {
    const f = this.form();
    return (
      f.name.trim().length > 0 &&
      f.conditions.length > 0 &&
      f.conditions.every(c => c.signal && c.operator && c.value !== '')
    );
  });

  constructor() {
    // Sync form when rule input changes
    effect(() => {
      const r = this.rule();
      untracked(() => {
        if (r) {
          this.form.set({
            ...r,
            conditions: r.conditions.map(c => ({ ...c })),
            action: { ...r.action },
          });
          this.isEditMode.set(true);
        } else {
          this.form.set(EMPTY_RULE());
          this.isEditMode.set(false);
        }
      });
    });
  }

  patchForm(patch: Partial<IntelligenceRule>): void {
    this.form.update(f => ({ ...f, ...patch }));
  }

  patchAction(patch: Partial<RuleAction>): void {
    this.form.update(f => ({
      ...f,
      action: { ...f.action, ...patch },
    }));
  }

  // ── Condition Management ─────────────────────────────────────────────────────

  addCondition(): void {
    this.form.update(f => ({
      ...f,
      conditions: [...f.conditions, EMPTY_CONDITION()],
    }));
  }

  updateCondition(index: number, patch: Partial<RuleCondition>): void {
    this.form.update(f => ({
      ...f,
      conditions: f.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  }

  removeCondition(index: number): void {
    this.form.update(f => ({
      ...f,
      conditions: f.conditions.filter((_, i) => i !== index),
    }));
  }

  // ── Signal Type Helper ───────────────────────────────────────────────────────

  getSignalType(signalValue: string): 'number' | 'string' | 'enum' {
    const opt = SIGNAL_OPTIONS.find(s => s.value === signalValue);
    return opt?.type ?? 'string';
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  submit(): void {
    if (!this.valid()) return;
    this.saved.emit({ ...this.form() });
  }

  confirmDelete(): void {
    if (this.isEditMode()) {
      this.deleted.emit(this.form().id);
    }
  }

  close(): void {
    this.closed.emit();
  }
}
