import { Component, ChangeDetectionStrategy, input, signal, computed, inject, OnInit, effect } from '@angular/core';
import { SidebarComponent, NavItem } from '../../shared/components/sidebar/sidebar.component';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { OnboardingStepperComponent } from './components/onboarding-stepper/onboarding-stepper.component';
import { EmployeeHighlightsComponent } from './components/employee-highlights/employee-highlights.component';
import { DocumentChecklistComponent } from './components/document-checklist/document-checklist.component';
import { Employee, OnboardingStage } from '../../shared/models/employee.model';
import { HrApiService } from '../../core/services/hr-api.service';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

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
    CardModule,
    ButtonModule,
    CheckboxModule,
    FormsModule,
    ProgressSpinnerModule,
  ],
  templateUrl: './employee-dashboard.component.html',
  styleUrl: './employee-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDashboardComponent {
  private readonly hrApi = inject(HrApiService);

  /** Bound from route param :employeeId via withComponentInputBinding() */
  readonly employeeId = input<string>('');

  readonly sidebarOpen = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Employee data — populated from API */
  readonly employee = signal<Employee>({
    employee_id: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    email: '',
    phone: '',
    department: '',
    stage: 'INVITED' as OnboardingStage,
    offer_accept_date: '',
    planned_start_date: '',
    created_at: '',
    created_by: '',
  });

  readonly currentStage = signal<OnboardingStage>('INVITED');

  /** Dynamic sidebar nav — recomputes when employeeId changes */
  readonly navItems = computed<NavItem[]>(() => [
    { label: 'Home', icon: 'pi-home', route: '/', disabled: false },
    { label: 'My Onboarding', icon: 'pi-file', route: '/employees/' + this.employeeId(), disabled: false },
    { label: 'Documents', icon: 'pi-folder', route: '', disabled: true },
    { label: 'Training Videos', icon: 'pi-video', route: '', disabled: true },
    { label: 'Support', icon: 'pi-question-circle', route: '', disabled: true },
  ]);

  /** Consent gate */
  readonly consentAccepted = signal(false);
  consentChecked = false;

  constructor() {
    // React to route param changes — fetch employee data whenever employeeId changes
    effect(() => {
      const id = this.employeeId();
      if (!id) return;
      this.loadEmployeeData(id);
    });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  acceptConsent(): void {
    this.consentAccepted.set(true);
  }

  onAllDocumentsComplete(complete: boolean): void {
    if (complete) {
      this.currentStage.set('VERIFICATION_PENDING');
    }
  }

  private loadEmployeeData(employeeId: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.hrApi.getEmployeeDocuments(employeeId).subscribe({
      next: (res) => {
        const emp = res.employee;
        this.employee.set({
          employee_id: emp.employee_id,
          first_name: emp.first_name,
          middle_name: '',
          last_name: emp.last_name,
          email: emp.email,
          phone: '',
          department: emp.department ?? '',
          stage: emp.stage,
          offer_accept_date: '',
          planned_start_date: emp.planned_start_date ?? '',
          created_at: '',
          created_by: '',
        });
        this.currentStage.set(emp.stage);
        // Auto-bypass consent if employee already has documents
        if (res.documents.length > 0) {
          this.consentAccepted.set(true);
        }
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load employee data:', err);
        this.error.set(`Could not load data for employee ${employeeId}. Please check the ID and try again.`);
        this.loading.set(false);
      },
    });
  }
}
