import { Component, ChangeDetectionStrategy, input, signal } from '@angular/core';
import { SidebarComponent, NavItem } from '../../shared/components/sidebar/sidebar.component';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { OnboardingStepperComponent } from './components/onboarding-stepper/onboarding-stepper.component';
import { EmployeeHighlightsComponent } from './components/employee-highlights/employee-highlights.component';
import { DocumentChecklistComponent } from './components/document-checklist/document-checklist.component';
import { Employee, OnboardingStage } from '../../shared/models/employee.model';

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  imports: [
    SidebarComponent,
    TopbarComponent,
    FooterComponent,
    OnboardingStepperComponent,
    EmployeeHighlightsComponent,
    DocumentChecklistComponent,
  ],
  templateUrl: './employee-dashboard.component.html',
  styleUrl: './employee-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDashboardComponent {
  readonly employeeId = input<string>('');

  /** Sidebar nav items — only "My Onboarding" is active */
  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'pi-home', route: '/', disabled: false },
    { label: 'My Onboarding', icon: 'pi-file', route: '/employees/EMP-0000015', disabled: false },
    { label: 'Documents', icon: 'pi-folder', route: '', disabled: true },
    { label: 'Training Videos', icon: 'pi-video', route: '', disabled: true },
    { label: 'Support', icon: 'pi-question-circle', route: '', disabled: true },
  ];

  /** Mock employee data — in production, fetched from API using employeeId input */
  readonly employee = signal<Employee>({
    employee_id: 'EMP-0000015',
    first_name: 'John',
    middle_name: 'David',
    last_name: 'Smith',
    email: 'john.smith@example.com',
    phone: '+27821234568',
    department: 'Finance',
    stage: 'DOCUMENTS' as OnboardingStage,
    offer_accept_date: '2026-03-15',
    planned_start_date: '2026-04-15',
    created_at: '2026-03-21T11:56:03.116Z',
    created_by: 'AS00001',
  });

  readonly currentStage = signal<OnboardingStage>('DOCUMENTS');

  onAllDocumentsComplete(complete: boolean): void {
    if (complete) {
      this.currentStage.set('VERIFICATION_PENDING');
    }
  }
}
