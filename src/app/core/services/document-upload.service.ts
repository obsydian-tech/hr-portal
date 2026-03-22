import { Injectable } from '@angular/core';
import { Observable, of, delay, map } from 'rxjs';
import { OcrResult, DocumentType } from '../../shared/models/employee.model';

@Injectable({ providedIn: 'root' })
export class DocumentUploadService {
  /**
   * Upload a document file. For documents requiring OCR (NATIONAL_ID, BANK_CONFIRMATION),
   * this calls the OCR extraction API. For other documents (MATRIC_CERTIFICATE,
   * TERTIARY_QUALIFICATION), it only uploads to storage.
   *
   * Returns an Observable that emits the OCR result after a simulated delay.
   * In production, this would POST to the real API endpoint.
   */
  upload(file: File, documentType: DocumentType): Observable<OcrResult> {
    const requiresOcr =
      documentType === 'NATIONAL_ID' || documentType === 'BANK_CONFIRMATION';

    if (!requiresOcr) {
      // Storage-only upload — no OCR, always succeeds
      return of<OcrResult>({
        success: true,
        documentTypeDetected: documentType,
        message: 'Document uploaded successfully. Pending HR manual verification.',
      }).pipe(delay(1500));
    }

    // Simulate OCR API call with a realistic 3-second delay
    return of(file).pipe(
      delay(3000),
      map(() => this.simulateOcrResult(file, documentType))
    );
  }

  private simulateOcrResult(file: File, documentType: DocumentType): OcrResult {
    // For the prototype, simulate different outcomes based on file name patterns
    const name = file.name.toLowerCase();

    // Simulate "wrong document" if file name contains "wrong"
    if (name.includes('wrong')) {
      const expectedLabel =
        documentType === 'NATIONAL_ID' ? 'National ID' : 'Bank Account Confirmation Letter';
      return {
        success: false,
        documentTypeDetected: 'UNKNOWN',
        message: `This doesn't appear to be a ${expectedLabel}. Please upload the correct document.`,
      };
    }

    // Simulate "poor quality" if file name contains "blur" or "bad"
    if (name.includes('blur') || name.includes('bad')) {
      return {
        success: false,
        documentTypeDetected: documentType,
        message: 'The document is unreadable. Please upload a clearer scan or photo.',
      };
    }

    // Success case
    if (documentType === 'NATIONAL_ID') {
      return {
        success: true,
        documentTypeDetected: 'NATIONAL_ID',
        message: 'National ID detected',
        extractedSummary: 'ID Number: ****1234',
      };
    }

    return {
      success: true,
      documentTypeDetected: 'BANK_CONFIRMATION',
      message: 'Bank confirmation detected',
      extractedSummary: 'Account: ****5678 — FNB',
    };
  }
}
