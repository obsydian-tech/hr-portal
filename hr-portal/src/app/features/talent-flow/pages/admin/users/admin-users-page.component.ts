import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { SlicePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { AdminApiService } from '../../../services/admin-api.service';
import { AdminUser } from '../../../models/admin.models';
import { RolePillComponent } from './components/role-pill/role-pill.component';
import { AddUserDrawerComponent } from './components/add-user-drawer/add-user-drawer.component';
import { EditRolesDrawerComponent } from './components/edit-roles-drawer/edit-roles-drawer.component';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

@Component({
  selector: 'tf-admin-users-page',
  standalone: true,
  imports: [
    SlicePipe,
    ButtonModule,
    InputTextModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
    RolePillComponent,
    AddUserDrawerComponent,
    EditRolesDrawerComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './admin-users-page.component.html',
  styleUrl:    './admin-users-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersPageComponent implements OnInit {
  private readonly api        = inject(AdminApiService);
  private readonly confirmSvc = inject(ConfirmationService);
  private readonly messageSvc = inject(MessageService);

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

  // ── Drawer state ──────────────────────────────────────────────────────────

  protected readonly showAdd    = signal(false);
  protected readonly showEdit   = signal(false);
  protected readonly editTarget = signal<AdminUser | null>(null);

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
    this.showAdd.set(true);
  }

  protected onUserCreated(user: AdminUser): void {
    this.users.update((list) => [user, ...list]);
    this.showAdd.set(false);
    this.messageSvc.add({
      severity: 'success',
      summary: 'User created',
      detail: `${user.fullName} has been added.`,
    });
  }

  // ── Edit Roles ────────────────────────────────────────────────────────────

  protected openEditDrawer(user: AdminUser): void {
    this.editTarget.set(user);
    this.showEdit.set(true);
  }

  protected onRolesUpdated(updated: AdminUser): void {
    this.users.update((list) =>
      list.map((u) => (u.userId === updated.userId ? updated : u)),
    );
    this.showEdit.set(false);
    this.messageSvc.add({
      severity: 'success',
      summary: 'Roles updated',
      detail: `${updated.fullName}'s roles have been updated.`,
    });
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
        this.messageSvc.add({
          severity: 'info',
          summary: 'User deactivated',
          detail: `${user.fullName} has been deactivated.`,
        });
      },
      error: (err: { userMessage?: string }) => {
        this.messageSvc.add({
          severity: 'error',
          summary: 'Error',
          detail: err.userMessage ?? 'Failed to deactivate user.',
        });
      },
    });
  }
}

