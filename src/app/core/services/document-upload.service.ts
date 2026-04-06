import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, switchMap } from 'rxjs';
import { DocumentType } from '../../shared/models/employee.model';
import { environment } from '../../../environments/environment';

/** Response shape from POST /employees/{employee_id}/documents/upload */
export interface DocumentUploadResponse {
  message: string;
  document_id: string;
  employee_id: string;
  s3_key: string;
  ocr_status: string;
}

@Injectable({ providedIn: 'root' })
export class DocumentUploadService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.documentUploadApiUrl;

  /**
   * Upload a document to the backend.
   * Converts the File to base64, then POSTs to the API Gateway endpoint.
   * The backend stores in S3 and writes to DynamoDB with ocr_status: PENDING.
   * S3 event notification triggers OCR asynchronously.
   */
  upload(file: File, documentType: DocumentType, employeeId: string): Observable<DocumentUploadResponse> {
    return this.fileToBase64(file).pipe(
      switchMap((base64Content) => {
        const body = {
          documentType,
          fileName: file.name,
          fileContent: base64Content,
          contentType: file.type || 'application/pdf',
        };

        return this.http.post<DocumentUploadResponse>(
          `${this.apiUrl}/employees/${employeeId}/documents/upload`,
          body
        );
      })
    );
  }

  /**
   * Read a File object and return the raw base64 string (no data URI prefix).
   */
  private fileToBase64(file: File): Observable<string> {
    return new Observable<string>((observer) => {
      const reader = new FileReader();

      reader.onload = () => {
        // result is "data:application/pdf;base64,JVBERi0x..."
        // Strip everything up to and including the comma
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        observer.next(base64);
        observer.complete();
      };

      reader.onerror = () => {
        observer.error(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  }
}
