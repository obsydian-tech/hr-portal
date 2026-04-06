import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  inject,
  viewChild,
  ElementRef,
} from '@angular/core';
import { DocumentRow, DocumentStatus } from '../../../../shared/models/employee.model';
import { DocumentUploadService, DocumentUploadResponse } from '../../../../core/services/document-upload.service';
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
export class DocumentRowComponent {
  private readonly uploadService = inject(DocumentUploadService);

  readonly doc = input.required<DocumentRow>();
  readonly employeeId = input.required<string>();
  readonly statusChanged = output<{ type: string; status: DocumentStatus; message?: string }>();

  /** Hidden file input ref */
  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  /** Local state signals for reactive UI */
  readonly currentStatus = signal<DocumentStatus>('PENDING');
  readonly statusMessage = signal<string>('');
  readonly fileName = signal<string>('');

  ngOnInit(): void {
    this.currentStatus.set(this.doc().status);
  }

  triggerUpload(): void {
    this.fileInput()?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.handleUpload(file);
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
  }

  get statusSeverity(): 'success' | 'danger' | 'warn' | 'info' | 'secondary' | 'contrast' | undefined {
    switch (this.currentStatus()) {
      case 'ACCEPTED': return 'success';
      case 'REJECTED': return 'danger';
      case 'SUBMITTED': return 'info';
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
      case 'UPLOADING': return 'UPLOADING...';
      case 'PROCESSING': return 'OCR PROCESSING...';
      default: return 'PENDING';
    }
  }

  get statusIcon(): string | undefined {
    switch (this.currentStatus()) {
      case 'ACCEPTED': return 'pi pi-verified';
      case 'REJECTED': return 'pi pi-times-circle';
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
        this.currentStatus.set('SUBMITTED');
        this.statusMessage.set('Uploaded — verification pending');
        this.statusChanged.emit({ type: doc.type, status: 'SUBMITTED', message: response.message });
      },
      error: (err: HttpErrorResponse) => {
        this.currentStatus.set('REJECTED');
        const message = err.error?.message || err.message || 'Upload failed. Please try again.';
        this.statusMessage.set(message);
        this.statusChanged.emit({ type: doc.type, status: 'REJECTED', message });
      },
    });
  }
}
