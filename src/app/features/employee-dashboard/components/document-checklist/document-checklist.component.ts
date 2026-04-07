import { Component, ChangeDetectionStrategy, signal, computed, output, input, inject, effect } from '@angular/core';
import { DocumentRow, DocumentStatus, DocumentType, ExtractedFields } from '../../../../shared/models/employee.model';
import { DocumentRowComponent } from '../document-row/document-row.component';
import { HrApiService } from '../../../../core/services/hr-api.service';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

/** Map of document type → display metadata */
const DOC_META: Record<string, { label: string; description: string; icon: string; requiresOcr: boolean }> = {
  NATIONAL_ID: { label: 'National ID', description: 'South African ID document. OCR-enabled for instant validation.', icon: 'pi-id-card', requiresOcr: true },
  BANK_CONFIRMATION: { label: 'Bank Account Confirmation Letter', description: 'Bank-issued letter confirming account details. OCR-enabled for instant validation.', icon: 'pi-building', requiresOcr: true },
  MATRIC_CERTIFICATE: { label: 'Matric Certificate', description: 'Manual verification by HR. No automated OCR.', icon: 'pi-graduation-cap', requiresOcr: false },
  TERTIARY_QUALIFICATION: { label: 'Tertiary Qualification(s)', description: 'Manual verification by HR. Multiple uploads allowed.', icon: 'pi-book', requiresOcr: false },
};

/** Map backend ocr_status → frontend DocumentStatus */
function mapOcrStatus(ocr: string): DocumentStatus {
  switch (ocr) {
    case 'PASSED': return 'ACCEPTED';
    case 'MANUAL_REVIEW': return 'IN_REVIEW';
    case 'FAILED': return 'REJECTED';
    case 'PROCESSING': return 'PROCESSING';
    case 'PENDING':
    default: return 'PENDING';
  }
}

@Component({
  selector: 'app-document-checklist',
  standalone: true,
  imports: [DocumentRowComponent, CardModule, TagModule, DividerModule, MessageModule, ProgressSpinnerModule],
  templateUrl: './document-checklist.component.html',
  styleUrl: './document-checklist.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentChecklistComponent {
  private readonly hrApi = inject(HrApiService);

  readonly employeeId = input.required<string>();
  readonly allComplete = output<boolean>();
  readonly loading = signal(true);

  readonly documents = signal<DocumentRow[]>([]);

  readonly completedCount = computed(() => {
    return this.documents().filter(
      (d) => d.status === 'ACCEPTED' || d.status === 'SUBMITTED'
    ).length;
  });

  constructor() {
    // React to employeeId input changes — re-fetch documents when it changes
    effect(() => {
      const id = this.employeeId();
      if (!id) return;
      this.fetchDocuments(id);
    });
  }

  private fetchDocuments(employeeId: string): void {
    this.loading.set(true);
    this.hrApi.getEmployeeDocuments(employeeId).subscribe({
      next: (res) => {
        // Group by document_type — take the latest document per type
        const byType = new Map<string, { status: DocumentStatus; message?: string; fileName?: string; documentId?: string; extractedFields?: ExtractedFields }>();
        for (const doc of res.documents) {
          const mapped = mapOcrStatus(doc.ocr_status);
          const existing = byType.get(doc.document_type);
          // Keep the most relevant status: any non-PENDING wins, otherwise latest
          if (!existing || mapped !== 'PENDING') {
            // Build employee-friendly message instead of raw reasoning
            let friendlyMessage: string | undefined;
            if (mapped === 'ACCEPTED') {
              friendlyMessage = 'Document verified successfully';
            } else if (mapped === 'IN_REVIEW' || mapped === 'REJECTED') {
              friendlyMessage = 'Your document has been sent for manual review by the HR team';
            }

            // Extract structured fields from verification data
            const ef: ExtractedFields | undefined = doc.verification ? {
              id_number: doc.verification.id_number,
              name: doc.verification.name,
              surname: doc.verification.surname,
              date_of_birth: doc.verification.date_of_birth,
              gender: doc.verification.gender,
              citizenship: doc.verification.citizenship,
            } : undefined;

            byType.set(doc.document_type, {
              status: mapped,
              message: friendlyMessage,
              fileName: doc.file_name,
              documentId: doc.document_id,
              extractedFields: ef,
            });
          }
        }

        // Build rows — always show all 4 expected doc types
        const docTypes: DocumentType[] = ['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION'];
        const rows: DocumentRow[] = docTypes.map((type) => {
          const meta = DOC_META[type];
          const backend = byType.get(type);
          return {
            type,
            label: meta.label,
            description: meta.description,
            icon: meta.icon,
            requiresOcr: meta.requiresOcr,
            status: backend?.status ?? 'PENDING',
            ocrMessage: backend?.message,
            fileName: backend?.fileName,
            documentId: backend?.documentId,
            extractedFields: backend?.extractedFields,
          };
        });

        this.documents.set(rows);
        this.loading.set(false);

        // Check initial completion
        const allDone = rows.every((d) => d.status === 'ACCEPTED' || d.status === 'SUBMITTED');
        if (allDone) {
          this.allComplete.emit(true);
        }
      },
      error: () => {
        // Fallback: show all PENDING if API fails
        const docTypes: DocumentType[] = ['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION'];
        this.documents.set(
          docTypes.map((type) => ({
            type,
            ...DOC_META[type],
            status: 'PENDING' as DocumentStatus,
          }))
        );
        this.loading.set(false);
      },
    });
  }

  onStatusChanged(event: { type: string; status: DocumentStatus; message?: string }): void {
    const updated = this.documents().map((d) =>
      d.type === event.type ? { ...d, status: event.status, ocrMessage: event.message } : d
    );
    this.documents.set(updated);

    // Check if all documents are complete
    const allDone = updated.every(
      (d) => d.status === 'ACCEPTED' || d.status === 'SUBMITTED'
    );
    if (allDone) {
      this.allComplete.emit(true);
    }
  }
}
