import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  input,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { HrApiService } from '../../../../core/services/hr-api.service';
import { VerificationDetail } from '../../../../shared/models/employee.model';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageModule } from 'primeng/message';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';

@Component({
  selector: 'app-verification-detail',
  standalone: true,
  imports: [
    DatePipe,
    KeyValuePipe,
    CardModule,
    TagModule,
    ButtonModule,
    DividerModule,
    SkeletonModule,
    MessageModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './verification-detail.component.html',
  styleUrl: './verification-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerificationDetailComponent implements OnInit {
  private readonly hrApi = inject(HrApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

  readonly documentId = input<string>('');
  readonly loading = signal(true);
  readonly verification = signal<VerificationDetail | null>(null);

  // Manual review state
  readonly reviewDecision = signal<'approved' | 'rejected' | null>(null);
  readonly previewLoading = signal(false);
  readonly reviewLoading = signal(false);
  readonly reviewError = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.documentId() || this.route.snapshot.params['documentId'];
    if (id) {
      this.hrApi.getVerificationByDocumentId(id).subscribe((res) => {
        this.verification.set(res);
        this.loading.set(false);
      });
    }
  }

  get v() {
    return this.verification();
  }

  get decisionSeverity(): 'success' | 'warn' | 'danger' | 'secondary' {
    switch (this.v?.decision) {
      case 'PASSED': return 'success';
      case 'MANUAL_REVIEW': return 'warn';
      case 'FAILED': return 'danger';
      default: return 'secondary';
    }
  }

  /** CSS class for the reasoning box based on decision */
  get reasoningBoxClass(): string {
    switch (this.v?.decision) {
      case 'PASSED': return 'reasoning-box reasoning-box--success';
      case 'MANUAL_REVIEW': return 'reasoning-box reasoning-box--warn';
      case 'FAILED': return 'reasoning-box reasoning-box--danger';
      default: return 'reasoning-box';
    }
  }

  /** CSS class for the reasoning label */
  get reasoningLabelClass(): string {
    switch (this.v?.decision) {
      case 'PASSED': return 'reasoning-label reasoning-label--success';
      case 'MANUAL_REVIEW': return 'reasoning-label reasoning-label--warn';
      case 'FAILED': return 'reasoning-label reasoning-label--danger';
      default: return 'reasoning-label';
    }
  }

  /** External verification only available once decision is PASSED (or approved from MANUAL_REVIEW) */
  get canVerifyExternally(): boolean {
    return this.v?.decision === 'PASSED' || this.reviewDecision() === 'approved';
  }

  get extractedFields(): Record<string, string> {
    if (!this.v) return {};
    const fields: Record<string, string> = {};
    if (this.v.id_number && this.v.id_number !== 'NOT_FOUND' && this.v.id_number !== 'N/A') {
      fields['ID Number'] = this.v.id_number;
    }
    if (this.v.name && this.v.name !== 'NOT_FOUND' && this.v.name !== 'N/A') {
      fields['First Name'] = this.v.name;
    }
    if (this.v.surname && this.v.surname !== 'NOT_FOUND' && this.v.surname !== 'N/A') {
      fields['Surname'] = this.v.surname;
    }
    if (this.v.date_of_birth && this.v.date_of_birth !== 'NOT_FOUND' && this.v.date_of_birth !== 'N/A') {
      fields['Date of Birth'] = this.v.date_of_birth;
    }
    if (this.v.gender && this.v.gender !== 'NOT_FOUND' && this.v.gender !== 'N/A') {
      fields['Gender'] = this.v.gender;
    }
    if (this.v.citizenship && this.v.citizenship !== 'NOT_FOUND' && this.v.citizenship !== 'N/A') {
      fields['Citizenship'] = this.v.citizenship;
    }
    return fields;
  }

  get hasExtractedFields(): boolean {
    return Object.keys(this.extractedFields).length > 0;
  }

  get documentTypeLabel(): string {
    return this.v?.document_type?.replace(/_/g, ' ') ?? 'Unknown';
  }

  openDocument(): void {
    const docId = this.v?.document_id;
    if (!docId) return;
    this.previewLoading.set(true);
    this.hrApi.getDocumentPreviewUrl(docId).subscribe({
      next: (res) => {
        window.open(res.url, '_blank');
        this.previewLoading.set(false);
      },
      error: () => this.previewLoading.set(false),
    });
  }

  goBack(): void {
    this.router.navigate(['../../verifications'], { relativeTo: this.route });
  }

  navigateToEmployee(): void {
    if (this.v?.employee_id) {
      this.router.navigate(['../../employees', this.v.employee_id], { relativeTo: this.route });
    }
  }

  approveManualReview(): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to approve this document? This will mark the verification as PASSED.',
      header: 'Approve Document',
      icon: 'pi pi-check-circle',
      acceptLabel: 'Approve',
      rejectLabel: 'Cancel',
      accept: () => this.submitReviewDecision('PASSED'),
    });
  }

  rejectManualReview(): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to reject this document? The employee will need to re-upload.',
      header: 'Reject Document',
      icon: 'pi pi-times-circle',
      acceptLabel: 'Reject',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.submitReviewDecision('FAILED'),
    });
  }

  private submitReviewDecision(decision: 'PASSED' | 'FAILED'): void {
    const docId = this.v?.document_id;
    if (!docId) return;
    this.reviewLoading.set(true);
    this.reviewError.set(null);
    this.hrApi.reviewDocument(docId, decision).subscribe({
      next: (res) => {
        this.reviewDecision.set(decision === 'PASSED' ? 'approved' : 'rejected');
        // Update the local verification object to reflect the new state
        const current = this.verification();
        if (current) {
          this.verification.set({
            ...current,
            decision: decision as any,
          });
        }
        this.reviewLoading.set(false);
      },
      error: (err) => {
        this.reviewError.set(err.error?.error || 'Failed to submit review. Please try again.');
        this.reviewLoading.set(false);
      },
    });
  }

  triggerExternalVerification(): void {
    if (!this.v?.document_id || !this.v?.document_type) return;

    this.confirmationService.confirm({
      message: 'This will send a verification request to an external partner. Proceed?',
      header: 'Confirm External Verification',
      icon: 'pi pi-shield',
      acceptLabel: 'Verify',
      rejectLabel: 'Cancel',
      accept: () => {
        this.hrApi
          .triggerExternalVerification(this.v!.document_id!, this.v!.document_type!)
          .subscribe();
      },
    });
  }
}
