import { Component, ChangeDetectionStrategy, input, signal, computed, inject } from '@angular/core';
import { Router, RouterOutlet, ActivatedRoute } from '@angular/router';
import { SidebarComponent, NavItem } from '../../shared/components/sidebar/sidebar.component';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { getHrStaffById } from '../../shared/constants/hr-staff';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { Verification } from '../../shared/models/employee.model';


@Component({
  selector: 'app-hr-dashboard',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopbarComponent,
    FooterComponent,
  ],
  providers: [NotificationService], // Provide at dashboard level for all child routes
  templateUrl: './hr-dashboard.component.html',
  styleUrl: './hr-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HrDashboardComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  readonly notificationService = inject(NotificationService);

  readonly staffId = input<string>('');

  /** Resolved HR staff member from registry */
  readonly currentStaff = computed(() => getHrStaffById(this.staffId()));
  readonly staffName = computed(() => this.currentStaff()?.fullName ?? 'HR Staff');
  readonly staffRole = computed(() => {
    const role = this.currentStaff()?.role;
    return role === 'HR_MANAGER' ? 'HR Manager' : 'HR Partner';
  });
  
  /** Notification data from service */
  readonly notificationCount = this.notificationService.notificationCount;
  readonly recentNotifications = this.notificationService.recentNotifications;
  
  /** Notifications route for "View All" link */
  readonly notificationsRoute = computed(() => `/hr/${this.staffId()}/notifications`);

  readonly sidebarOpen = signal(false);

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'pi-home', route: '/', disabled: false },
    { label: 'Employees', icon: 'pi-users', route: '', disabled: true },
    { label: 'Documents', icon: 'pi-folder', route: '', disabled: true },
    { label: 'Document Verifications', icon: 'pi-verified', route: 'verifications', disabled: false },
    { label: 'Notifications', icon: 'pi-bell', route: 'notifications', disabled: false },
    { label: 'Support Inbox', icon: 'pi-comments', route: 'support-inbox', disabled: false },
    { label: 'Settings', icon: 'pi-cog', route: '', disabled: true },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  openNewHireRegistration(): void {
    this.router.navigate(['new-employee'], { relativeTo: this.route });
  }
  
  /**
   * Handle notification click from topbar dropdown
   * Navigate to verification detail page
   */
  onNotificationClick(notification: Verification): void {
    if (notification.document_id) {
      this.router.navigate(['verifications', notification.document_id], { relativeTo: this.route });
    }
  }
  
  /**
   * Handle "View All" click from topbar dropdown
   * Navigate to notifications page
   */
  onViewAllNotifications(): void {
    this.router.navigate(['notifications'], { relativeTo: this.route });
  }

  /**
   * Handle logout from sidebar
   */
  onLogout(): void {
    this.authService.logout();
  }
}
