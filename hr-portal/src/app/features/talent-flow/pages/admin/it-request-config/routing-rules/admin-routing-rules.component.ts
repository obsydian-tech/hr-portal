import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../models/talent-flow.models';
import { ConfigVersionBadgeComponent } from '../../components/config-version-badge/config-version-badge.component';
import { RoutingRule, ConditionField } from '../it-request.models';

const CONDITION_FIELDS: Array<{ label: string; value: ConditionField }> = [
  { label: 'Department',  value: 'department' },
  { label: 'Role',        value: 'role'       },
  { label: 'Location',    value: 'location'   },
  { label: 'Seniority',   value: 'seniority'  },
];

/**
 * AdminRoutingRulesComponent — Admin-S2 / IT Request Config
 *
 * Route: /platform/talentflow/admin/it-request/routing
 *
 * Inline p-table row-edit for routing rules.
 * Each rule maps a condition field+value to an IT queue with a priority.
 * Duplicate condition combinations are flagged on save.
 */
@Component({
  selector: 'tf-admin-routing-rules',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TableModule, SelectModule,
            InputTextModule, InputNumberModule, TooltipModule, ConfigVersionBadgeComponent],
  templateUrl: './admin-routing-rules.component.html',
  styleUrl:    './admin-routing-rules.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRoutingRulesComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly rules         = signal<RoutingRule[]>([]);
  readonly editingRows   = signal<Record<string, RoutingRule>>({});  // id → clone being edited
  readonly newRuleIds    = signal<Set<string>>(new Set());
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);
  readonly queues        = signal<Array<{ label: string; value: string }>>([]);

  readonly conditionFields = CONDITION_FIELDS;

  readonly duplicateIds = computed<Set<string>>(() => {
    const seen = new Map<string, string>();
    const dups = new Set<string>();
    for (const r of this.rules()) {
      const key = `${r.conditionField}:${r.conditionValue.trim().toLowerCase()}`;
      if (seen.has(key)) {
        dups.add(r.id);
        dups.add(seen.get(key)!);
      } else {
        seen.set(key, r.id);
      }
    }
    return dups;
  });

  ngOnInit(): void {
    this.loadConfig();
    this.loadQueues();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('ROUTING_RULES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as { rules?: RoutingRule[] };
        this.rules.set(Array.isArray(d.rules) ? d.rules : []);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  private loadQueues(): void {
    this.api.getConfig('IT_QUEUES').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as { queues?: Array<{ id?: string; name: string; active?: boolean }> };
        if (Array.isArray(d.queues)) {
          this.queues.set(
            d.queues
              // treat missing active field as active (backward-compat with older saved data)
              .filter((q) => q.active !== false)
              // fall back to name as value if id is missing (older saved data)
              .map((q) => ({ label: q.name, value: q.id ?? q.name })),
          );
        }
      },
      error: () => {},
    });
  }

  addRule(): void {
    const newRule: RoutingRule = {
      id:             crypto.randomUUID(),
      conditionField: 'department',
      conditionValue: '',
      targetQueueId:  '',
      priority:       (this.rules().length + 1) * 10,
    };
    this.rules.update((r) => [...r, newRule]);
    // Track as new (not yet persisted)
    this.newRuleIds.update((s) => new Set([...s, newRule.id]));
    // Immediately put the new row in edit mode
    this.editingRows.update((m) => ({ ...m, [newRule.id]: { ...newRule } }));
  }

  startEdit(rule: RoutingRule): void {
    this.editingRows.update((m) => ({ ...m, [rule.id]: { ...rule } }));
  }

  cancelEdit(ruleId: string, _isNew?: boolean): void {
    const isNew = this.newRuleIds().has(ruleId);
    if (isNew) {
      this.rules.update((r) => r.filter((x) => x.id !== ruleId));
      this.newRuleIds.update((s) => { const n = new Set(s); n.delete(ruleId); return n; });
    }
    this.editingRows.update((m) => {
      const next = { ...m };
      delete next[ruleId];
      return next;
    });
  }

  saveRowEdit(ruleId: string): void {
    const editClone = this.editingRows()[ruleId];
    if (!editClone || !editClone.conditionValue.trim() || !editClone.targetQueueId) return;

    const updated = this.rules().map((r) => (r.id === ruleId ? { ...editClone } : r));
    this.editingRows.update((m) => {
      const next = { ...m };
      delete next[ruleId];
      return next;
    });
    this.newRuleIds.update((s) => { const n = new Set(s); n.delete(ruleId); return n; });
    this.persistRules(updated);
  }

  confirmDelete(rule: RoutingRule): void {
    this.confirmService.confirm({
      message: `Delete this routing rule?`,
      header:  'Delete Rule',
      icon:    'pi pi-trash',
      accept:  () => {
        const updated = this.rules().filter((r) => r.id !== rule.id);
        this.persistRules(updated, () => {
          this.messageService.add({ severity: 'success', summary: 'Deleted', detail: 'Routing rule deleted.', life: 3000 });
        });
      },
    });
  }

  patchEditRow(ruleId: string, patch: Partial<RoutingRule>): void {
    this.editingRows.update((m) => ({
      ...m,
      [ruleId]: { ...m[ruleId], ...patch },
    }));
  }

  isEditing(ruleId: string): boolean {
    return ruleId in this.editingRows();
  }

  getQueueLabel(queueId: string): string {
    return this.queues().find((q) => q.value === queueId)?.label ?? queueId;
  }

  private persistRules(rules: RoutingRule[], onSuccess?: () => void): void {
    this.saving.set(true);
    this.api.updateConfig('ROUTING_RULES', { rules }).subscribe({
      next: (cfg: ConfigResponse) => {
        this.rules.set(rules);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        onSuccess?.();
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: err.userMessage ?? 'Save failed.', life: 5000 });
      },
    });
  }
}
