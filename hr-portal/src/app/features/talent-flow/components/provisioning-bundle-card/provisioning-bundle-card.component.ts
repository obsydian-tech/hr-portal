import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { ProvisioningBundle, ProvisioningItem, ProvisioningRequirementType } from '../../models/talent-flow.models';

/**
 * ProvisioningBundleCardComponent
 *
 * Reusable card used in the HM Provisioning page for:
 *   - Pending-review bundles (shows Modify + Review & Approve actions)
 *   - In-fulfilment bundles (shows progress bar + per-item status dots + View details)
 *
 * Border colour is driven by slaStatus:
 *   BREACHED → red   |   AT_RISK → indigo   |   ON_TRACK → standard
 */
@Component({
  selector: 'tf-provisioning-bundle-card',
  standalone: true,
  imports: [ButtonModule, UpperCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pbc" [class]="cardClass()">

      <!-- ── Header row ──────────────────────────────────────────────── -->
      <div class="pbc__header">
        <div class="pbc__identity">
          <div class="pbc__avatar" [style.background]="avatarColour()">{{ initials() }}</div>
          <div class="pbc__meta">
            <span class="pbc__name">{{ bundle().candidateName }}</span>
            <div class="pbc__tags">
              <span class="pbc__tag pbc__tag--seniority">{{ bundle().seniority | uppercase }}</span>
              <span class="pbc__tag pbc__tag--role">{{ bundle().candidateRole }}</span>
              <span class="pbc__tag pbc__tag--date">
                <i class="pi pi-calendar"></i>
                Starts {{ startDateLabel() }}
              </span>
            </div>
          </div>
        </div>
        <div class="pbc__sla">
          <span class="pbc__sla-label pbc__sla-label--{{ bundle().slaStatus }}">
            {{ slaLabel() }}
          </span>
          <div class="pbc__sla-bar pbc__sla-bar--{{ bundle().slaStatus }}"></div>
          <span class="pbc__sla-sub pbc__sla-sub--{{ bundle().slaStatus }}">
            {{ slaSubLabel() }}
          </span>
        </div>
      </div>

      <!-- ── Requirement chips ───────────────────────────────────────── -->
      <div class="pbc__items">
        @for (item of bundle().items; track item.id) {
          <div class="pbc__item pbc__item--{{ item.status }}">
            <div class="pbc__item-icon">
              <i class="pi {{ typeIcon(item.type) }}"></i>
            </div>
            <div class="pbc__item-body">
              <span class="pbc__item-category">{{ item.type }}</span>
              <span class="pbc__item-label">{{ item.label }}</span>
              <span class="pbc__item-queue">{{ item.queue }}</span>
              @if (bundle().bundleStatus !== 'PENDING_REVIEW') {
                <span class="pbc__item-status pbc__item-status--{{ item.status }}">
                  <span class="pbc__dot pbc__dot--{{ item.status }}"></span>
                  {{ statusLabel(item) }}
                </span>
              }
            </div>
          </div>
        }
      </div>

      <!-- ── Progress bar (in-fulfilment only) ─────────────────────── -->
      @if (bundle().bundleStatus !== 'PENDING_REVIEW') {
        <div class="pbc__progress-row">
          <div class="pbc__progress-track">
            <div class="pbc__progress-fill pbc__progress-fill--{{ progressSeverity() }}"
                 [style.width.%]="progressPct()"></div>
          </div>
          <span class="pbc__progress-label">{{ completeCount() }} of {{ bundle().items.length }} tasks complete</span>
        </div>
      }

      <!-- ── Footer actions ─────────────────────────────────────────── -->
      <div class="pbc__footer">
        <span class="pbc__template">
          <i class="pi pi-file-edit"></i>
          Auto-generated · {{ bundle().templateName }}
        </span>
        <div class="pbc__actions">
          @if (bundle().bundleStatus === 'PENDING_REVIEW') {
            <p-button
              label="Modify"
              icon="pi pi-pencil"
              styleClass="pbc-btn pbc-btn--secondary"
              [outlined]="true"
              (onClick)="modify.emit(bundle())"
            />
            <p-button
              label="Review & Approve"
              icon="pi pi-check"
              styleClass="pbc-btn pbc-btn--approve"
              (onClick)="approve.emit(bundle())"
            />
          } @else {
            <p-button
              label="View details"
              icon="pi pi-eye"
              styleClass="pbc-btn pbc-btn--secondary"
              [outlined]="true"
              (onClick)="viewDetails.emit(bundle())"
            />
          }
        </div>
      </div>

    </div>
  `,
  styles: [`
    /* ── Card shell ──────────────────────────────────────────────────── */
    .pbc {
      background: var(--naleko-surface-card, #fff);
      border: 1.5px solid var(--naleko-border-subtle, #e2e8f0);
      border-radius: var(--naleko-radius-lg, 12px);
      padding: 1.25rem 1.25rem 1rem;
      margin-bottom: 1rem;
      transition: box-shadow .15s;
    }
    .pbc--breached { border-color: var(--naleko-danger, #ef4444); }
    .pbc--at-risk  { border-color: #6366f1; }
    .pbc--on-track { border-color: var(--naleko-border-subtle, #e2e8f0); }

    /* ── Header ─────────────────────────────────────────────────────── */
    .pbc__header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    .pbc__identity { display: flex; gap: .75rem; align-items: flex-start; }
    .pbc__avatar {
      width: 2.5rem; height: 2.5rem; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: .875rem; font-weight: 700; color: #fff; flex-shrink: 0;
    }
    .pbc__name {
      display: block; font-weight: 700;
      font-size: 1rem; color: var(--naleko-text-primary, #1e293b);
      margin-bottom: .35rem;
    }
    .pbc__tags { display: flex; gap: .375rem; flex-wrap: wrap; align-items: center; }
    .pbc__tag {
      font-size: .6875rem; font-weight: 600; border-radius: 999px;
      padding: .125rem .5rem; letter-spacing: .02em;
    }
    .pbc__tag--seniority { background: #f1f5f9; color: #475569; }
    .pbc__tag--role      { background: #e0e7ff; color: #4338ca; }
    .pbc__tag--date      { background: none; color: var(--naleko-text-secondary, #64748b);
                           font-weight: 400; display: flex; align-items: center; gap: .25rem; }
    .pbc__tag--date .pi  { font-size: .7rem; }

    /* ── SLA badge ───────────────────────────────────────────────────── */
    .pbc__sla { display: flex; flex-direction: column; align-items: flex-end; gap: .25rem; }
    .pbc__sla-label { font-size: .6875rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .pbc__sla-label--BREACHED { color: var(--naleko-danger, #ef4444); }
    .pbc__sla-label--AT_RISK  { color: var(--naleko-warning, #f59e0b); }
    .pbc__sla-label--ON_TRACK { color: var(--naleko-success, #22c55e); }

    .pbc__sla-bar {
      width: 6rem; height: 3px; border-radius: 2px;
    }
    .pbc__sla-bar--BREACHED { background: var(--naleko-danger, #ef4444); }
    .pbc__sla-bar--AT_RISK  { background: var(--naleko-warning, #f59e0b); }
    .pbc__sla-bar--ON_TRACK { background: var(--naleko-success, #22c55e); }

    .pbc__sla-sub { font-size: .625rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .pbc__sla-sub--BREACHED { color: var(--naleko-danger, #ef4444); }
    .pbc__sla-sub--AT_RISK  { color: var(--naleko-warning, #f59e0b); }
    .pbc__sla-sub--ON_TRACK { color: var(--naleko-success, #22c55e); }

    /* ── Requirement chips ───────────────────────────────────────────── */
    .pbc__items {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: .625rem;
      margin-bottom: 1rem;
    }
    .pbc__item {
      background: var(--naleko-surface-ground, #f8fafc);
      border: 1px solid var(--naleko-border-subtle, #e2e8f0);
      border-radius: var(--naleko-radius-md, 8px);
      padding: .625rem .75rem;
      display: flex; gap: .5rem;
    }
    .pbc__item-icon {
      color: var(--naleko-text-muted, #94a3b8);
      font-size: .875rem;
      margin-top: .125rem;
      flex-shrink: 0;
    }
    .pbc__item-body { display: flex; flex-direction: column; gap: .1rem; }
    .pbc__item-category {
      font-size: .625rem; font-weight: 700; letter-spacing: .06em;
      color: var(--naleko-text-muted, #94a3b8); text-transform: uppercase;
    }
    .pbc__item-label {
      font-size: .8125rem; font-weight: 600;
      color: var(--naleko-text-primary, #1e293b);
    }
    .pbc__item-queue {
      font-size: .6875rem; color: var(--naleko-text-secondary, #64748b);
    }
    .pbc__item-status {
      display: flex; align-items: center; gap: .25rem;
      font-size: .6875rem; font-weight: 600; margin-top: .25rem;
    }
    .pbc__item-status--COMPLETE  { color: var(--naleko-success, #22c55e); }
    .pbc__item-status--BREACHED  { color: var(--naleko-danger, #ef4444); }
    .pbc__item-status--IN_PROGRESS { color: var(--naleko-warning, #f59e0b); }
    .pbc__item-status--PENDING   { color: var(--naleko-text-muted, #94a3b8); }

    .pbc__dot {
      width: .5rem; height: .5rem; border-radius: 50%; display: inline-block;
    }
    .pbc__dot--COMPLETE   { background: var(--naleko-success, #22c55e); }
    .pbc__dot--BREACHED   { background: var(--naleko-danger, #ef4444); }
    .pbc__dot--IN_PROGRESS{ background: var(--naleko-warning, #f59e0b); }
    .pbc__dot--PENDING    { background: var(--naleko-text-muted, #94a3b8); }

    /* ── Progress bar (in-fulfilment) ────────────────────────────────── */
    .pbc__progress-row {
      display: flex; align-items: center; gap: .75rem;
      margin-bottom: 1rem;
    }
    .pbc__progress-track {
      flex: 1; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden;
    }
    .pbc__progress-fill {
      height: 100%; border-radius: 2px; transition: width .3s;
    }
    .pbc__progress-fill--success { background: var(--naleko-success, #22c55e); }
    .pbc__progress-fill--warning { background: var(--naleko-warning, #f59e0b); }
    .pbc__progress-fill--danger  { background: var(--naleko-danger, #ef4444); }
    .pbc__progress-label {
      font-size: .75rem; color: var(--naleko-text-secondary, #64748b);
      white-space: nowrap;
    }

    /* ── Footer ─────────────────────────────────────────────────────── */
    .pbc__footer {
      display: flex; justify-content: space-between; align-items: center;
      border-top: 1px solid var(--naleko-border-subtle, #e2e8f0);
      padding-top: .875rem; gap: .75rem; flex-wrap: wrap;
    }
    .pbc__template {
      font-size: .75rem; color: var(--naleko-text-muted, #94a3b8);
      display: flex; align-items: center; gap: .35rem;
    }
    .pbc__template .pi { font-size: .7rem; }
    .pbc__actions { display: flex; gap: .5rem; }

    /* PrimeNG button overrides via styleClass */
    :host ::ng-deep .pbc-btn.p-button {
      border-radius: 999px;
      font-size: .8125rem;
      font-weight: 600;
      padding: .4375rem 1rem;
      height: auto;
    }
    :host ::ng-deep .pbc-btn--approve.p-button {
      background: var(--naleko-text-primary, #1e293b);
      border-color: var(--naleko-text-primary, #1e293b);
      color: #fff;
    }
    :host ::ng-deep .pbc-btn--approve.p-button:hover {
      background: #0f172a;
      border-color: #0f172a;
    }
    :host ::ng-deep .pbc-btn--secondary.p-button {
      border-color: var(--naleko-border-subtle, #e2e8f0);
      color: var(--naleko-text-primary, #1e293b);
    }
  `],
})
export class ProvisioningBundleCardComponent {
  readonly bundle = input.required<ProvisioningBundle>();

  readonly modify      = output<ProvisioningBundle>();
  readonly approve     = output<ProvisioningBundle>();
  readonly viewDetails = output<ProvisioningBundle>();

  protected readonly cardClass = computed<string>(() => {
    const s = this.bundle().slaStatus;
    if (s === 'BREACHED') return 'pbc pbc--breached';
    if (s === 'AT_RISK')  return 'pbc pbc--at-risk';
    return 'pbc pbc--on-track';
  });

  protected readonly initials = computed<string>(() => {
    const parts = this.bundle().candidateName.split(' ');
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  });

  protected readonly avatarColour = computed<string>(() => {
    const colours = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
    let hash = 0;
    for (const ch of this.bundle().candidateName) hash = ch.charCodeAt(0) + (hash << 5) - hash;
    return colours[Math.abs(hash) % colours.length];
  });

  protected readonly startDateLabel = computed<string>(() => {
    const d = new Date(this.bundle().startDate);
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  });

  protected readonly slaLabel = computed<string>(() => {
    const b = this.bundle();
    if (b.bundleStatus === 'PENDING_REVIEW') {
      if (b.slaStatus === 'BREACHED') return 'REVIEW OVERDUE';
      if (b.slaStatus === 'AT_RISK')  return 'REVIEW DUE TODAY';
    }
    if (b.slaStatus === 'BREACHED') return 'SLA BREACHED';
    if (b.slaStatus === 'AT_RISK')  return 'AT RISK';
    return 'ON TRACK';
  });

  protected readonly slaSubLabel = computed<string>(() => {
    const s = this.bundle().slaStatus;
    if (s === 'BREACHED') return 'BREACHED';
    if (s === 'AT_RISK')  return 'AT RISK';
    return 'ON TRACK';
  });

  protected readonly completeCount = computed<number>(() =>
    this.bundle().items.filter((i) => i.status === 'COMPLETE').length,
  );

  protected readonly progressPct = computed<number>(() => {
    const total = this.bundle().items.length;
    return total > 0 ? Math.round((this.completeCount() / total) * 100) : 0;
  });

  protected readonly progressSeverity = computed<string>(() => {
    const s = this.bundle().slaStatus;
    if (s === 'BREACHED') return 'danger';
    if (s === 'AT_RISK')  return 'warning';
    return 'success';
  });

  typeIcon(type: ProvisioningRequirementType): string {
    const map: Record<ProvisioningRequirementType, string> = {
      HARDWARE:   'pi-desktop',
      ACCESS:     'pi-envelope',
      SOFTWARE:   'pi-th-large',
      FACILITIES: 'pi-id-card',
    };
    return map[type] ?? 'pi-box';
  }

  statusLabel(item: ProvisioningItem): string {
    const map: Record<string, string> = {
      COMPLETE:    'Complete',
      IN_PROGRESS: 'In progress',
      BREACHED:    'Breached',
      PENDING:     'Pending',
    };
    return map[item.status] ?? item.status;
  }
}
