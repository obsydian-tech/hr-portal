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

  // ─── Document Upload ─────────────────────────────────────

  onFileSelect(event: Event, slotIndex: number): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const slots = [...this.documentSlots()];
    const slot = { ...slots[slotIndex] };
    slot.file = file;
    slot.fileName = file.name;
    slot.uploading = true;
    slot.ocrResult = null;
    slots[slotIndex] = slot;
    this.documentSlots.set(slots);

    // Simulate OCR processing
    this.uploadService.upload(file, slot.type).subscribe((result) => {
      const updatedSlots = [...this.documentSlots()];
      const updatedSlot = { ...updatedSlots[slotIndex] };
      updatedSlot.uploading = false;
      updatedSlot.uploaded = true;
      updatedSlot.ocrResult = result;
      updatedSlots[slotIndex] = updatedSlot;
      this.documentSlots.set(updatedSlots);
    });
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

  // ─── Submit ──────────────────────────────────────────────

  submit(): void {
    if (!this.isStep1Valid || !this.isStep2Valid) return;
    this.submitting.set(true);

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

    this.hrApi.createEmployee('AS00001', payload).subscribe((employee) => {
      this.submitting.set(false);
      this.submitted.set(true);
      this.createdEmployeeId.set(employee.employee_id);
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
