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

export type SlaStatus = 'GREEN' | 'AMBER' | 'RED' | 'BREACHED';

export interface TimerState {
  hoursRemaining: number;
  minutesRemaining: number;
  percentElapsed: number;
  status: SlaStatus;
  breachedDuration: string | null;
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
  readonly stageEnteredAt   = input.required<Date>();
  readonly thresholdHours   = input.required<number>();
  readonly slaLabel         = input<string>('SLA');

  /** Fires once when the timer first crosses into BREACHED state */
  readonly slaBreached = output<void>();

  private readonly destroyRef = inject(DestroyRef);
  private hasEmittedBreach = false;

  /** Reactive current time — updated every 30 seconds */
  private readonly now = signal<Date>(new Date());

  readonly timerState = computed<TimerState>(() => {
    const entered     = this.stageEnteredAt();
    const threshold   = this.thresholdHours();
    const now         = this.now();

    const totalMs     = threshold * 60 * 60 * 1000;
    const elapsedMs   = now.getTime() - entered.getTime();
    const remainingMs = totalMs - elapsedMs;

    const percentElapsed = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
    const percentRemaining = 100 - percentElapsed;

    let status: SlaStatus;
    if (remainingMs <= 0) {
      status = 'BREACHED';
    } else if (percentRemaining <= 25) {
      status = 'RED';
    } else if (percentRemaining <= 50) {
      status = 'AMBER';
    } else {
      status = 'GREEN';
    }

    let hoursRemaining = 0;
    let minutesRemaining = 0;
    let breachedDuration: string | null = null;

    if (remainingMs > 0) {
      hoursRemaining   = Math.floor(remainingMs / (1000 * 60 * 60));
      minutesRemaining = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    } else {
      const overMs = Math.abs(remainingMs);
      const overH  = Math.floor(overMs / (1000 * 60 * 60));
      const overM  = Math.floor((overMs % (1000 * 60 * 60)) / (1000 * 60));
      breachedDuration = overH > 0 ? `${overH}h ${overM}m overdue` : `${overM}m overdue`;
    }

    return { hoursRemaining, minutesRemaining, percentElapsed, status, breachedDuration };
  });

  /** CSS modifier class for the container */
  readonly statusClass = computed<string>(() => {
    const s = this.timerState().status;
    return s === 'BREACHED' ? 'sla--red sla--pulse' :
           s === 'RED'      ? 'sla--red sla--pulse'  :
           s === 'AMBER'    ? 'sla--amber'            :
                              'sla--green';
  });

  ngOnInit(): void {
    const interval = setInterval(() => {
      this.now.set(new Date());

      const state = this.timerState();
      if ((state.status === 'BREACHED' || state.status === 'RED') && !this.hasEmittedBreach) {
        this.hasEmittedBreach = true;
        this.slaBreached.emit();
      }
    }, 30_000);

    this.destroyRef.onDestroy(() => clearInterval(interval));
  }
}
