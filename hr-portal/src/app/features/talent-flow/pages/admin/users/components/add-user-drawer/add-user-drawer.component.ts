import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
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
  CreateUserPayload,
} from '../../../../../models/admin.models';

/**
 * AddUserDrawerComponent
 *
 * Self-contained drawer for creating a new TalentFlow user.
 * Owns its form state and API call.
 * Emits `saved` with the created AdminUser on success,
 * or `cancelled` when the user dismisses the dialog.
 *
 * Usage:
 *   <tf-add-user-drawer
 *     [visible]="showAddDrawer()"
 *     (saved)="onUserCreated($event)"
 *     (cancelled)="showAddDrawer.set(false)"
 *   />
 */
@Component({
  selector: 'tf-add-user-drawer',
  standalone: true,
  imports: [FormsModule, ButtonModule, DialogModule, CheckboxModule],
  templateUrl: './add-user-drawer.component.html',
  styleUrl: './add-user-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddUserDrawerComponent {
  private readonly api = inject(AdminApiService);

  // ── Inputs ──────────────────────────────────────────────────────────────────

  readonly visible = input<boolean>(false);

  // ── Outputs ─────────────────────────────────────────────────────────────────

  readonly saved     = output<AdminUser>();
  readonly cancelled = output<void>();

  // ── Internal state ───────────────────────────────────────────────────────────

  protected readonly saving = signal(false);
  protected readonly error  = signal<string | null>(null);

  protected email      = '';
  protected givenName  = '';
  protected familyName = '';
  protected roles: TalentFlowRole[] = [];

  // ── Constants ────────────────────────────────────────────────────────────────

  protected readonly allRoles   = ALL_ROLES;
  protected readonly roleLabels = ROLE_LABELS;

  // ── Handlers ─────────────────────────────────────────────────────────────────

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
