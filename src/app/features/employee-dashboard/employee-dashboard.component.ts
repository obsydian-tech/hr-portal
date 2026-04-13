import { Component, ChangeDetectionStrategy, input, signal, computed, inject, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SidebarComponent, NavItem } from '../../shared/components/sidebar/sidebar.component';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { FooterComponent } from '../../shared/components/footer/footer.component';
import { DocumentChecklistComponent } from './components/document-checklist/document-checklist.component';
import { Employee, OnboardingStage, EmployeeDocument, DocumentType } from '../../shared/models/employee.model';
import { HrApiService } from '../../core/services/hr-api.service';
import { EmployeeNotificationService } from '../../core/services/employee-notification.service';
import { AuthService } from '../../core/services/auth.service';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

/** The 4 required document types for onboarding */
const REQUIRED_DOC_TYPES: DocumentType[] = [
  'NATIONAL_ID',
  'BANK_CONFIRMATION',
  'MATRIC_CERTIFICATE',
  'TERTIARY_QUALIFICATION',
];

/**
 * Compute the effective onboarding stage from the employee's backend stage
 * and the actual state of their documents.
 *
 * Priority:
 *  - Backend stages TRAINING / ONBOARDED always win (set by HR manually)
 *  - VERIFIED wins if backend says so OR all 4 doc types are PASSED
 *  - Otherwise derive from document upload & verification status
 */
function computeStage(backendStage: OnboardingStage, documents: EmployeeDocument[]): OnboardingStage {
  // Late-stage overrides — these are set manually by HR, always trust them
  if (backendStage === 'ONBOARDED') return 'ONBOARDED';
  if (backendStage === 'TRAINING') return 'TRAINING';
  if (backendStage === 'VERIFIED') return 'VERIFIED';

  // No documents at all → INVITED (profile just created)
  if (documents.length === 0) return 'INVITED';

  // Group docs by type — take the "best" status per type
  // (an employee may re-upload, so multiple docs of the same type can exist)
  const bestStatusByType = new Map<string, string>();
  for (const doc of documents) {
    const current = bestStatusByType.get(doc.document_type);
    // Priority: PASSED > MANUAL_REVIEW > PENDING > FAILED > PROCESSING
    if (!current || statusPriority(doc.ocr_status) > statusPriority(current)) {
      bestStatusByType.set(doc.document_type, doc.ocr_status);
    }
  }

  // Check how many of the 4 required types have been uploaded
  const uploadedTypes = REQUIRED_DOC_TYPES.filter((t) => bestStatusByType.has(t));
  const passedTypes = REQUIRED_DOC_TYPES.filter((t) => bestStatusByType.get(t) === 'PASSED');
  const pendingOrProcessing = REQUIRED_DOC_TYPES.filter((t) => {
    const s = bestStatusByType.get(t);
    return s === 'PENDING' || s === 'PROCESSING';
  });
  const inReview = REQUIRED_DOC_TYPES.filter((t) => bestStatusByType.get(t) === 'MANUAL_REVIEW');

  // All 4 types PASSED → VERIFIED
  if (passedTypes.length === REQUIRED_DOC_TYPES.length) return 'VERIFIED';

  // All 4 types uploaded and none still pending/processing → VERIFICATION_PENDING
  // (they're in some mix of PASSED, MANUAL_REVIEW, FAILED — HR is reviewing)
  if (uploadedTypes.length === REQUIRED_DOC_TYPES.length && pendingOrProcessing.length === 0) {
    return 'VERIFICATION_PENDING';
  }

  // At least one doc uploaded → DOCUMENTS (employee is in the upload phase)
  if (uploadedTypes.length > 0) return 'DOCUMENTS';

  return 'INVITED';
}

/** Higher = better status when picking the "best" status per doc type */
function statusPriority(status: string): number {
  switch (status) {
    case 'PASSED': return 5;
    case 'MANUAL_REVIEW': return 3;
    case 'PENDING': return 2;
    case 'PROCESSING': return 2;
    case 'FAILED': return 1;
    default: return 0;
  }
}

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  providers: [EmployeeNotificationService],
  imports: [
    SidebarComponent,
    TopbarComponent,
    FooterComponent,
    DocumentChecklistComponent,
    DatePipe,
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
  private readonly authService = inject(AuthService);
  readonly notificationService = inject(EmployeeNotificationService);

  /** Bound from route param :employeeId via withComponentInputBinding() */
  readonly employeeId = input<string>('');

  readonly sidebarOpen = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly highlightedDocumentId = signal<string | null>(null);

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
    hr_staff_id: '',
    hr_staff_name: '',
    hr_staff_email: '',
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

  /** Whether all 4 documents have been uploaded & passed */
  readonly allDocsComplete = signal(false);

  constructor() {
    // React to route param changes — fetch employee data whenever employeeId changes
    effect(() => {
      const id = this.employeeId();
      if (!id) return;
      this.loadEmployeeData(id);
      // Initialize notification service with employee ID
      this.notificationService.initialize(id);
    });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  onLogout(): void {
    this.authService.logout();
  }

  /**
   * Handle notification click from topbar dropdown
   * Scrolls to the relevant document in the checklist
   */
  onNotificationClick(notification: any): void {
    if (notification?.document_id) {
      // Set highlighted document ID to trigger scroll and highlight effect
      this.highlightedDocumentId.set(notification.document_id);
      
      // Clear highlight after 3 seconds
      setTimeout(() => {
        this.highlightedDocumentId.set(null);
      }, 3000);
    }
  }

  acceptConsent(): void {
    this.consentAccepted.set(true);
  }

  onAllDocumentsComplete(complete: boolean): void {
    this.allDocsComplete.set(complete);
    // Re-fetch to get fresh stage from backend
    if (complete && this.employeeId()) {
      this.loadEmployeeData(this.employeeId());
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
          phone: emp.phone ?? '',
          department: emp.department ?? '',
          stage: emp.stage,
          offer_accept_date: '',
          planned_start_date: emp.planned_start_date ?? '',
          created_at: '',
          created_by: '',
          hr_staff_id: emp.hr_staff_id ?? '',
          hr_staff_name: emp.hr_staff_name ?? '',
          hr_staff_email: emp.hr_staff_email ?? '',
        });

        // Compute effective stage from actual document data
        const effectiveStage = computeStage(emp.stage, res.documents);
        this.currentStage.set(effectiveStage);

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
