import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { PpIcon } from '../core/icon';

/**
 * The bubble at the bottom right that opens the agent panel. A pill on desktop, round on phone.
 * `<pp-agent-launcher [waiting]="2" (open)="panel.set(true)" />`  Spec: agent/agent-launcher.md (proposed)
 */
@Component({
  selector: 'pp-agent-launcher',
  imports: [PpIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button [class]="classes()" type="button" [attr.aria-label]="waiting() ? label() + ', ' + waiting() + ' waiting' : label()" (click)="open.emit()">
      <svg ppIcon="sparkles" />
      @if (!narrow()) { <span>{{ label() }}</span> }
      @if (waiting()) { <span class="pp-agent-launcher__badge" aria-hidden="true">{{ waiting() }}</span> }
    </button>`,
})
export class PpAgentLauncher {
  readonly label = input('Ask Batsi');
  /** Proposals waiting for this person. */
  readonly waiting = input(0);
  readonly open = output<void>();
  protected readonly narrow = toSignal(inject(BreakpointObserver).observe('(max-width: 767px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected readonly classes = () => (this.narrow() ? 'pp-agent-launcher pp-agent-launcher--round' : 'pp-agent-launcher');
}
