import { Component, ChangeDetectionStrategy, input } from '@angular/core';
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
  readonly title = input<string>('Employee Onboarding Portal');
  readonly employeeName = input<string>('');
  readonly showSearch = input(false);
  readonly showNotifications = input(false);
}
