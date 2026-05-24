import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * AdminSidebarComponent — standalone left-navigation for the Admin workspace.
 *
 * Extracted from AdminShellComponent so navigation state
 * is managed in a single, focused component.
 */
@Component({
  selector: 'tf-admin-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './admin-sidebar.component.html',
  styleUrl: './admin-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSidebarComponent {}
