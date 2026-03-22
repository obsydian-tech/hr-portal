import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvatarModule } from 'primeng/avatar';
import { DividerModule } from 'primeng/divider';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';

export interface NavItem {
  label: string;
  icon: string;
  route: string;
  disabled: boolean;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, AvatarModule, DividerModule, TooltipModule, ButtonModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  readonly navItems = input<NavItem[]>([]);
  readonly activeRoute = input<string>('');

  /** Optional action button (e.g. "New Hire") shown above logout */
  readonly actionLabel = input<string>('');
  readonly actionIcon = input<string>('pi-plus');
  readonly actionClicked = output<void>();
}
