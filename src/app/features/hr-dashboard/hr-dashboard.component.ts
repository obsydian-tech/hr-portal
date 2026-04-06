import { Component, ChangeDetectionStrategy, input, signal, computed, inject } from '@angular/core';
import { Router, RouterOutlet, ActivatedRoute } from '@angular/router';
import { SidebarComponent, NavItem } from '../../shared/components/sidebar/sidebar.component';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { getHrStaffById } from '../../shared/constants/hr-staff';


@Component({
  selector: 'app-hr-dashboard',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopbarComponent,
    FooterComponent,
  ],
  templateUrl: './hr-dashboard.component.html',
  styleUrl: './hr-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HrDashboardComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly staffId = input<string>('');

  /** Resolved HR staff member from registry */
  readonly currentStaff = computed(() => getHrStaffById(this.staffId()));
  readonly staffName = computed(() => this.currentStaff()?.fullName ?? 'HR Staff');
  readonly staffRole = computed(() => {
    const role = this.currentStaff()?.role;
    return role === 'HR_MANAGER' ? 'HR Manager' : 'HR Partner';
  });

  readonly sidebarOpen = signal(false);

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'pi-home', route: '/', disabled: false },
    { label: 'Employees', icon: 'pi-users', route: '', disabled: true },
    { label: 'Documents', icon: 'pi-folder', route: '', disabled: true },
    { label: 'Document Verifications', icon: 'pi-verified', route: 'verifications', disabled: false },
    { label: 'Settings', icon: 'pi-cog', route: '', disabled: true },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  openNewHireRegistration(): void {
    this.router.navigate(['new-employee'], { relativeTo: this.route });
  }
}
