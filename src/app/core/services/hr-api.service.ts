import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, delay, map } from 'rxjs';
import {
  Employee,
  EmployeeListResponse,
  EmployeeDocumentResponse,
  EmployeeDocument,
  Verification,
  VerificationListResponse,
  VerificationDetail,
  CreateEmployeeRequest,
  DocumentType,
} from '../../shared/models/employee.model';
import { environment } from '../../../environments/environment';

/** Raw shape from GET /documents/verification/{document_id} */
interface RawDocumentVerificationResponse {
  document: {
    document_id: string;
    employee_id: string;
    document_type: string;
    file_name: string;
    s3_key: string;
    ocr_status: string;
    ocr_completed_at?: string;
  };
  verification: {
    verification_id: string;
    confidence: number;
    decision: string;
    reasoning: string;
    extracted_data: {
      id_number: string;
      name: string;
      surname: string;
      date_of_birth: string;
      gender: string;
      citizenship: string;
    };
    checks: Record<string, boolean>;
    created_at: string;
  } | null;
  can_reupload: boolean;
}

/** Raw shape from GET /{employee_id}/document/verifications */
interface RawEmployeeDocVerificationsResponse {
  employee: {
    employee_id: string;
    first_name: string;
    last_name: string;
    email: string;
    stage: string;
  };
  documents: Array<{
    document_id: string;
    document_type: string;
    file_name: string;
    ocr_status: string;
    ocr_completed_at?: string;
    verification: {
      verification_id: string;
      confidence: number;
      decision: string;
      reasoning: string;
      id_number: string;
      name: string;
      surname: string;
      date_of_birth: string;
      gender: string;
      citizenship: string;
    } | null;
    can_reupload: boolean;
  }>;
  summary: {
    total_documents: number;
    passed: number;
    manual_review: number;
    failed: number;
  };
}

@Injectable({ providedIn: 'root' })
export class HrApiService {
  private readonly http = inject(HttpClient);
  private readonly docApiUrl = environment.documentUploadApiUrl;
  private readonly empApiUrl = environment.employeesApiUrl;

  // ─── Real API Methods ─────────────────────────────────────

  getEmployees(staffId: string): Observable<EmployeeListResponse> {
    const headers = new HttpHeaders({ 'x-staff-id': staffId });
    return this.http.get<EmployeeListResponse>(
      `${this.empApiUrl}/get/employees`,
      { headers }
    );
  }

  getVerifications(): Observable<VerificationListResponse> {
    return this.http.get<VerificationListResponse>(
      `${this.docApiUrl}/document-verifications`
    );
  }

  getVerificationByDocumentId(documentId: string): Observable<VerificationDetail | null> {
    return this.http
      .get<RawDocumentVerificationResponse>(
        `${this.docApiUrl}/documents/verification/${documentId}`
      )
      .pipe(
        map((raw) => this.mapToVerificationDetail(raw))
      );
  }

  getEmployeeDocuments(employeeId: string): Observable<EmployeeDocumentResponse> {
    return this.http
      .get<RawEmployeeDocVerificationsResponse>(
        `${this.docApiUrl}/${employeeId}/document/verifications`
      )
      .pipe(
        map((raw) => this.mapToEmployeeDocumentResponse(raw))
      );
  }

  // ─── Still-Mocked Methods (no real endpoints yet) ─────────

  createEmployee(staffId: string, data: CreateEmployeeRequest): Observable<Employee> {
    return this.http.post<Employee>(
      `${this.empApiUrl}/employee/create`,
      data,
      { headers: new HttpHeaders({ 'x-staff-id': staffId }) }
    );
  }

  searchEmployeeByEmail(email: string): Observable<boolean> {
    // TODO: Replace with real endpoint when available
    return of(false).pipe(delay(300));
  }

