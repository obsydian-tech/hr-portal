import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, switchMap, map } from 'rxjs';
import { DocumentType } from '../../shared/models/employee.model';
import { environment } from '../../../environments/environment';

/** Response from POST /v1/employees/{employee_id}/documents/upload-url (NH-12, NH-29) */
export interface UploadUrlResponse {
  url: string;
  document_id: string;
  s3_key: string;
  expires_in: number;
}

/**
 * Normalised response returned by DocumentUploadService.upload().
 * Shape matches the old base64 endpoint so callers need no changes.
 */
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
   * Upload a document to S3 via presigned PUT URL (NH-12).
   *
   * Flow:
   *   1. POST /v1/employees/{id}/documents/upload-url  → { url, document_id, s3_key }
   *   2. PUT <presigned url> with raw file bytes       → 200 from S3
   *   3. Return normalised DocumentUploadResponse so callers are unaffected.
   *
   * The DynamoDB record is written as PENDING in step 1 so OCR can trigger
   * from the S3 event notification once the PUT lands.
   */
  upload(file: File, documentType: DocumentType, employeeId: string): Observable<DocumentUploadResponse> {
    return this.getUploadUrl(file, documentType, employeeId).pipe(
      switchMap((urlResponse) => this.putToS3(file, urlResponse).pipe(
        map(() => ({
          message: 'Document uploaded successfully',
          document_id: urlResponse.document_id,
          employee_id: employeeId,
          s3_key: urlResponse.s3_key,
          ocr_status: 'PENDING',
        } satisfies DocumentUploadResponse))
      ))
    );
  }

  /**
   * Request a presigned PUT URL from the backend.
   * POST /v1/employees/{employee_id}/documents/upload-url
   */
  private getUploadUrl(
    file: File,
    documentType: DocumentType,
    employeeId: string,
  ): Observable<UploadUrlResponse> {
    return this.http.post<UploadUrlResponse>(
      `${this.apiUrl}/v1/employees/${employeeId}/documents/upload-url`,
      {
        documentType,
        fileName: file.name,
        contentType: file.type || 'application/pdf',
      },
    );
  }

  /**
   * PUT the raw file bytes directly to S3 using the presigned URL.
   * No Authorization header — S3 presigned URLs are self-authenticating.
   */
  private putToS3(file: File, urlResponse: UploadUrlResponse): Observable<void> {
    const headers = new HttpHeaders({
      'Content-Type': file.type || 'application/pdf',
    });
    return this.http.put<void>(urlResponse.url, file, { headers });
  }
}
