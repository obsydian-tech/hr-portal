/**
 * IntelligenceTileComponent — Phase 6.2.1
 *
 * Displays an intelligence tile with actionable insights.
 * Design follows D016 signal-first, D024 card anatomy patterns.
 *
 * Usage:
 *   <tf-intelligence-tile
 *     [tile]="tile"
 *     (actionClicked)="handleAction($event)"
 *     (dismissed)="handleDismiss($event)"
 *     (snoozed)="handleSnooze($event)"
 *   />
 */

import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { IntelligenceTile, TileAction, TileSignal } from '../../models/talent-flow.models';
import { STAGE_LABELS } from '../stage-selector/stage-selector.component';

@Component({
  selector: 'tf-intelligence-tile',
  standalone: true,
  imports: [CommonModule, ButtonModule, TooltipModule, MenuModule],
  templateUrl: './intelligence-tile.component.html',
  styleUrl: './intelligence-tile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceTileComponent {
  // ── Inputs ─────────────────────────────────────────────────────────────────
  readonly tile = input.required<IntelligenceTile>();
  readonly compact = input<boolean>(false);

  // ── Outputs ────────────────────────────────────────────────────────────────
  readonly actionClicked = output<{ action: TileAction; tile: IntelligenceTile }>();
  readonly dismissed = output<string>(); // tileId
  readonly snoozed = output<{ tileId: string; hours: number }>();

  // ── Local state ────────────────────────────────────────────────────────────
  protected readonly showSnoozeMenu = signal(false);

  // ── Computed values ────────────────────────────────────────────────────────

  // EPIC 1.4: Check if tile is in aggregate mode
  protected readonly isAggregate = computed<boolean>(() => {
    const tile = this.tile();
    return tile.mode === 'aggregate' || (tile.count !== undefined && tile.count !== null);
  });

  protected readonly priorityClass = computed<string>(() => {
    const priority = this.tile().priority;
    return `tf-intel-tile--${priority.toLowerCase()}`;
  });

  protected readonly iconClass = computed<string>(() => {
    const priority = this.tile().priority;
    return `tf-intel-tile__icon--${priority.toLowerCase()}`;
  });

  protected readonly priorityIcon = computed<string>(() => {
    const priority = this.tile().priority;
    switch (priority) {
      case 'CRITICAL': return 'pi pi-exclamation-triangle';
      case 'HIGH':     return 'pi pi-exclamation-circle';
      case 'MEDIUM':   return 'pi pi-bolt';
      case 'LOW':      return 'pi pi-info-circle';
      default:         return 'pi pi-bolt';
    }
  });

  protected readonly priorityLabel = computed<string>(() => {
    const priority = this.tile().priority;
    const labels: Record<string, string> = {
      CRITICAL: 'Critical',
      HIGH: 'High',
      MEDIUM: 'Medium',
      LOW: 'Low',
    };
    return labels[priority] ?? priority;
  });

  protected readonly stageLabel = computed<string>(() => {
    const stage = this.tile().currentStage;
    return stage ? (STAGE_LABELS[stage] ?? stage) : '';
  });

  protected readonly primaryAction = computed<TileAction | null>(() => {
    const actions = this.tile().actions;
    return actions.find(a => a.type === 'primary') ?? actions[0] ?? null;
  });

  protected readonly secondaryActions = computed<TileAction[]>(() => {
    return this.tile().actions.filter(a => a.type !== 'primary');
  });

  protected readonly snoozeMenuItems = computed<MenuItem[]>(() => [
    { label: '1 hour',   command: () => this.handleSnooze(1) },
    { label: '4 hours',  command: () => this.handleSnooze(4) },
    { label: '24 hours', command: () => this.handleSnooze(24) },
    { label: '1 week',   command: () => this.handleSnooze(168) },
  ]);

  // ── Methods ────────────────────────────────────────────────────────────────

  protected handleActionClick(action: TileAction): void {
    this.actionClicked.emit({ action, tile: this.tile() });
  }

  protected handleDismiss(): void {
    this.dismissed.emit(this.tile().id);
  }

  protected handleSnooze(hours: number): void {
    this.snoozed.emit({ tileId: this.tile().id, hours });
    this.showSnoozeMenu.set(false);
  }

  protected signalTypeClass(signal: TileSignal): string {
    return `tf-signal-pill--${signal.type}`;
  }
}
