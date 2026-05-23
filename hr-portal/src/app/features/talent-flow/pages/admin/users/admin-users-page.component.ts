import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { AdminApiService } from '../../../services/admin-api.service';
import {
  AdminUser,
  TalentFlowRole,
  ALL_ROLES,
  ROLE_LABELS,
  CreateUserPayload,
} from '../../../models/admin.models';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

@Component({
  selector: 'tf-admin-users-page',
  standalone: true,
  imports: [
    FormsModule,
    SlicePipe,
    ButtonModule,
    InputTextModule,
    CheckboxModule,
    DialogModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './admin-users-page.component.html',
  styleUrl:    './admin-users-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersPageComponent implements OnInit {
  private readonly api          = inject(AdminApiService);
  private readonly confirmSvc   = inject(ConfirmationService);
  private readonly messageSvc   = inject(MessageService);

  // ── List state ────────────────────────────────────────────────────────────

  protected readonly loading  = signal(true);
  protected readonly error    = signal<string | null>(null);
  protected readonly users    = signal<AdminUser[]>([]);

  protected readonly searchQuery  = signal('');
  protected readonly statusFilter = signal<StatusFilter>('ALL');

  protected readonly filteredUsers = computed(() => {
    const q      = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();
    return this.users().filter((u) => {
      if (status !== 'ALL' && u.status !== status) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  });

  // ── Add User drawer ───────────────────────────────────────────────────────

  protected addDrawerVisible = signal(false);
  protected addSaving        = signal(false);
  protected addError         = signal<string | null>(null);

  protected newEmail      = '';
  protected newGivenName  = '';
  protected newFamilyName = '';
  protected newRoles: TalentFlowRole[] = [];

  // ── Edit Roles drawer ─────────────────────────────────────────────────────

  protected editDrawerVisible = signal(false);
  protected editSaving        = signal(false);
  protected editError         = signal<string | null>(null);
  protected editUser          = signal<AdminUser | null>(null);
  protected editRoles: TalentFlowRole[] = [];

  // ── Shared constants ──────────────────────────────────────────────────────

  protected readonly allRoles   = ALL_ROLES;
  protected readonly roleLabels = ROLE_LABELS;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadUsers();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  protected setStatus(s: StatusFilter): void {
    this.statusFilter.set(s);
  }

  protected setSearch(val: string): void {
    this.searchQuery.set(val);
  }

  protected initials(u: AdminUser): string {
    return (u.givenName[0] ?? '') + (u.familyName[0] ?? '');
  }

  protected roleChips(u: AdminUser): string {
    return u.roles.map((r) => ROLE_LABELS[r]).join(', ');
  }

  // ── Load users ────────────────────────────────────────────────────────────

  protected refresh(): void {
    this.loadUsers();
  }

  private loadUsers(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getUsers({ limit: 100 }).subscribe({
      next: (res) => {
        this.users.set(res.users);
        this.loading.set(false);
      },
      error: (err: { userMessage?: string }) => {
        this.error.set(err.userMessage ?? 'Failed to load users.');
        this.loading.set(false);
      },
    });
  }

  // ── Add User ──────────────────────────────────────────────────────────────

  protected openAddDrawer(): void {
    this.newEmail      = '';
    this.newGivenName  = '';
    this.newFamilyName = '';
    this.newRoles      = [];
    this.addError.set(null);
    this.addDrawerVisible.set(true);
  }

  protected closeAddDrawer(): void {
    this.addDrawerVisible.set(false);
  }

  protected submitAddUser(): void {
    if (!this.newEmail || !this.newGivenName || !this.newFamilyName || this.newRoles.length === 0) {
      this.addError.set('All fields are required and at least one role must be selected.');
      return;
    }
    const payload: CreateUserPayload = {
      email:      this.newEmail.trim(),
      givenName:  this.newGivenName.trim(),
      familyName: this.newFamilyName.trim(),
      roles:      this.newRoles,
    };
    this.addSaving.set(true);
    this.addError.set(null);
    this.api.createUser(payload).subscribe({
      next: (res) => {
        this.users.update((list) => [res.user, ...list]);
        this.addSaving.set(false);
        this.addDrawerVisible.set(false);
        this.messageSvc.add({ severity: 'success', summary: 'User created', detail: `${res.user.fullName} has been added.` });
      },
      error: (err: { userMessage?: string }) => {
        this.addError.set(err.userMessage ?? 'Failed to create user.');
        this.addSaving.set(false);
      },
    });
  }

  protected toggleNewRole(role: TalentFlowRole, checked: boolean): void {
    if (checked) {
      if (!this.newRoles.includes(role)) this.newRoles = [...this.newRoles, role];
    } else {
      this.newRoles = this.newRoles.filter((r) => r !== role);
    }
  }

  // ── Edit Roles ────────────────────────────────────────────────────────────

  protected openEditDrawer(user: AdminUser): void {
    this.editUser.set(user);
    this.editRoles = [...user.roles];
    this.editError.set(null);
    this.editDrawerVisible.set(true);
  }

  protected closeEditDrawer(): void {
    this.editDrawerVisible.set(false);
  }

  protected submitEditRoles(): void {
    const user = this.editUser();
    if (!user) return;
    if (this.editRoles.length === 0) {
      this.editError.set('At least one role must be assigned.');
      return;
    }
    this.editSaving.set(true);
    this.editError.set(null);
    this.api.updateUserRoles(user.userId, { roles: this.editRoles }).subscribe({
      next: (res) => {
        const updated = res.user;
        this.users.update((list) => list.map((u) => (u.userId === updated.userId ? updated : u)));
        this.editSaving.set(false);
        this.editDrawerVisible.set(false);
        this.messageSvc.add({ severity: 'success', summary: 'Roles updated', detail: `${updated.fullName}'s roles have been updated.` });
      },
      error: (err: { userMessage?: string }) => {
        this.editError.set(err.userMessage ?? 'Failed to update roles.');
        this.editSaving.set(false);
      },
    });
  }

  protected toggleEditRole(role: TalentFlowRole, checked: boolean): void {
    if (checked) {
      if (!this.editRoles.includes(role)) this.editRoles = [...this.editRoles, role];
    } else {
      this.editRoles = this.editRoles.filter((r) => r !== role);
    }
  }

  // ── Deactivate ────────────────────────────────────────────────────────────

  protected confirmDeactivate(user: AdminUser, event: Event): void {
    this.confirmSvc.confirm({
      target: event.target as EventTarget,
      header: 'Deactivate user?',
      message: `${user.fullName} will lose access to TalentFlow immediately. This can be reversed by re-creating the account.`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      acceptLabel: 'Deactivate',
      rejectLabel: 'Cancel',
      accept: () => this.doDeactivate(user),
    });
  }

  private doDeactivate(user: AdminUser): void {
    this.api.deactivateUser(user.userId).subscribe({
      next: () => {
        this.users.update((list) =>
          list.map((u) =>
            u.userId === user.userId ? { ...u, status: 'INACTIVE' as const } : u,
          ),
        );
        this.messageSvc.add({ severity: 'info', summary: 'User deactivated', detail: `${user.fullName} has been deactivated.` });
      },
      error: (err: { userMessage?: string }) => {
        this.messageSvc.add({ severity: 'error', summary: 'Error', detail: err.userMessage ?? 'Failed to deactivate user.' });
      },
    });
  }
}
