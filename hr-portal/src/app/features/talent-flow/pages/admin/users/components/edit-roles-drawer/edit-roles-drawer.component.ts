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
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { CheckboxModule } from 'primeng/checkbox';
import { AdminApiService } from '../../../../../services/admin-api.service';
import {
  AdminUser,
  TalentFlowRole,
  ALL_ROLES,
  ROLE_LABELS,
} from '../../../../../models/admin.models';

/**
 * EditRolesDrawerComponent
 *
 * Self-contained drawer for updating an existing user's roles.
 * Owns its local role-selection state, seeded from the `user` input.
 * Emits `saved` with the updated AdminUser on success,
 * or `cancelled` when the user dismisses the dialog.
 *
 * Usage:
 *   <tf-edit-roles-drawer
 *     [visible]="showEditDrawer()"
 *     [user]="selectedUser()"
 *     (saved)="onRolesUpdated($event)"
 *     (cancelled)="showEditDrawer.set(false)"
 *   />
 */
@Component({
  selector: 'tf-edit-roles-drawer',
  standalone: true,
  imports: [FormsModule, ButtonModule, DialogModule, CheckboxModule],
  templateUrl: './edit-roles-drawer.component.html',
  styleUrl: './edit-roles-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditRolesDrawerComponent {
  private readonly api = inject(AdminApiService);

  // ── Inputs ──────────────────────────────────────────────────────────────────

  readonly visible = input<boolean>(false);
  readonly user    = input<AdminUser | null>(null);

  // ── Outputs ─────────────────────────────────────────────────────────────────

  readonly saved     = output<AdminUser>();
  readonly cancelled = output<void>();

  // ── Internal state ───────────────────────────────────────────────────────────

  protected readonly saving = signal(false);
  protected readonly error  = signal<string | null>(null);

  /** Mutable local copy of role selection, seeded from `user` input. */
  protected roles: TalentFlowRole[] = [];

  // ── Constants ────────────────────────────────────────────────────────────────

  protected readonly allRoles   = ALL_ROLES;
  protected readonly roleLabels = ROLE_LABELS;

  constructor() {
    // Seed local roles whenever the user input changes (i.e. a different row is
    // opened). Uses effect() so it stays reactive with signals.
    effect(() => {
      const u = this.user();
      this.roles = u ? [...u.roles] : [];
      this.error.set(null);
    });
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

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
