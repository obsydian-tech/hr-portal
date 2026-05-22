import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * SlaTimerWidget
 *
 * Design source:
 *   - Container:  naleko-design-handoff/preview/17-stat-card.html (.scard)
 *   - Progress bar: EmployeeDetail.jsx (.ed-progress__bar / .ed-progress__fill)
 *   - Status pill: 19-status-pills.html (.pill colour system)
 *   - Icon tile: 17-stat-card .sicon — tinted by SLA health status
 *   - Timer digits: --naleko-font-mono (JetBrains Mono) for readability
 *
 * Colour logic (from 19-status-pills + design token semantic colours):
 *   GREEN  >50% time remaining  → naleko-success
 *   AMBER  25–50% remaining     → naleko-warning
 *   RED    <25% or breached     → naleko-error + pulse animation
 *
 * Tech stack: Angular 19 standalone, input(), output(), signal(), computed(),
 * inject(DestroyRef) for interval cleanup, OnPush.
 */

// D021: signal health language — NEVER expose exact times
export type SlaStatus = 'ON_TRACK' | 'AT_RISK' | 'BREACHED';

export interface TimerState {
  percentElapsed: number;
  status: SlaStatus;
}

@Component({
  selector: 'tf-sla-timer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sla-timer-widget.component.html',
  styleUrl: './sla-timer-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlaTimerWidgetComponent implements OnInit {
  readonly stageEnteredAt  = input.required<Date>();
  readonly thresholdHours  = input.required<number>();
  readonly slaLabel        = input<string>('SLA');
  /** D010: AT_RISK threshold — % elapsed (default 75). Configurable per tenant. */
  readonly atRiskThreshold = input<number>(75);

  /** Fires once when the timer first crosses into BREACHED (100% elapsed) */
  readonly slaBreached = output<void>();
  /** Fires once when the timer first crosses into AT_RISK (atRiskThreshold% elapsed) */
  readonly slaAtRisk   = output<void>();

  private readonly destroyRef     = inject(DestroyRef);
  private hasEmittedAtRisk        = false;
  private hasEmittedBreach        = false;

  /** Reactive current time — updated every 30 seconds */
  private readonly now = signal<Date>(new Date());

  readonly timerState = computed<TimerState>(() => {
    const entered   = this.stageEnteredAt();
    const threshold = this.thresholdHours();
    const now       = this.now();

    const totalMs        = threshold * 60 * 60 * 1000;
    const elapsedMs      = Math.max(0, now.getTime() - entered.getTime());
    const percentElapsed = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

    // D010: 75% elapsed = AT_RISK, 100% elapsed = BREACHED
    let status: SlaStatus;
    if (percentElapsed >= 100) {
      status = 'BREACHED';
    } else if (percentElapsed >= this.atRiskThreshold()) {
      status = 'AT_RISK';
    } else {
      status = 'ON_TRACK';
    }

    return { percentElapsed, status };
  });

  readonly statusClass = computed<string>(() => {
    const s = this.timerState().status;
    return s === 'BREACHED' ? 'sla--breached sla--pulse' :
           s === 'AT_RISK'  ? 'sla--at-risk'             :
                              'sla--on-track';
  });

  ngOnInit(): void {
    const interval = setInterval(() => {
      this.now.set(new Date());
      const state = this.timerState();

      if (state.status === 'AT_RISK' && !this.hasEmittedAtRisk) {
        this.hasEmittedAtRisk = true;
        this.slaAtRisk.emit();
      }
      if (state.status === 'BREACHED' && !this.hasEmittedBreach) {
        this.hasEmittedBreach = true;
        this.slaBreached.emit();
      }
    }, 30_000);

    this.destroyRef.onDestroy(() => clearInterval(interval));
  }
}
