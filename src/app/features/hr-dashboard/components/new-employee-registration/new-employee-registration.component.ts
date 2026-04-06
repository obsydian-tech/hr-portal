import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressBarModule } from 'primeng/progressbar';
import { FileUploadModule } from 'primeng/fileupload';

import { HrApiService } from '../../../../core/services/hr-api.service';
import { DocumentUploadService } from '../../../../core/services/document-upload.service';
import {
  CreateEmployeeRequest,
  DocumentType,
  WizardDocumentSlot,
} from '../../../../shared/models/employee.model';
@Component({
  selector: 'app-new-employee-registration',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    DatePickerModule,
    CardModule,
    DividerModule,
    MessageModule,
    TagModule,
    TooltipModule,
    ProgressBarModule,
    FileUploadModule,
  ],
  templateUrl: './new-employee-registration.component.html',
  styleUrl: './new-employee-registration.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewEmployeeRegistrationComponent {
  private readonly hrApi = inject(HrApiService);
  private readonly uploadService = inject(DocumentUploadService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // ─── Wizard Steps ────────────────────────────────────────

  readonly steps = [
    { label: 'Personal Information', icon: 'pi pi-user' },
    { label: 'Employment Details', icon: 'pi pi-briefcase' },
    { label: 'Documents', icon: 'pi pi-file' },
    { label: 'Confirmation', icon: 'pi pi-check-circle' },
  ];

  stepState(index: number): 'completed' | 'active' | 'upcoming' {
    const current = this.activeStep();
    if (index < current) return 'completed';
    if (index === current) return 'active';
    return 'upcoming';
  }

  connectorState(index: number): 'completed' | 'active' | 'upcoming' {
    const current = this.activeStep();
    if (index < current) return 'completed';
    return 'upcoming';
  }

  readonly activeStep = signal(0);

  // ─── Step 1: Personal Details ────────────────────────────

  firstName = '';
  middleName = '';
  lastName = '';
  email = '';
  phone = '';

  readonly searchingEmail = signal(false);
  readonly emailExists = signal(false);

  // ─── Step 2: Employment Details ──────────────────────────

  department = '';
  jobTitle = '';
  offerAcceptDate: Date | null = null;
  plannedStartDate: Date | null = null;

  readonly departments = [
    { label: 'Engineering', value: 'Engineering' },
    { label: 'Finance', value: 'Finance' },
    { label: 'Marketing', value: 'Marketing' },
    { label: 'HR', value: 'HR' },
    { label: 'Legal', value: 'Legal' },
    { label: 'Operations', value: 'Operations' },
  ];

  // ─── Step 3: Document Upload ─────────────────────────────

  readonly documentSlots = signal<WizardDocumentSlot[]>([
    {
      type: 'NATIONAL_ID',
      label: 'South African ID',
      description: 'National identity document or smart ID card',
      icon: 'pi pi-id-card',
      file: null,
      fileName: '',
      uploading: false,
      uploaded: false,
      ocrResult: null,
    },
    {
      type: 'BANK_CONFIRMATION',
      label: 'Bank Confirmation',
      description: 'Bank-stamped confirmation letter or statement',
      icon: 'pi pi-building-columns',
      file: null,
      fileName: '',
      uploading: false,
      uploaded: false,
      ocrResult: null,
    },
    {
      type: 'MATRIC_CERTIFICATE',
      label: 'Matric Certificate',
      description: 'Grade 12 / NSC certificate',
      icon: 'pi pi-graduation-cap',
      file: null,
      fileName: '',
      uploading: false,
      uploaded: false,
      ocrResult: null,
    },
    {
      type: 'TERTIARY_QUALIFICATION',
      label: 'Tertiary Qualification',
      description: 'Degree, diploma, or professional certificate',
      icon: 'pi pi-book',
      file: null,
      fileName: '',
      uploading: false,
      uploaded: false,
      ocrResult: null,
    },
  ]);

  readonly uploadedCount = computed(
    () => this.documentSlots().filter((s) => s.uploaded).length
  );

  // ─── Step 4: Submission ──────────────────────────────────

  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly createdEmployeeId = signal('');
  readonly submitError = signal<string | null>(null);
  readonly submitProgress = signal('');

  /** Staff ID from parent route param :staffId */
  private staffId = '';

  constructor() {
    // Read staffId from parent route
    const parentParams = this.route.parent?.snapshot.params;
    this.staffId = parentParams?.['staffId'] ?? '';
  }

  // ─── File Validation Constants ───────────────────────────

  private readonly ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  // ─── Validation ──────────────────────────────────────────

  get isStep1Valid(): boolean {
    return (
      this.firstName.trim().length > 0 &&
      this.lastName.trim().length > 0 &&
      this.email.trim().length > 0 &&
      this.phone.trim().length > 0 &&
      !this.emailExists()
    );
  }

  get isStep2Valid(): boolean {
    return (
      this.department.length > 0 &&
      this.offerAcceptDate !== null &&
      this.plannedStartDate !== null
    );
  }

  // ─── Step Navigation ─────────────────────────────────────

  nextStep(): void {
    if (this.activeStep() < 3) {
      this.activeStep.update((s) => s + 1);
    }
  }

  prevStep(): void {
    if (this.activeStep() > 0) {
      this.activeStep.update((s) => s - 1);
    }
  }

  goToStep(index: number): void {
    // Allow going back or to already-completed steps
    if (index <= this.activeStep()) {
      this.activeStep.set(index);
    }
  }

  get canProceed(): boolean {
    switch (this.activeStep()) {
      case 0:
        return this.isStep1Valid;
      case 1:
        return this.isStep2Valid;
      case 2:
        return true; // Documents are optional at registration
      case 3:
        return this.isStep1Valid && this.isStep2Valid;
      default:
        return false;
    }
  }

  // ─── Email Check ─────────────────────────────────────────

  searchByEmail(): void {
    if (!this.email.trim()) return;
    this.searchingEmail.set(true);
    this.emailExists.set(false);

    this.hrApi.searchEmployeeByEmail(this.email.trim()).subscribe((exists) => {
      this.emailExists.set(exists);
      this.searchingEmail.set(false);
    });
  }

  // ─── Document Staging (files stored locally, uploaded after employee creation) ──

  onFileSelect(event: Event, slotIndex: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate file type
    if (!this.ALLOWED_TYPES.includes(file.type)) {
      const slots = [...this.documentSlots()];
      const slot = { ...slots[slotIndex] };
      slot.ocrResult = {
        success: false,
        message: 'Invalid file type. Only PDF, JPG, and PNG files are accepted.',
        documentTypeDetected: slot.type,
      };
      slots[slotIndex] = slot;
      this.documentSlots.set(slots);
      input.value = '';
      return;
    }

    // Validate file size (5MB)
    if (file.size > this.MAX_FILE_SIZE) {
      const slots = [...this.documentSlots()];
      const slot = { ...slots[slotIndex] };
      slot.ocrResult = {
        success: false,
        message: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 5MB.`,
        documentTypeDetected: slot.type,
      };
      slots[slotIndex] = slot;
      this.documentSlots.set(slots);
      input.value = '';
      return;
    }

    // Stage the file locally — no API call yet
    const slots = [...this.documentSlots()];
    const slot = { ...slots[slotIndex] };
    slot.file = file;
    slot.fileName = file.name;
    slot.uploading = false;
    slot.uploaded = true; // visually marked as "staged"
    slot.ocrResult = null;
    slots[slotIndex] = slot;
    this.documentSlots.set(slots);
    input.value = '';
  }

  removeFile(slotIndex: number): void {
    const slots = [...this.documentSlots()];
    const slot = { ...slots[slotIndex] };
    slot.file = null;
    slot.fileName = '';
    slot.uploading = false;
    slot.uploaded = false;
    slot.ocrResult = null;
    slots[slotIndex] = slot;
    this.documentSlots.set(slots);
  }

  // ─── Submit: Create Employee → Upload Staged Documents ──

  submit(): void {
    if (!this.isStep1Valid || !this.isStep2Valid) return;
    this.submitting.set(true);
    this.submitError.set(null);
    this.submitProgress.set('Creating employee record...');

    const payload: CreateEmployeeRequest = {
      first_name: this.firstName.trim(),
      middle_name: this.middleName.trim() || undefined,
      last_name: this.lastName.trim(),
      email: this.email.trim(),
      phone: this.phone.trim(),
      department: this.department,
      job_title: this.jobTitle.trim() || undefined,
      offer_accept_date: this.offerAcceptDate!.toISOString().split('T')[0],
      planned_start_date: this.plannedStartDate!.toISOString().split('T')[0],
    };

    this.hrApi
      .createEmployee(this.staffId, payload)
      .pipe(
        switchMap((employee) => {
          const employeeId = employee.employee_id;
          this.createdEmployeeId.set(employeeId);

          // Collect staged files that need uploading
          const stagedSlots = this.documentSlots().filter((s) => s.file);
          if (stagedSlots.length === 0) {
            // No documents to upload — done
            return of([]);
          }

          this.submitProgress.set(
            `Employee created (${employeeId}). Uploading ${stagedSlots.length} document${stagedSlots.length > 1 ? 's' : ''}...`
          );

          // Upload all staged documents in parallel with the real employee ID
          const uploads$ = stagedSlots.map((slot) =>
            this.uploadService.upload(slot.file!, slot.type, employeeId).pipe(
              catchError((err) => {
                console.error(`Upload failed for ${slot.type}:`, err);
                // Don't fail the whole submission — mark as failed but continue
                return of({ message: 'Upload failed', document_id: '', employee_id: employeeId, s3_key: '', ocr_status: 'FAILED' });
              })
            )
          );

          return forkJoin(uploads$);
        })
      )
      .subscribe({
        next: (uploadResults) => {
          // Update slot states with upload results
          const stagedSlots = this.documentSlots().filter((s) => s.file);
          if (stagedSlots.length > 0) {
            const allSlots = [...this.documentSlots()];
            let resultIdx = 0;
            for (let i = 0; i < allSlots.length; i++) {
              if (allSlots[i].file) {
                const result = uploadResults[resultIdx++];
                const slot = { ...allSlots[i] };
                slot.uploading = false;
                slot.uploaded = true;
                slot.ocrResult = {
                  success: result.ocr_status !== 'FAILED',
                  message: result.message,
                  documentTypeDetected: slot.type,
                };
                allSlots[i] = slot;
              }
            }
            this.documentSlots.set(allSlots);
          }

          this.submitting.set(false);
          this.submitProgress.set('');
          this.submitted.set(true);
        },
        error: (err) => {
          console.error('Employee registration failed:', err);
          this.submitting.set(false);
          this.submitProgress.set('');
          this.submitError.set(
            err.error?.message || 'Failed to create employee. Please try again.'
          );
        },
      });
  }

  // ─── Navigation ──────────────────────────────────────────

  goBack(): void {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  viewEmployee(): void {
    const id = this.createdEmployeeId();
    if (id) {
      this.router.navigate(['..', 'employees', id], { relativeTo: this.route });
    }
  }

  registerAnother(): void {
    // Reset everything
    this.firstName = '';
    this.middleName = '';
    this.lastName = '';
    this.email = '';
    this.phone = '';
    this.department = '';
    this.jobTitle = '';
    this.offerAcceptDate = null;
    this.plannedStartDate = null;
    this.emailExists.set(false);
    this.submitted.set(false);
    this.createdEmployeeId.set('');
    this.submitError.set(null);
    this.submitProgress.set('');
    this.activeStep.set(0);

    this.documentSlots.set([
      {
        type: 'NATIONAL_ID',
        label: 'South African ID',
        description: 'National identity document or smart ID card',
        icon: 'pi pi-id-card',
        file: null,
        fileName: '',
        uploading: false,
        uploaded: false,
        ocrResult: null,
      },
      {
        type: 'BANK_CONFIRMATION',
        label: 'Bank Confirmation',
        description: 'Bank-stamped confirmation letter or statement',
        icon: 'pi pi-building-columns',
        file: null,
        fileName: '',
        uploading: false,
        uploaded: false,
        ocrResult: null,
      },
      {
        type: 'MATRIC_CERTIFICATE',
        label: 'Matric Certificate',
        description: 'Grade 12 / NSC certificate',
        icon: 'pi pi-graduation-cap',
        file: null,
        fileName: '',
        uploading: false,
        uploaded: false,
        ocrResult: null,
      },
      {
        type: 'TERTIARY_QUALIFICATION',
        label: 'Tertiary Qualification',
        description: 'Degree, diploma, or professional certificate',
        icon: 'pi pi-book',
        file: null,
        fileName: '',
        uploading: false,
        uploaded: false,
        ocrResult: null,
      },
    ]);
  }
}
