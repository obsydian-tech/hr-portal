import { Component, ChangeDetectionStrategy, input, output, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ToolbarModule } from 'primeng/toolbar';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';
import { OverlayPanel, OverlayPanelModule } from 'primeng/overlaypanel';
import { NotificationDropdownComponent } from '../notification-dropdown/notification-dropdown.component';
import { Verification } from '../../models/employee.model';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [
    ToolbarModule,
    AvatarModule,
    ButtonModule,
    BadgeModule,
    InputTextModule,
    OverlayPanelModule,
    NotificationDropdownComponent,
  ],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  readonly title = input<string>('HR Portal');
  readonly employeeName = input<string>('');
  readonly employeeRole = input<string>('');
  readonly showSearch = input(false);
  readonly showNotifications = input(false);
  readonly notificationCount = input<number>(0);
  readonly recentNotifications = input<any[]>([]);
  readonly notificationsRoute = input<string>('');

  /** Emits when the mobile hamburger menu button is clicked */
  readonly menuToggle = output<void>();
  
  /** Emits when a notification is clicked in the dropdown */
  readonly notificationClick = output<any>();
  
  /** Emits when "View All" is clicked in the dropdown */
  readonly viewAllNotifications = output<void>();
  
  // Reference to the overlay panel
  readonly notificationPanel = viewChild<OverlayPanel>('notificationPanel');

  constructor(private router: Router) {}

  get initials(): string {
    const name = this.employeeName();
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0]?.toUpperCase() ?? '';
  }
  
  onBellClick(event: Event): void {
    this.notificationPanel()?.toggle(event);
  }
  
  onNotificationItemClick(notification: Verification): void {
    this.notificationPanel()?.hide();
    this.notificationClick.emit(notification);
  }
  
  onViewAllClick(): void {
    this.notificationPanel()?.hide();
    this.viewAllNotifications.emit();
  }
}
