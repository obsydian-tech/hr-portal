import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SidebarModule } from 'primeng/sidebar';
import { AuditEvent, AUDIT_EVENT_TYPE_LABELS, AUDIT_MODULE_LABELS, AUDIT_OUTCOME_SEVERITY } from '../../../../../models/admin.models';

/**
 * EventDetailDrawerComponent
 *
 * Shown as a 420px right-side p-sidebar when a table row is clicked.
 * Displays event summary, actor details, entity info, what changed (diff
 * for CONFIG_CHANGE, payload otherwise), and technical details.
 */
@Component({
  selector: 'tf-event-detail-drawer',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, TooltipModule, SidebarModule],
  templateUrl: './event-detail-drawer.component.html',
  styleUrl:    './event-detail-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailDrawerComponent {
  readonly event   = input.required<AuditEvent>();
  readonly visible = input<boolean>(false);
  readonly closed  = output<void>();

  readonly eventTypeLabels = AUDIT_EVENT_TYPE_LABELS;
  readonly moduleLabels    = AUDIT_MODULE_LABELS;
  readonly outcomeSeverity = AUDIT_OUTCOME_SEVERITY;

  readonly isConfigChange = computed(() => this.event().eventType === 'CONFIG_CHANGE');

  /** Build an array of { key, before, after } rows for diff view */
  readonly diffRows = computed(() => {
    const diff = this.event().diff;
    if (!diff?.changedKeys?.length) return [];
    return diff.changedKeys.map((key) => ({
      key,
      before: diff.before?.[key] ?? '—',
      after:  diff.after?.[key]  ?? '—',
    }));
  });

  readonly payloadEntries = computed(() => {
    const payload = this.event().payload;
    if (!payload || typeof payload !== 'object') return [];
    return Object.entries(payload as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));
  });

  close(): void {
    this.closed.emit();
  }

  outcomeSev(outcome: string): 'success' | 'danger' | 'warn' {
    return (this.outcomeSeverity as Record<string, 'success' | 'danger' | 'warn'>)[outcome] ?? 'warn';
  }

  eventTypeSeverity(type: string): 'danger' | 'warn' | 'info' | 'secondary' | 'success' {
    const map: Record<string, 'danger' | 'warn' | 'info' | 'secondary' | 'success'> = {
      SLA_BREACH:       'danger',
      CONFIG_CHANGE:    'warn',
      CANDIDATE_ACTION: 'info',
      OFFER_ACTION:     'info',
      PROVISIONING:     'secondary',
      USER_MANAGEMENT:  'success',
    };
    return map[type] ?? 'secondary';
  }
}
