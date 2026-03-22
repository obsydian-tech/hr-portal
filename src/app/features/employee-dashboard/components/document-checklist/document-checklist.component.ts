import { Component, ChangeDetectionStrategy, signal, computed, output } from '@angular/core';
import { DocumentRow, DocumentStatus } from '../../../../shared/models/employee.model';
import { DocumentRowComponent } from '../document-row/document-row.component';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-document-checklist',
  standalone: true,
  imports: [DocumentRowComponent, CardModule, TagModule, DividerModule, MessageModule],
  templateUrl: './document-checklist.component.html',
  styleUrl: './document-checklist.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentChecklistComponent {
  readonly allComplete = output<boolean>();

  readonly documents = signal<DocumentRow[]>([
    {
      type: 'NATIONAL_ID',
      label: 'National ID',
      description: 'South African ID document. OCR-enabled for instant validation.',
      icon: 'pi-id-card',
      status: 'PENDING',
      requiresOcr: true,
    },
    {
      type: 'BANK_CONFIRMATION',
      label: 'Bank Account Confirmation Letter',
      description: 'Bank-issued letter confirming account details. OCR-enabled for instant validation.',
      icon: 'pi-building',
      status: 'PENDING',
      requiresOcr: true,
    },
    {
      type: 'MATRIC_CERTIFICATE',
      label: 'Matric Certificate',
      description: 'Manual verification by HR. No automated OCR.',
      icon: 'pi-graduation-cap',
      status: 'PENDING',
      requiresOcr: false,
    },
    {
      type: 'TERTIARY_QUALIFICATION',
      label: 'Tertiary Qualification(s)',
      description: 'Manual verification by HR. Multiple uploads allowed.',
      icon: 'pi-book',
      status: 'PENDING',
      requiresOcr: false,
    },
  ]);

  readonly completedCount = computed(() => {
    return this.documents().filter(
      (d) => d.status === 'ACCEPTED' || d.status === 'SUBMITTED'
    ).length;
  });

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
