/**
 * NH-57: AiHitlConfirmComponent — approval gate for write actions.
 * Shows draft employee data and requires explicit HR confirmation.
 */
import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { PendingAction } from '../../models/ai-chat.model';

@Component({
  selector: 'app-ai-hitl-confirm',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-hitl-confirm.component.html',
})
export class AiHitlConfirmComponent {
  readonly pendingAction = input.required<PendingAction>();

  readonly approved = output<void>();
  readonly cancelled = output<void>();

  draftEntries(): { key: string; value: string }[] {
    const draft = this.pendingAction().draft;
    return Object.entries(draft).map(([key, value]) => ({
      key,
      value: String(value),
    }));
  }
}
