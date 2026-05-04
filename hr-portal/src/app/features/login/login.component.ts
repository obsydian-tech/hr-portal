import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { AuthService, AuthUser } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, PasswordModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  // ── Form fields ──
  username = '';
  password = '';
  newPassword = '';
  confirmNewPassword = '';

  // ── UI state ──
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly showNewPasswordForm = signal(false);

  constructor() {
    // If already authenticated, redirect immediately
    if (this.authService.isAuthenticated()) {
      this.redirectToDashboard(this.authService.currentUser());
    }
  }

  async onLogin(): Promise<void> {
    if (!this.username || !this.password) {
      this.errorMessage.set('Please enter your email and password.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    const result = await this.authService.login(this.username, this.password);
    this.loading.set(false);

    switch (result.status) {
      case 'SUCCESS':
        this.redirectToDashboard(result.user);
        break;
      case 'NEW_PASSWORD_REQUIRED':
        this.showNewPasswordForm.set(true);
        this.errorMessage.set('');
        break;
      case 'ERROR':
        this.errorMessage.set(result.message);
        break;
    }
  }

  async onSetNewPassword(): Promise<void> {
    if (!this.newPassword || !this.confirmNewPassword) {
      this.errorMessage.set('Please fill in both password fields.');
      return;
    }

    if (this.newPassword !== this.confirmNewPassword) {
      this.errorMessage.set('Passwords do not match.');
      return;
    }

    if (this.newPassword.length < 12) {
      this.errorMessage.set('Password must be at least 12 characters.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    const result = await this.authService.completeNewPassword(this.newPassword);
    this.loading.set(false);

    if (result.status === 'SUCCESS') {
      this.redirectToDashboard(result.user);
    } else if (result.status === 'ERROR') {
      this.errorMessage.set(result.message);
    }
  }

  private redirectToDashboard(user: AuthUser | null): void {
    if (user?.role === 'hr_staff' && user.staffId) {
      this.router.navigate(['/hr', user.staffId]);
    } else if (user?.role === 'employee' && user.employeeId) {
      this.router.navigate(['/employees', user.employeeId]);
    } else {
      this.router.navigate(['/']);
    }
  }
}
