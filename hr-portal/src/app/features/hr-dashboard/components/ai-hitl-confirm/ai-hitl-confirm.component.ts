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
import { DividerModule } from 'primeng/divider';
import { PendingAction } from '../../models/ai-chat.model';

/** Snake_case → human-readable label + icon mapping for employee fields */
const FIELD_META: Record<string, { label: string; icon: string }> = {
  first_name:   { label: 'First Name',   icon: 'pi pi-user'        },
  last_name:    { label: 'Last Name',    icon: 'pi pi-user'        },
  email:        { label: 'Email',        icon: 'pi pi-envelope'    },
  phone:        { label: 'Phone',        icon: 'pi pi-phone'       },
  department:   { label: 'Department',   icon: 'pi pi-building'    },
  job_title:    { label: 'Job Title',    icon: 'pi pi-briefcase'   },
  role:         { label: 'Role',         icon: 'pi pi-briefcase'   },
  hr_staff_id:  { label: 'HR Partner',   icon: 'pi pi-id-card'     },
  planned_start_date: { label: 'Start Date', icon: 'pi pi-calendar' },
};

@Component({
  selector: 'app-ai-hitl-confirm',
  standalone: true,
  imports: [CommonModule, ButtonModule, DividerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-hitl-confirm.component.html',
  styleUrl: './ai-hitl-confirm.component.scss',
})
export class AiHitlConfirmComponent {
  readonly pendingAction = input.required<PendingAction>();

  readonly approved = output<void>();
  readonly cancelled = output<void>();

  draftEntries(): { key: string; label: string; icon: string; value: string }[] {
    const draft = this.pendingAction().draft;
    return Object.entries(draft)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([key, value]) => ({
        key,
        label: FIELD_META[key]?.label ?? key.replace(/_/g, ' '),
        icon:  FIELD_META[key]?.icon  ?? 'pi pi-tag',
        value: String(value),
      }));
  }
}

