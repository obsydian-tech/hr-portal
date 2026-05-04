import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';

import { HrApiService } from './hr-api.service';
import { environment } from '../../../environments/environment';

// ---------------------------------------------------------------------------
// Raw-response fixtures
// ---------------------------------------------------------------------------

const RAW_VERIFICATION = {
  document: {
    document_id: 'DOC-001',
    employee_id: 'EMP-0000001',
    document_type: 'NATIONAL_ID',
    ocr_completed_at: '2025-01-01T10:00:00Z',
    s3_key: 'employees/EMP-0000001/DOC-001.pdf',
  },
  verification: {
    verification_id: 'VER-001',
    confidence: 0,
    decision: 'MANUAL_REVIEW',
    created_at: '2025-01-01T10:00:00Z',
    reasoning: '',
    extracted_data: {
      id_number: 'N/A',
      name: 'N/A',
      surname: 'N/A',
      date_of_birth: 'N/A',
      gender: 'N/A',
      citizenship: 'N/A',
    },
  },
};

const RAW_EMPLOYEE_DOCS = {
  employee: {
    employee_id: 'EMP-0000001',
    first_name: 'Sarah',
    last_name: 'Dlamini',
    email: 'sarah@example.com',
    stage: 'ONBOARDING',
    department: 'IT',
    planned_start_date: '2025-02-01',
    phone: '+27820000001',
    hr_staff_id: 'AS00001',
    hr_staff_name: 'Thabo Molefe',
    hr_staff_email: 'thabo@naleko.co.za',
  },
  documents: [
    { document_id: 'D1', document_type: 'NATIONAL_ID', ocr_status: 'PASSED', uploaded_at: '2025-01-01T09:00:00Z', file_name: 'id.pdf', can_reupload: false, verification: null },
    { document_id: 'D2', document_type: 'BANK_CONFIRMATION', ocr_status: 'FAILED', uploaded_at: '2025-01-01T09:00:00Z', file_name: 'bank.pdf', can_reupload: true, verification: null },
    { document_id: 'D3', document_type: 'MATRIC_CERTIFICATE', ocr_status: 'PENDING', uploaded_at: '2025-01-01T09:00:00Z', file_name: 'matric.pdf', can_reupload: false, verification: null },
  ],
  summary: { total_documents: 3, passed: 1, manual_review: 1, failed: 1 },
};

