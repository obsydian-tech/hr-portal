import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DrawerModule } from 'primeng/drawer';
import { AdminApiService } from '../../../../../services/admin-api.service';
import {
  AdminUser,
  TalentFlowRole,
  ALL_ROLES,
  ROLE_LABELS,
} from '../../../../../models/admin.models';

@Component({
  selector: 'tf-edit-roles-drawer',
  standalone: true,
  imports: [FormsModule, DrawerModule],
  templateUrl: './edit-roles-drawer.component.html',
  styleUrl: './edit-roles-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditRolesDrawerComponent {
  private readonly api = inject(AdminApiService);

  readonly visible = input<boolean>(false);
  readonly user    = input<AdminUser | null>(null);

  readonly saved     = output<AdminUser>();
  readonly cancelled = output<void>();

  protected readonly saving = signal(false);
  protected readonly error  = signal<string | null>(null);

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

  constructor() {
    effect(() => {
      const u = this.user();
      this.roles = u ? [...u.roles] : [];
      this.error.set(null);
    });
  }

  protected onHide(): void {
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
    const user = this.user();
    if (!user) return;

    if (this.roles.length === 0) {
      this.error.set('At least one role must be assigned.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    this.api.updateUserRoles(user.userId, { roles: this.roles }).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.saved.emit(res.user);
      },
      error: (err: { userMessage?: string }) => {
        this.error.set(err.userMessage ?? 'Failed to update roles.');
        this.saving.set(false);
      },
    });
  }
}
