import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { AdminApiService } from '../../../../../services/admin-api.service';
import {
  AdminUser,
  TalentFlowRole,
  ALL_ROLES,
  ROLE_LABELS,
  CreateUserPayload,
} from '../../../../../models/admin.models';

@Component({
  selector: 'tf-add-user-drawer',
  standalone: true,
  imports: [FormsModule, DrawerModule],
  templateUrl: './add-user-drawer.component.html',
  styleUrl: './add-user-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddUserDrawerComponent {
  private readonly api = inject(AdminApiService);

  readonly visible = input<boolean>(false);

  readonly saved     = output<AdminUser>();
  readonly cancelled = output<void>();

  protected readonly saving = signal(false);
  protected readonly error  = signal<string | null>(null);

  protected email      = '';
  protected givenName  = '';
  protected familyName = '';
  protected roles: TalentFlowRole[] = [];

  protected readonly allRoles   = ALL_ROLES;
  protected readonly roleLabels = ROLE_LABELS;

  protected readonly roleIcons: Record<TalentFlowRole, string> = {
    ADMIN: 'pi-shield',
    HM:    'pi-briefcase',
    IT:    'pi-server',
    TA:    'pi-users',
  };

  protected readonly roleDescs: Record<TalentFlowRole, string> = {
    ADMIN: 'Full access to all modules, users and settings',
    HM:    'Manage vacancies, review candidates and approve offers',
    IT:    'Handle IT provisioning requests and task queues',
    TA:    'Manage talent acquisition pipeline and candidate flow',
  };

  protected onHide(): void {
    this.reset();
    this.cancelled.emit();
  }

  protected toggleRole(role: TalentFlowRole, checked: boolean): void {
    if (checked) {
      if (!this.roles.includes(role)) this.roles = [...this.roles, role];
    } else {
      this.roles = this.roles.filter((r) => r !== role);
    }
  }

  protected submit(): void {
    if (!this.email || !this.givenName || !this.familyName || this.roles.length === 0) {
      this.error.set('All fields are required and at least one role must be selected.');
      return;
    }

    const payload: CreateUserPayload = {
      email:      this.email.trim(),
      givenName:  this.givenName.trim(),
      familyName: this.familyName.trim(),
      roles:      this.roles,
    };

    this.saving.set(true);
    this.error.set(null);

    this.api.createUser(payload).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.reset();
        this.saved.emit(res.user);
      },
      error: (err: { userMessage?: string }) => {
        this.error.set(err.userMessage ?? 'Failed to create user.');
        this.saving.set(false);
      },
    });
  }

  private reset(): void {
    this.email      = '';
    this.givenName  = '';
    this.familyName = '';
    this.roles      = [];
    this.error.set(null);
  }
}
