import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConfirmationService } from 'primeng/api';
import { MessageService } from 'primeng/api';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';

import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';
import { ConfigResponse, IntelligenceRule, IntelligenceRulesConfig, RuleCategory, IntelligenceThresholds } from '../../../../models/talent-flow.models';
import { RuleFormDrawerComponent } from './components/rule-form-drawer/rule-form-drawer.component';

// Phase 6.5.4: Default thresholds
const DEFAULT_THRESHOLDS: IntelligenceThresholds = {
  slaAtRiskDays:      3,
  slaBreachDays:      0,
  offerExpiryUrgent:  3,
  candidateStaleDays: 14,
  highScoreThreshold: 85,
  lowEngagementScore: 40,
  onboardingReadyPct: 75,
  riskScoreHigh:      60,
  riskScoreCritical:  80,
};

const DEFAULT_CONFIG: IntelligenceRulesConfig = {
  rules: [],
  thresholds: DEFAULT_THRESHOLDS,
};

// Priority badge styling
const PRIORITY_STYLES: Record<string, { bg: string; color: string }> = {
  HIGH:   { bg: 'color-mix(in srgb, var(--naleko-error) 12%, transparent)', color: 'var(--naleko-error)' },
  MEDIUM: { bg: 'color-mix(in srgb, var(--naleko-warning) 12%, transparent)', color: 'var(--naleko-warning)' },
  LOW:    { bg: 'color-mix(in srgb, var(--naleko-tertiary) 12%, transparent)', color: 'var(--naleko-tertiary)' },
};

// Category styling (Phase 6.5.2)
const CATEGORY_STYLES: Record<RuleCategory, { label: string; icon: string; color: string }> = {
  SLA_COMPLIANCE: { label: 'SLA',        icon: 'pi pi-clock',     color: 'var(--naleko-error)'     },
  ENGAGEMENT:     { label: 'Engagement', icon: 'pi pi-heart',     color: 'var(--naleko-primary)'   },
  OFFERS:         { label: 'Offers',     icon: 'pi pi-file',      color: 'var(--naleko-secondary)' },
  ONBOARDING:     { label: 'Onboarding', icon: 'pi pi-user-plus', color: 'var(--naleko-tertiary)'  },
  GENERAL:        { label: 'General',    icon: 'pi pi-bolt',      color: 'var(--naleko-outline)'   },
};

// Filter options for category dropdown
const CATEGORY_FILTER_OPTIONS: Array<{ label: string; value: RuleCategory | 'ALL' }> = [
  { label: 'All Categories',       value: 'ALL'            },
  { label: 'SLA & Compliance',     value: 'SLA_COMPLIANCE' },
  { label: 'Engagement',           value: 'ENGAGEMENT'     },
  { label: 'Offers & Approvals',   value: 'OFFERS'         },
  { label: 'Onboarding',           value: 'ONBOARDING'     },
  { label: 'General',              value: 'GENERAL'        },
];

