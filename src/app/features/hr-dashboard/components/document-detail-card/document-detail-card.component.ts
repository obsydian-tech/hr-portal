import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
} from '@angular/core';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { HrApiService } from '../../../../core/services/hr-api.service';
import { EmployeeDocument } from '../../../../shared/models/employee.model';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-document-detail-card',
  standalone: true,
  imports: [
    DatePipe,
    KeyValuePipe,
    CardModule,
    TagModule,
    ButtonModule,
    DividerModule,
    ConfirmDialogModule,
    MessageModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './document-detail-card.component.html',
  styleUrl: './document-detail-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentDetailCardComponent {
  private readonly hrApi = inject(HrApiService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly doc = input.required<EmployeeDocument>();

  readonly verifying = signal(false);
  readonly verificationTriggered = signal(false);

  get ocrSeverity(): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (this.doc().ocr_status) {
      case 'PASSED': return 'success';
      case 'MANUAL_REVIEW': return 'warn';
      case 'FAILED': return 'danger';
      case 'PENDING': return 'info';
      default: return 'secondary';
    }
  }

  get canVerifyExternally(): boolean {
    const type = this.doc().document_type;
    return type === 'NATIONAL_ID' || type === 'BANK_CONFIRMATION';
  }

  get isManualReviewOnly(): boolean {
    const type = this.doc().document_type;
    return type === 'MATRIC_CERTIFICATE' || type === 'TERTIARY_QUALIFICATION';
  }

  get documentLabel(): string {
    return this.doc().document_type.replace(/_/g, ' ');
  }

  get hasOcrResults(): boolean {
    const v = this.doc().verification;
    return !!(v?.reasoning || v?.id_number);
  }

  get reasoning(): string | undefined {
    return this.doc().verification?.reasoning;
  }

  get extractedFields(): Record<string, string> {
    const v = this.doc().verification;
    if (!v) return {};
    const fields: Record<string, string> = {};
    if (v.id_number && v.id_number !== 'NOT_FOUND' && v.id_number !== 'N/A') fields['ID Number'] = v.id_number;
    if (v.name && v.name !== 'NOT_FOUND' && v.name !== 'N/A') fields['First Name'] = v.name;
    if (v.surname && v.surname !== 'NOT_FOUND' && v.surname !== 'N/A') fields['Surname'] = v.surname;
    if (v.date_of_birth && v.date_of_birth !== 'NOT_FOUND' && v.date_of_birth !== 'N/A') fields['Date of Birth'] = v.date_of_birth;
    if (v.gender && v.gender !== 'NOT_FOUND' && v.gender !== 'N/A') fields['Gender'] = v.gender;
    if (v.citizenship && v.citizenship !== 'NOT_FOUND' && v.citizenship !== 'N/A') fields['Citizenship'] = v.citizenship;
    return fields;
  }

  triggerVerification(): void {
    const d = this.doc();
    const partner = d.document_type === 'NATIONAL_ID' ? 'VerifyNow' : 'AVS';

    this.confirmationService.confirm({
      message: `This will send a verification request to ${partner} for the ${this.documentLabel}. Proceed?`,
      header: 'Confirm External Verification',
      icon: 'pi pi-shield',
      acceptLabel: 'Verify',
      rejectLabel: 'Cancel',
      accept: () => {
        this.verifying.set(true);
        this.hrApi.triggerExternalVerification(d.document_id, d.document_type).subscribe(() => {
          this.verifying.set(false);
          this.verificationTriggered.set(true);
        });
      },
    });
  }
}
