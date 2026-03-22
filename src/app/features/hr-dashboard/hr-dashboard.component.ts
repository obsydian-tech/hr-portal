import { Component, ChangeDetectionStrategy, input, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent, NavItem } from '../../shared/components/sidebar/sidebar.component';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { NewHireDialogComponent } from './components/new-hire-dialog/new-hire-dialog.component';


@Component({
  selector: 'app-hr-dashboard',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopbarComponent,
    FooterComponent,
    NewHireDialogComponent,
  ],
  templateUrl: './hr-dashboard.component.html',
  styleUrl: './hr-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HrDashboardComponent {
  readonly staffId = input<string>('');

  readonly showNewHireDialog = signal(false);

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'pi-home', route: '/', disabled: false },
    { label: 'Employees', icon: 'pi-users', route: '', disabled: true },
    { label: 'Documents', icon: 'pi-folder', route: '', disabled: true },
    { label: 'Document Verifications', icon: 'pi-verified', route: 'verifications', disabled: false },
    { label: 'Settings', icon: 'pi-cog', route: '', disabled: true },
  ];

  openNewHireDialog(): void {
    this.showNewHireDialog.set(true);
  }

  onEmployeeCreated(): void {
    // Dialog closes itself; could refresh data here
  }
}