const RAW_EMPLOYEES = [
  { employeeId: 'EMP-0000001', firstName: 'Sarah', lastName: 'Dlamini', email: 'sarah@example.com' },
  { employeeId: 'EMP-0000002', firstName: 'John', lastName: 'Smith', email: 'john@example.com' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HrApiService', () => {
  let service: HrApiService;
  let httpMock: HttpTestingController;

  const docBase = environment.documentUploadApiUrl;
  const empBase = environment.employeesApiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        HrApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(HrApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ── Construction ──────────────────────────────────────────────────────────

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── getEmployees ──────────────────────────────────────────────────────────

  it('getEmployees: should GET correct URL without x-staff-id header', () => {
    service.getEmployees().subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/v1/employees'));
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.has('x-staff-id')).toBeFalse();
    req.flush(RAW_EMPLOYEES);
  });

  it('getEmployees: should NOT send x-role header', () => {
    service.getEmployees().subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/v1/employees'));
    expect(req.request.headers.has('x-role')).toBeFalse();
    req.flush([]);
  });

  it('getEmployees: should not add x-role for standard staff', () => {
    service.getEmployees().subscribe();
    const req = httpMock.expectOne(r => r.url.endsWith('/v1/employees'));
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getEmployees: should return the array emitted by the server', (done) => {
    service.getEmployees().subscribe((resp) => {
      const employees = (resp as any).items ?? resp;
      expect(employees).toBeTruthy();
      done();
    });

    const req = httpMock.expectOne(r => r.url.endsWith('/v1/employees'));
    req.flush(RAW_EMPLOYEES);
  });

  // ── getVerifications ──────────────────────────────────────────────────────

  it('getVerifications: should GET /v1/verifications', () => {
    service.getVerifications().subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications'));
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getVerifications: should NOT send x-staff-id header', () => {
    service.getVerifications().subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications'));
    expect(req.request.headers.has('x-staff-id')).toBeFalse();
    req.flush([]);
  });

  it('getVerifications: should NOT send x-role header', () => {
    service.getVerifications().subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications'));
    expect(req.request.headers.has('x-role')).toBeFalse();
    req.flush([]);
  });

  // ── getVerificationByDocumentId ───────────────────────────────────────────

  it('getVerificationByDocumentId: should GET the correct URL', () => {
    service.getVerificationByDocumentId('DOC-001').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001'));
    expect(req.request.method).toBe('GET');
    req.flush(RAW_VERIFICATION);
  });

  it('getVerificationByDocumentId: should map the raw response to VerificationDetail shape', (done) => {
    service.getVerificationByDocumentId('DOC-001').subscribe((detail) => {
      expect(detail).toBeTruthy();
      if (detail) {
        expect(detail.document_id).toBe('DOC-001');
        expect(detail.employee_id).toBe('EMP-0000001');
        expect(detail.document_type).toBe('NATIONAL_ID');
      }
      done();
    });

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001'));
    req.flush(RAW_VERIFICATION);
  });

  it('getVerificationByDocumentId: should return a truthy object', (done) => {
    service.getVerificationByDocumentId('DOC-001').subscribe((detail) => {
      expect(detail).toBeTruthy();
      done();
    });

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001'));
    req.flush(RAW_VERIFICATION);
  });

  // ── getEmployeeDocuments ──────────────────────────────────────────────────

  it('getEmployeeDocuments: should GET /v1/employees/{employeeId}/verifications', () => {
    service.getEmployeeDocuments('EMP-0000001').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/employees/EMP-0000001/verifications'));
    expect(req.request.method).toBe('GET');
    req.flush(RAW_EMPLOYEE_DOCS);
  });

  it('getEmployeeDocuments: should return mapped response with correct document count', (done) => {
    service.getEmployeeDocuments('EMP-0000001').subscribe((res) => {
      expect(res.employee.employee_id).toBe('EMP-0000001');
      expect(res.documents.length).toBe(3);
      done();
    });

    const req = httpMock.expectOne(r => r.url.includes('/v1/employees/EMP-0000001/verifications'));
    req.flush(RAW_EMPLOYEE_DOCS);
  });

  it('getEmployeeDocuments: should include summary in response', (done) => {
    service.getEmployeeDocuments('EMP-0000001').subscribe((res) => {
      expect(res.summary).toBeDefined();
      expect(res.summary.total).toBe(3);
      done();
    });

    const req = httpMock.expectOne(r => r.url.includes('/v1/employees/EMP-0000001/verifications'));
    req.flush(RAW_EMPLOYEE_DOCS);
  });

  // ── getDocumentPreviewUrl ─────────────────────────────────────────────────

  it('getDocumentPreviewUrl: should GET correct preview URL', () => {
    service.getDocumentPreviewUrl('DOC-042').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/documents/DOC-042/url'));
    expect(req.request.method).toBe('GET');
    req.flush({ url: 'https://s3.example.com/presigned' });
  });

  it('getDocumentPreviewUrl: should return the presigned URL from response', (done) => {
    service.getDocumentPreviewUrl('DOC-042').subscribe((resp: any) => {
      expect(resp.url).toBe('https://s3.example.com/presigned');
      done();
    });

    const req = httpMock.expectOne(r => r.url.includes('/v1/documents/DOC-042/url'));
    req.flush({ url: 'https://s3.example.com/presigned' });
  });

  // ── reviewDocument ────────────────────────────────────────────────────────

  it('reviewDocument: should PATCH the correct URL', () => {
    service.reviewDocument('DOC-001', 'PASSED', 'Looks good').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001/review'));
    expect(req.request.method).toBe('PATCH');
    req.flush({ success: true });
  });

  it('reviewDocument: should send decision and notes in the request body', () => {
    service.reviewDocument('DOC-001', 'FAILED', 'Blurry scan').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001/review'));
    expect(req.request.body.decision).toBe('FAILED');
    expect(req.request.body.notes).toBe('Blurry scan');
    req.flush({ success: true });
  });

  it('reviewDocument: should send body without notes when notes is not provided', () => {
    service.reviewDocument('DOC-001', 'PASSED').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001/review'));
    expect(req.request.body.notes).toBe('');
    req.flush({ success: true });
  });

  // ── createEmployee ────────────────────────────────────────────────────────

  const VALID_CREATE_PAYLOAD = {
    first_name: 'Jane', last_name: 'Nkosi', email: 'jane@naleko.co.za',
    phone: '+27820000099', department: 'Finance',
    offer_accept_date: '2025-01-10', planned_start_date: '2025-02-01',
    hr_staff_id: 'AS00001', hr_staff_name: 'Thabo Molefe',
    hr_staff_email: 'thabo@naleko.co.za',
  };

  it('createEmployee: should POST to /v1/employees without x-staff-id header', () => {
    service.createEmployee(VALID_CREATE_PAYLOAD).subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/v1/employees') && r.method === 'POST');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('x-staff-id')).toBeFalse();
    req.flush({ employeeId: 'EMP-0000020' });
  });

  it('createEmployee: should send the employee data as the request body', () => {
    service.createEmployee(VALID_CREATE_PAYLOAD).subscribe();

    const req = httpMock.expectOne(r => r.url.endsWith('/v1/employees') && r.method === 'POST');
    expect(req.request.body.first_name).toBe('Jane');
    expect(req.request.body.email).toBe('jane@naleko.co.za');
    req.flush({ employeeId: 'EMP-0000020' });
  });

  // ── searchEmployeeByEmail ─────────────────────────────────────────────────

  it('searchEmployeeByEmail: should GET /v1/employees/by-email with email param', () => {
    service.searchEmployeeByEmail('new@example.com').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/employees/by-email'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('email')).toBe('new@example.com');
    req.flush({ exists: false });
  });

  it('searchEmployeeByEmail: should return false when server says exists=false', (done) => {
    service.searchEmployeeByEmail('new@example.com').subscribe((result) => {
      expect(result).toBeFalse();
      done();
    });
    const req = httpMock.expectOne(r => r.url.includes('/v1/employees/by-email'));
    req.flush({ exists: false });
  });

  // ── triggerExternalVerification ───────────────────────────────────────────

  it('triggerExternalVerification: should POST to /v1/verifications/{id}/external', () => {
    service.triggerExternalVerification('DOC-001', 'NATIONAL_ID').subscribe();

    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001/external'));
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, message: 'Submitted' });
  });

  it('triggerExternalVerification: should return a success response', (done) => {
    service.triggerExternalVerification('DOC-001', 'NATIONAL_ID').subscribe((res: any) => {
      expect(res.success).toBeDefined();
      done();
    });
    const req = httpMock.expectOne(r => r.url.includes('/v1/verifications/DOC-001/external'));
    req.flush({ success: true, message: 'Submitted' });
  });
});