  triggerExternalVerification(
    documentId: string,
    documentType: DocumentType
  ): Observable<{ success: boolean; message: string }> {
    // TODO: Replace with real endpoint when available
    const isValid =
      documentType === 'NATIONAL_ID' || documentType === 'BANK_CONFIRMATION';

    if (!isValid) {
      return of({
        success: false,
        message: 'External verification is only available for National ID and Bank Confirmation documents.',
      });
    }

    return of({
      success: true,
      message: `Verification request submitted for ${documentType === 'NATIONAL_ID' ? 'VerifyNow (Identity)' : 'AVS (Bank Account)'}. Document ID: ${documentId}. Results typically available within 24 hours.`,
    }).pipe(delay(2000));
  }

  // ─── Response Mappers ─────────────────────────────────────

  private mapToVerificationDetail(raw: RawDocumentVerificationResponse): VerificationDetail {
    const doc = raw.document;
    const ver = raw.verification;

    return {
      verification_id: ver?.verification_id ?? '',
      employee_id: doc.employee_id,
      employee_name: '', // Not returned by this endpoint
      document_type: doc.document_type as DocumentType,
      document_id: doc.document_id,
      confidence: ver?.confidence ?? 0,
      decision: (ver?.decision ?? 'PENDING') as 'MANUAL_REVIEW' | 'PASSED' | 'FAILED',
      created_at: ver?.created_at ?? doc.ocr_completed_at ?? '',
      reasoning: ver?.reasoning ?? '',
      id_number: ver?.extracted_data?.id_number ?? 'N/A',
      name: ver?.extracted_data?.name ?? 'N/A',
      surname: ver?.extracted_data?.surname ?? 'N/A',
      date_of_birth: ver?.extracted_data?.date_of_birth ?? 'N/A',
      gender: ver?.extracted_data?.gender ?? 'N/A',
      citizenship: ver?.extracted_data?.citizenship ?? 'N/A',
      document_file_url: doc.s3_key
        ? `https://document-ocr-verification-uploads.s3.af-south-1.amazonaws.com/${doc.s3_key}`
        : undefined,
    };
  }

  private mapToEmployeeDocumentResponse(raw: RawEmployeeDocVerificationsResponse): EmployeeDocumentResponse {
    const documents: EmployeeDocument[] = raw.documents.map((d) => ({
      document_id: d.document_id,
      document_type: d.document_type as DocumentType,
      file_name: d.file_name,
      ocr_status: d.ocr_status as EmployeeDocument['ocr_status'],
      ocr_completed_at: d.ocr_completed_at,
      verification: d.verification
        ? {
            verification_id: d.verification.verification_id,
            employee_id: raw.employee.employee_id,
            employee_name: `${raw.employee.first_name} ${raw.employee.last_name}`,
            document_type: d.document_type as DocumentType,
            document_id: d.document_id,
            confidence: d.verification.confidence,
            decision: d.verification.decision as 'MANUAL_REVIEW' | 'PASSED' | 'FAILED',
            created_at: d.ocr_completed_at ?? '',
            reasoning: d.verification.reasoning,
            id_number: d.verification.id_number,
            name: d.verification.name,
            surname: d.verification.surname,
            date_of_birth: d.verification.date_of_birth,
            gender: d.verification.gender,
            citizenship: d.verification.citizenship,
          }
        : null,
      can_reupload: d.can_reupload,
    }));

    return {
      employee: {
        employee_id: raw.employee.employee_id,
        first_name: raw.employee.first_name,
        last_name: raw.employee.last_name,
        email: raw.employee.email,
        stage: (raw.employee.stage ?? 'INVITED') as Employee['stage'],
        department: (raw.employee as any).department ?? '',
        planned_start_date: (raw.employee as any).planned_start_date ?? '',
      },
      documents,
      summary: {
        total: raw.summary.total_documents,
        verified: raw.summary.passed,
        pending: raw.summary.total_documents - raw.summary.passed - raw.summary.manual_review - raw.summary.failed,
        issues: raw.summary.manual_review + raw.summary.failed,
      },
    };
  }
}
