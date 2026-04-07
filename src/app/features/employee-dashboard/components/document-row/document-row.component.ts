import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  inject,
  viewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { DocumentRow, DocumentStatus, DocumentType, ExtractedFields } from '../../../../shared/models/employee.model';
import { DocumentUploadService, DocumentUploadResponse } from '../../../../core/services/document-upload.service';
import { HrApiService } from '../../../../core/services/hr-api.service';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-document-row',
  standalone: true,
  imports: [ButtonModule, TagModule, ProgressSpinnerModule],
  templateUrl: './document-row.component.html',
  styleUrl: './document-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentRowComponent implements OnDestroy {
  private readonly uploadService = inject(DocumentUploadService);
  private readonly hrApi = inject(HrApiService);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly doc = input.required<DocumentRow>();
  readonly employeeId = input.required<string>();
  readonly statusChanged = output<{ type: string; status: DocumentStatus; message?: string }>();

  /** Hidden file input ref */
  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Local state signals for reactive UI */
  readonly currentStatus = signal<DocumentStatus>('PENDING');
  readonly statusMessage = signal<string>('');
  readonly fileName = signal<string>('');
  readonly extractedFields = signal<ExtractedFields | undefined>(undefined);

  ngOnInit(): void {
    this.currentStatus.set(this.doc().status);
    this.extractedFields.set(this.doc().extractedFields);
    // Set initial friendly message from ocrMessage if present
    if (this.doc().ocrMessage) {
      this.statusMessage.set(this.doc().ocrMessage!);
    }
  }

  triggerUpload(): void {
    this.fileInput()?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.handleUpload(file);
    // Reset value so re-selecting the same file fires change again
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    this.handleUpload(file);
  }

  reUpload(): void {
    this.currentStatus.set('PENDING');
    this.statusMessage.set('');
    this.fileName.set('');
    // Reset file input so the same file can be re-selected
    const el = this.fileInput()?.nativeElement;
    if (el) el.value = '';
    // Immediately open the file picker
    setTimeout(() => this.triggerUpload());
  }

  viewDocument(): void {
    const docId = this.doc().documentId;
    if (!docId) return;
    this.hrApi.getDocumentPreviewUrl(docId).subscribe({
      next: (res) => window.open(res.url, '_blank'),
      error: () => this.statusMessage.set('Could not load document preview.'),
    });
  }

  get statusSeverity(): 'success' | 'danger' | 'warn' | 'info' | 'secondary' | 'contrast' | undefined {
    switch (this.currentStatus()) {
      case 'ACCEPTED': return 'success';
      case 'REJECTED': return 'danger';
      case 'SUBMITTED': return 'info';
      case 'IN_REVIEW': return 'warn';
      case 'UPLOADING':
      case 'PROCESSING': return 'warn';
      default: return 'secondary';
    }
  }

  get statusLabel(): string {
    switch (this.currentStatus()) {
      case 'ACCEPTED': return 'ACCEPTED';
      case 'REJECTED': return 'REJECTED';
      case 'SUBMITTED': return 'VERIFICATION PENDING';
      case 'IN_REVIEW': return 'UNDER HR REVIEW';
      case 'UPLOADING': return 'UPLOADING...';
      case 'PROCESSING': return 'OCR PROCESSING...';
      default: return 'PENDING';
    }
  }

  get statusIcon(): string | undefined {
    switch (this.currentStatus()) {
      case 'ACCEPTED': return 'pi pi-verified';
      case 'REJECTED': return 'pi pi-times-circle';
      case 'IN_REVIEW': return 'pi pi-clock';
      default: return undefined;
    }
  }

  private handleUpload(file: File): void {
    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      this.currentStatus.set('REJECTED');
      this.statusMessage.set('Unsupported file type. Please upload PDF, JPG, or PNG.');
      return;
    }

    // Validate file size (5MB max — base64 adds ~33% overhead, API Gateway limit is 10MB)
    if (file.size > 5 * 1024 * 1024) {
      this.currentStatus.set('REJECTED');
      this.statusMessage.set('File exceeds 5MB maximum size. Please compress and retry.');
      return;
    }

    this.fileName.set(file.name);
    this.currentStatus.set('UPLOADING');

    const doc = this.doc();

    this.uploadService.upload(file, doc.type, this.employeeId()).subscribe({
      next: (response: DocumentUploadResponse) => {
        // Show PROCESSING while OCR runs
        if (doc.requiresOcr) {
          this.currentStatus.set('PROCESSING');
          this.statusMessage.set('Document uploaded — running OCR verification...');
          // Poll for OCR result after a delay
          this.pollOcrResult(this.employeeId(), doc.type);
        } else {
          this.currentStatus.set('SUBMITTED');
          this.statusMessage.set('Uploaded — awaiting HR review');
          this.statusChanged.emit({ type: doc.type, status: 'SUBMITTED', message: response.message });
        }
      },
      error: (err: HttpErrorResponse) => {
        this.currentStatus.set('REJECTED');
        const message = err.error?.message || err.message || 'Upload failed. Please try again.';
        this.statusMessage.set(message);
        this.statusChanged.emit({ type: doc.type, status: 'REJECTED', message });
      },
    });
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  /** Poll backend for OCR result after upload — retries up to 5 times at 3s intervals */
  private pollOcrResult(employeeId: string, docType: DocumentType, attempt = 1): void {
    const maxAttempts = 5;
    const delayMs = 3000;

    this.pollTimer = setTimeout(() => {
      this.hrApi.getEmployeeDocuments(employeeId).subscribe({
        next: (res) => {
          const match = res.documents.find((d) => d.document_type === docType);
          if (!match) return;

          const ocrStatus = match.ocr_status;
          if (ocrStatus === 'PENDING' || ocrStatus === 'PROCESSING') {
            // Still processing — retry if we have attempts left
            if (attempt < maxAttempts) {
              this.pollOcrResult(employeeId, docType, attempt + 1);
            } else {
              // Give up polling — show SUBMITTED so user knows upload worked
              this.currentStatus.set('SUBMITTED');
              this.statusMessage.set('Uploaded — OCR verification in progress');
              this.statusChanged.emit({ type: docType, status: 'SUBMITTED' });
            }
            return;
          }

          // OCR finished — map to frontend status with employee-friendly messages
          let finalStatus: DocumentStatus;
          let message: string;
          let ef: ExtractedFields | undefined;

          if (match.verification) {
            ef = {
              id_number: match.verification.id_number,
              name: match.verification.name,
              surname: match.verification.surname,
              date_of_birth: match.verification.date_of_birth,
              gender: match.verification.gender,
              citizenship: match.verification.citizenship,
            };
          }

          switch (ocrStatus) {
            case 'PASSED':
              finalStatus = 'ACCEPTED';
              message = 'Document verified successfully';
              break;
            case 'MANUAL_REVIEW':
              finalStatus = 'IN_REVIEW';
              message = 'Your document has been sent for manual review by the HR team';
              break;
            case 'FAILED':
              finalStatus = 'REJECTED';
              message = 'Your document has been sent for manual review by the HR team';
              break;
            default:
              finalStatus = 'SUBMITTED';
              message = 'Upload complete';
          }

          this.currentStatus.set(finalStatus);
          this.statusMessage.set(message);
          this.extractedFields.set(ef);
          this.statusChanged.emit({ type: docType, status: finalStatus, message });
        },
        error: () => {
          // Network error — show submitted, don't block user
          this.currentStatus.set('SUBMITTED');
          this.statusMessage.set('Uploaded — verification pending');
          this.statusChanged.emit({ type: docType, status: 'SUBMITTED' });
        },
      });
    }, delayMs);
  }
}
