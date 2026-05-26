import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputSwitchModule } from 'primeng/inputswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { DrawerModule } from 'primeng/drawer';
import {
  NotifTrigger,
  NotifRecipientRole,
  ALL_NOTIF_ROLES,
  NOTIF_ROLE_LABELS,
  UpdateNotifTriggerRequest,
} from '../../../../../models/admin.models';

@Component({
  selector: 'tf-trigger-edit-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TagModule, InputSwitchModule, CheckboxModule, DrawerModule],
  templateUrl: './trigger-edit-drawer.component.html',
  styleUrl:    './trigger-edit-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TriggerEditDrawerComponent implements OnChanges {
  readonly trigger = input.required<NotifTrigger>();
  readonly visible = input<boolean>(false);
  readonly saving  = input<boolean>(false);
  readonly saved   = output<UpdateNotifTriggerRequest>();
  readonly closed  = output<void>();

  readonly allRoles      = ALL_NOTIF_ROLES;
  readonly roleLabels    = NOTIF_ROLE_LABELS;

  // Mutable editing state
  editEnabled    = true;
  editRecipients: NotifRecipientRole[] = [];

  ngOnChanges(): void {
    const t = this.trigger();
    this.editEnabled    = t.enabled;
    this.editRecipients = [...t.recipients];
  }

  toggleRole(role: NotifRecipientRole): void {
    const idx = this.editRecipients.indexOf(role);
    if (idx === -1) this.editRecipients = [...this.editRecipients, role];
    else            this.editRecipients = this.editRecipients.filter(r => r !== role);
  }

  hasRole(role: NotifRecipientRole): boolean {
    return this.editRecipients.includes(role);
  }

  save(): void {
    this.saved.emit({
      triggerId:  this.trigger().triggerId,
      recipients: this.editRecipients,
      enabled:    this.editEnabled,
    });
  }

  close(): void {
    this.closed.emit();
  }
}
