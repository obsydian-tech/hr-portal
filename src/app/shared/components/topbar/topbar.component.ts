import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [ToolbarModule, AvatarModule, ButtonModule, BadgeModule, InputTextModule],
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

  /** Emits when the mobile hamburger menu button is clicked */
  readonly menuToggle = output<void>();

  get initials(): string {
    const name = this.employeeName();
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0]?.toUpperCase() ?? '';
  }
}