@Component({
  selector: 'tf-admin-intelligence-rules',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    ToggleButtonModule,
    SelectModule,
    TooltipModule,
    ConfigVersionBadgeComponent,
    RuleFormDrawerComponent,
  ],
  templateUrl: './admin-intelligence-rules.component.html',
  styleUrl:    './admin-intelligence-rules.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminIntelligenceRulesComponent implements OnInit {
  private readonly api             = inject(TalentFlowApiService);
  private readonly messageService  = inject(MessageService);
  private readonly confirmService  = inject(ConfirmationService);

  // ── Config State ─────────────────────────────────────────────────────────────
  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly configData    = signal<IntelligenceRulesConfig>({ ...DEFAULT_CONFIG });
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);

  // ── Drawer State ─────────────────────────────────────────────────────────────
  readonly drawerVisible = signal(false);
  readonly editingRule   = signal<IntelligenceRule | null>(null);

  // ── Filter State (Phase 6.5.2) ───────────────────────────────────────────────
  readonly categoryFilter = signal<RuleCategory | 'ALL'>('ALL');
  readonly categoryFilterOptions = CATEGORY_FILTER_OPTIONS;

  // ── Thresholds Panel State (Phase 6.5.4) ─────────────────────────────────────
  readonly thresholdsPanelOpen = signal(false);

  // ── Computed ─────────────────────────────────────────────────────────────────
  readonly rulesCount  = computed(() => this.configData().rules.length);
  readonly enabledCount = computed(() => this.configData().rules.filter(r => r.enabled).length);

  // Filtered rules based on category
  readonly filteredRules = computed(() => {
    const filter = this.categoryFilter();
    const rules = this.configData().rules;
    if (filter === 'ALL') return rules;
    return rules.filter(r => r.category === filter);
  });

  // Category counts for stats
  readonly categoryCounts = computed(() => {
    const rules = this.configData().rules;
    return {
      SLA_COMPLIANCE: rules.filter(r => r.category === 'SLA_COMPLIANCE').length,
      ENGAGEMENT:     rules.filter(r => r.category === 'ENGAGEMENT').length,
      OFFERS:         rules.filter(r => r.category === 'OFFERS').length,
      ONBOARDING:     rules.filter(r => r.category === 'ONBOARDING').length,
      GENERAL:        rules.filter(r => r.category === 'GENERAL').length,
    };
  });

  readonly priorityStyles = PRIORITY_STYLES;
  readonly categoryStyles = CATEGORY_STYLES;

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

  // ── Drawer Actions ───────────────────────────────────────────────────────────

  openAddDrawer(): void {
    this.editingRule.set(null);
    this.drawerVisible.set(true);
  }

  openEditDrawer(rule: IntelligenceRule): void {
    this.editingRule.set(rule);
    this.drawerVisible.set(true);
  }

  closeDrawer(): void {
    this.drawerVisible.set(false);
    this.editingRule.set(null);
  }

  handleSave(rule: IntelligenceRule): void {
    const current = this.configData();
    const existingIndex = current.rules.findIndex(r => r.id === rule.id);

    let updatedRules: IntelligenceRule[];
    if (existingIndex >= 0) {
      // Update existing rule
      updatedRules = current.rules.map((r, i) => (i === existingIndex ? rule : r));
    } else {
      // Add new rule
      updatedRules = [...current.rules, rule];
    }

    this.doSave({ ...current, rules: updatedRules }, existingIndex >= 0 ? 'updated' : 'created');
    this.closeDrawer();
  }

  handleDelete(ruleId: string): void {
    this.confirmService.confirm({
      message: 'Delete this intelligence rule? This action cannot be undone.',
      header:  'Delete Rule',
      icon:    'pi pi-trash',
      acceptButtonStyleClass: 'p-button-danger',
      accept:  () => {
        const current = this.configData();
        const updatedRules = current.rules.filter(r => r.id !== ruleId);
        this.doSave({ ...current, rules: updatedRules }, 'deleted');
        this.closeDrawer();
      },
    });
  }

  // ── Toggle Rule ──────────────────────────────────────────────────────────────

  toggleRule(rule: IntelligenceRule): void {
    const current = this.configData();
    const updatedRules = current.rules.map(r =>
      r.id === rule.id ? { ...r, enabled: !r.enabled } : r
    );
    const updatedConfig: IntelligenceRulesConfig = { ...current, rules: updatedRules };

    // Optimistic update
    this.configData.set(updatedConfig);

    // Persist
    this.api.updateConfig('INTELLIGENCE_RULES', updatedConfig).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.messageService.add({
          severity: 'success',
          summary:  rule.enabled ? 'Disabled' : 'Enabled',
          detail:   `Rule "${rule.name}" ${rule.enabled ? 'disabled' : 'enabled'}.`,
          life:     3000,
        });
      },
      error: (err: { userMessage?: string }) => {
        // Revert on error
        this.configData.set(current);
        this.messageService.add({
          severity: 'error',
          summary:  'Failed',
          detail:   err.userMessage ?? 'Could not update rule.',
          life:     5000,
        });
      },
    });
  }

  // ── Save/Reset ───────────────────────────────────────────────────────────────

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save Intelligence Layer rules? Changes take effect immediately.',
      header:  'Save Rules',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(this.configData(), 'saved'),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset to factory defaults? This will remove all configured rules.',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSave({ ...DEFAULT_CONFIG }, 'reset'),
    });
  }

  private doSave(payload: IntelligenceRulesConfig, action: string = 'saved'): void {
    this.saving.set(true);
    this.api.updateConfig('INTELLIGENCE_RULES', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configData.set(payload);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Success',
          detail:   `Intelligence rules ${action} (version ${cfg.version}).`,
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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  getPriorityStyle(priority: string): { bg: string; color: string } {
    return PRIORITY_STYLES[priority] || PRIORITY_STYLES['MEDIUM'];
  }

  getCategoryLabel(category: RuleCategory | 'ALL'): string {
    if (category === 'ALL') return 'All';
    return CATEGORY_STYLES[category]?.label ?? category;
  }

  getConditionSummary(rule: IntelligenceRule): string {
    if (rule.conditions.length === 0) return 'No conditions';
    if (rule.conditions.length === 1) {
      const c = rule.conditions[0];
      return `${c.signal} ${c.operator} ${c.value}`;
    }
    return `${rule.conditions.length} conditions (AND)`;
  }

  // ── Thresholds (Phase 6.5.4) ────────────────────────────────────────────────

  updateThreshold(key: keyof IntelligenceThresholds, value: number): void {
    const current = this.configData();
    const currentThresholds = current.thresholds ?? { ...DEFAULT_THRESHOLDS };
    const updatedThresholds = { ...currentThresholds, [key]: value };

    // Optimistic update
    this.configData.set({ ...current, thresholds: updatedThresholds });
  }
}
