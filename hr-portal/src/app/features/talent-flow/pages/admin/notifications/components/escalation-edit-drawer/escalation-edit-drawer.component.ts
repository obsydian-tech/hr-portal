import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { SidebarModule } from 'primeng/sidebar';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import {
  EscalationPath,
  NotifRecipientRole,
  ALL_NOTIF_ROLES,
  NOTIF_ROLE_LABELS,
  UpdateEscalationPathRequest,
} from '../../../../../models/admin.models';

@Component({
  selector: 'tf-escalation-edit-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CheckboxModule, SidebarModule, TagModule, TooltipModule],
  templateUrl: './escalation-edit-drawer.component.html',
  styleUrl:    './escalation-edit-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EscalationEditDrawerComponent implements OnChanges {
  readonly escalation = input.required<EscalationPath>();
  readonly visible    = input<boolean>(false);
  readonly saving     = input<boolean>(false);
  readonly saved      = output<UpdateEscalationPathRequest>();
  readonly closed     = output<void>();

  readonly allRoles   = ALL_NOTIF_ROLES;
  readonly roleLabels = NOTIF_ROLE_LABELS;

  edit75:  NotifRecipientRole[] = [];
  edit100: NotifRecipientRole[] = [];

  ngOnChanges(): void {
    const e = this.escalation();
    this.edit75  = [...e.threshold75];
    this.edit100 = [...e.threshold100];
  }

  toggleRole(tier: '75' | '100', role: NotifRecipientRole): void {
    const arr = tier === '75' ? this.edit75 : this.edit100;
    const idx = arr.indexOf(role);
    const next = idx === -1 ? [...arr, role] : arr.filter(r => r !== role);
    if (tier === '75') this.edit75 = next;
    else               this.edit100 = next;
  }

  hasRole(tier: '75' | '100', role: NotifRecipientRole): boolean {
    return (tier === '75' ? this.edit75 : this.edit100).includes(role);
  }

  save(): void {
    this.saved.emit({
      slaId:        this.escalation().slaId,
      threshold75:  this.edit75,
      threshold100: this.edit100,
    });
  }

  close(): void {
    this.closed.emit();
  }
}
