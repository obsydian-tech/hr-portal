import { Injectable } from '@angular/core';
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
  OnboardingStage,
  DocumentType,
} from '../../shared/models/employee.model';

@Injectable({ providedIn: 'root' })
export class HrApiService {
  // ─── Mock Data ────────────────────────────────────────────

  private readonly mockEmployees: Employee[] = [
    {
      employee_id: 'EMP-0000011',
      first_name: 'Sarah',
      middle_name: '',
      last_name: 'Nkosi',
      email: 'sarah.nkosi@example.com',
      phone: '+27821234567',
      department: 'Engineering',
      stage: 'VERIFICATION_PENDING',
      offer_accept_date: '2026-03-10',
      planned_start_date: '2026-04-01',
      created_at: '2026-03-10T08:00:00.000Z',
      created_by: 'AS00001',
    },
    {
      employee_id: 'EMP-0000012',
      first_name: 'Thabo',
      middle_name: 'James',
      last_name: 'Mokoena',
      email: 'thabo.mokoena@example.com',
      phone: '+27829876543',
      department: 'Finance',
      stage: 'DOCUMENTS',
      offer_accept_date: '2026-03-12',
      planned_start_date: '2026-04-15',
      created_at: '2026-03-12T09:30:00.000Z',
      created_by: 'AS00001',
    },
    {
      employee_id: 'EMP-0000013',
      first_name: 'Lerato',
      middle_name: '',
      last_name: 'Dlamini',
      email: 'lerato.dlamini@example.com',
      phone: '+27831112233',
      department: 'Marketing',
      stage: 'VERIFIED',
      offer_accept_date: '2026-02-28',
      planned_start_date: '2026-03-25',
      created_at: '2026-02-28T10:00:00.000Z',
      created_by: 'AS00001',
    },
    {
      employee_id: 'EMP-0000014',
      first_name: 'Sipho',
      middle_name: '',
      last_name: 'Mthembu',
      email: 'sipho.mthembu@example.com',
      phone: '+27834445566',
      department: 'HR',
      stage: 'TRAINING',
      offer_accept_date: '2026-02-20',
      planned_start_date: '2026-03-20',
      created_at: '2026-02-20T11:00:00.000Z',
      created_by: 'AS00001',
    },
    {
      employee_id: 'EMP-0000015',
      first_name: 'John',
      middle_name: 'David',
      last_name: 'Smith',
      email: 'john.smith@example.com',
      phone: '+27821234568',
      department: 'Finance',
      stage: 'DOCUMENTS',
      offer_accept_date: '2026-03-15',
      planned_start_date: '2026-04-15',
      created_at: '2026-03-21T11:56:03.116Z',
      created_by: 'AS00001',
    },
    {
      employee_id: 'EMP-0000016',
      first_name: 'Nomsa',
      middle_name: '',
      last_name: 'Khumalo',
      email: 'nomsa.khumalo@example.com',
      phone: '+27837778899',
      department: 'Legal',
      stage: 'ONBOARDED',
      offer_accept_date: '2026-01-15',
      planned_start_date: '2026-02-15',
      created_at: '2026-01-15T08:30:00.000Z',
      created_by: 'AS00001',
    },
    {
      employee_id: 'EMP-0000017',
      first_name: 'Andile',
      middle_name: '',
      last_name: 'Zulu',
      email: 'andile.zulu@example.com',
      phone: '+27839990011',
      department: 'Operations',
      stage: 'INVITED',
      offer_accept_date: '2026-03-20',
      planned_start_date: '2026-04-20',
      created_at: '2026-03-20T14:00:00.000Z',
      created_by: 'AS00001',
    },
    {
      employee_id: 'EMP-0000018',
      first_name: 'Palesa',
      middle_name: '',
      last_name: 'Mahlangu',
      email: 'palesa.mahlangu@example.com',
      phone: '+27832223344',
      department: 'Engineering',
      stage: 'VERIFICATION_PENDING',
      offer_accept_date: '2026-03-08',
      planned_start_date: '2026-04-08',
      created_at: '2026-03-08T12:00:00.000Z',
      created_by: 'AS00001',
    },
  ];

  private readonly mockVerifications: Verification[] = [
    {
      verification_id: 'ver_1774013221576',
      employee_name: 'Unknown',
      confidence: 0,
      decision: 'MANUAL_REVIEW',
      created_at: '2026-03-20T13:27:01.576Z',
    },
    {
      verification_id: 'ver_1774085249990',
      employee_name: 'Unknown',
      confidence: 0,
      decision: 'MANUAL_REVIEW',
      created_at: '2026-03-21T09:27:29.990Z',
    },
    {
      verification_id: 'ver_1774091968566',
      employee_id: 'EMP-0000011',
      employee_name: 'Sarah Nkosi',
      document_type: 'NATIONAL_ID',
      document_id: 'doc_1774091957246',
      confidence: 0,
      decision: 'MANUAL_REVIEW',
      created_at: '2026-03-21T11:19:28.566Z',
    },
    {
      verification_id: 'ver_1774085454231',
      employee_name: 'Unknown',
      confidence: 0,
      decision: 'MANUAL_REVIEW',
      created_at: '2026-03-21T09:30:54.231Z',
    },
    {
      verification_id: 'ver_1774088048209',
      employee_id: 'EMP-0000011',
      employee_name: 'Sarah Nkosi',
      document_type: 'NATIONAL_ID',
      document_id: 'doc_1774088035608',
      confidence: 0,
      decision: 'MANUAL_REVIEW',
      created_at: '2026-03-21T10:14:08.209Z',
    },
    {
      verification_id: 'ver_1774086532748',
      employee_name: 'Unknown',
      confidence: 0,
      decision: 'MANUAL_REVIEW',
      created_at: '2026-03-21T09:48:52.748Z',
    },
  ];

  private nextId = 19;

  // ─── API Methods ──────────────────────────────────────────

  getEmployees(staffId: string): Observable<EmployeeListResponse> {
    return of<EmployeeListResponse>({
      items: this.mockEmployees,
      count: this.mockEmployees.length,
      staff_id: staffId,
      filters_applied: { created_by: staffId, stage: 'none', department: 'none' },
    }).pipe(delay(600));
  }

  getVerifications(_staffId: string): Observable<VerificationListResponse> {
    return of<VerificationListResponse>({
      items: this.mockVerifications,
    }).pipe(delay(800));
  }

  getVerificationById(verificationId: string): Observable<VerificationDetail | null> {
    // Look up from the verification list
    const ver = this.mockVerifications.find((v) => v.verification_id === verificationId);
    if (!ver) {
      return of(null).pipe(delay(300));
    }

    // Build a detailed mock response with OCR fields + document file URL
    const detail: VerificationDetail = {
      ...ver,
      reasoning: this.getReasoningForVerification(ver),
      id_number: ver.employee_name === 'Unknown' ? 'NOT_FOUND' : '950101****08*',
      name: ver.employee_name === 'Unknown' ? 'NOT_FOUND' : ver.employee_name.split(' ')[0],
      surname: ver.employee_name === 'Unknown' ? 'NOT_FOUND' : ver.employee_name.split(' ').slice(1).join(' '),
      date_of_birth: ver.employee_name === 'Unknown' ? 'NOT_FOUND' : '1995-01-01',
      gender: ver.employee_name === 'Unknown' ? 'NOT_FOUND' : 'Female',
      citizenship: ver.employee_name === 'Unknown' ? 'NOT_FOUND' : 'South African',
      document_file_url: ver.document_id
        ? `https://storage.example.com/documents/${ver.document_id}.pdf`
        : undefined,
    };

    return of(detail).pipe(delay(600));
  }

  private getReasoningForVerification(ver: Verification): string {
    if (ver.verification_id === 'ver_1774091968566') {
      return 'This is a body corporate levy statement, not a South African ID document. No 13-digit SA ID number present. Only names provided are \'IT Mushanguri & RR Nduna\' associated with Unit 59, which appear to be unit owners rather than document holders.';
    }
    if (ver.verification_id === 'ver_1774088048209') {
      return 'Document appears to be a rental agreement instead of a National ID. No government-issued identification markers detected. Manual review required.';
    }
    if (ver.employee_name === 'Unknown') {
      return 'Unable to associate this document with a registered employee. The uploaded document could not be classified. Manual review is required to determine the document type and verify its contents.';
    }
    return 'Document analysis complete. Review the extracted fields below for accuracy.';
  }

  getEmployeeDocuments(employeeId: string): Observable<EmployeeDocumentResponse> {
    const emp = this.mockEmployees.find((e) => e.employee_id === employeeId);

    const docSets = this.buildMockDocuments(employeeId);

    return of<EmployeeDocumentResponse>({
      employee: {
        employee_id: emp?.employee_id ?? employeeId,
        first_name: emp?.first_name ?? 'Unknown',
        last_name: emp?.last_name ?? 'Employee',
        email: emp?.email ?? '',
        stage: emp?.stage ?? 'INVITED',
        department: emp?.department ?? '',
        planned_start_date: emp?.planned_start_date ?? '',
      },
      documents: docSets,
      summary: {
        total: docSets.length,
        verified: docSets.filter((d) => d.ocr_status === 'PASSED').length,
        pending: docSets.filter((d) => d.ocr_status === 'PENDING' || d.ocr_status === 'PROCESSING').length,
        issues: docSets.filter((d) => d.ocr_status === 'MANUAL_REVIEW' || d.ocr_status === 'FAILED').length,
      },
    }).pipe(delay(700));
  }

  createEmployee(staffId: string, data: CreateEmployeeRequest): Observable<Employee> {
    const newEmployee: Employee = {
      employee_id: `EMP-${String(this.nextId++).padStart(7, '0')}`,
      first_name: data.first_name,
      middle_name: '',
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      department: data.department,
      stage: 'INVITED',
      offer_accept_date: data.offer_accept_date,
      planned_start_date: data.planned_start_date,
      created_at: new Date().toISOString(),
      created_by: staffId,
    };

    this.mockEmployees.unshift(newEmployee);

    return of(newEmployee).pipe(delay(1000));
  }

  searchEmployeeByEmail(email: string): Observable<boolean> {
    const found = this.mockEmployees.some(
      (e) => e.email.toLowerCase() === email.toLowerCase()
    );
    return of(found).pipe(delay(500));
  }

  triggerExternalVerification(
    documentId: string,
    documentType: DocumentType
  ): Observable<{ success: boolean; message: string }> {
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

  // ─── Mock Document Builder ────────────────────────────────

  private buildMockDocuments(employeeId: string): EmployeeDocument[] {
    if (employeeId === 'EMP-0000011') {
      // Sarah Nkosi — matches the real API data the user provided
      return [
        {
          document_id: 'doc_1774091957246',
          document_type: 'NATIONAL_ID',
          file_name: 'sarah_id.pdf',
          ocr_status: 'MANUAL_REVIEW',
          ocr_completed_at: '2026-03-21T11:19:28.566Z',
          verification: {
            verification_id: 'ver_1774091968566',
            employee_id: 'EMP-0000011',
            employee_name: 'Sarah Nkosi',
            document_type: 'NATIONAL_ID',
            document_id: 'doc_1774091957246',
            confidence: 0,
            decision: 'MANUAL_REVIEW',
            created_at: '2026-03-21T11:19:28.566Z',
            reasoning:
              'This is a body corporate levy statement, not a South African ID document. No 13-digit SA ID number present. Only names provided are \'IT Mushanguri & RR Nduna\' associated with Unit 59, which appear to be unit owners rather than document holders.',
            id_number: 'NOT_FOUND',
            name: 'NOT_FOUND',
            surname: 'NOT_FOUND',
            date_of_birth: 'NOT_FOUND',
            gender: 'NOT_FOUND',
            citizenship: 'NOT_FOUND',
          },
          can_reupload: true,
        },
        {
          document_id: 'doc_1774092000001',
          document_type: 'BANK_CONFIRMATION',
          file_name: 'sarah_bank_letter.pdf',
          ocr_status: 'PASSED',
          ocr_completed_at: '2026-03-21T11:25:00.000Z',
          verification: {
            verification_id: 'ver_1774092000002',
            employee_id: 'EMP-0000011',
            employee_name: 'Sarah Nkosi',
            document_type: 'BANK_CONFIRMATION',
            document_id: 'doc_1774092000001',
            confidence: 92,
            decision: 'PASSED',
            created_at: '2026-03-21T11:25:00.000Z',
            reasoning:
              'Bank confirmation letter from FNB detected. Account holder name matches employee record. Account number and branch code extracted successfully.',
            id_number: 'N/A',
            name: 'Sarah',
            surname: 'Nkosi',
            date_of_birth: 'N/A',
            gender: 'N/A',
            citizenship: 'N/A',
          },
          can_reupload: false,
        },
        {
          document_id: 'doc_1774092000003',
          document_type: 'MATRIC_CERTIFICATE',
          file_name: 'sarah_matric.pdf',
          ocr_status: 'PENDING',
          verification: null,
          can_reupload: true,
        },
        {
          document_id: 'doc_1774092000004',
          document_type: 'TERTIARY_QUALIFICATION',
          file_name: 'sarah_bsc_degree.pdf',
          ocr_status: 'PENDING',
          verification: null,
          can_reupload: true,
        },
      ];
    }

    if (employeeId === 'EMP-0000013') {
      // Lerato — VERIFIED, all docs passed
      return [
        {
          document_id: 'doc_lerato_id',
          document_type: 'NATIONAL_ID',
          file_name: 'lerato_sa_id.pdf',
          ocr_status: 'PASSED',
          ocr_completed_at: '2026-03-05T10:00:00.000Z',
          verification: {
            verification_id: 'ver_lerato_id',
            employee_id: 'EMP-0000013',
            employee_name: 'Lerato Dlamini',
            document_type: 'NATIONAL_ID',
            document_id: 'doc_lerato_id',
            confidence: 97,
            decision: 'PASSED',
            created_at: '2026-03-05T10:00:00.000Z',
            reasoning: 'Valid South African ID document. 13-digit ID number extracted and validated. Name matches employee record.',
            id_number: '9501015****08*',
            name: 'Lerato',
            surname: 'Dlamini',
            date_of_birth: '1995-01-01',
            gender: 'Female',
            citizenship: 'South African',
          },
          can_reupload: false,
        },
        {
          document_id: 'doc_lerato_bank',
          document_type: 'BANK_CONFIRMATION',
          file_name: 'lerato_bank_confirm.pdf',
          ocr_status: 'PASSED',
          ocr_completed_at: '2026-03-05T10:05:00.000Z',
          verification: {
            verification_id: 'ver_lerato_bank',
            employee_id: 'EMP-0000013',
            employee_name: 'Lerato Dlamini',
            document_type: 'BANK_CONFIRMATION',
            document_id: 'doc_lerato_bank',
            confidence: 95,
            decision: 'PASSED',
            created_at: '2026-03-05T10:05:00.000Z',
            reasoning: 'Capitec bank confirmation letter. Account holder matches employee. Account details extracted.',
            id_number: 'N/A',
            name: 'Lerato',
            surname: 'Dlamini',
            date_of_birth: 'N/A',
            gender: 'N/A',
            citizenship: 'N/A',
          },
          can_reupload: false,
        },
        {
          document_id: 'doc_lerato_matric',
          document_type: 'MATRIC_CERTIFICATE',
          file_name: 'lerato_matric_cert.pdf',
          ocr_status: 'PASSED',
          verification: null,
          can_reupload: false,
        },
      ];
    }

    // Default: employee with pending documents
    const emp = this.mockEmployees.find((e) => e.employee_id === employeeId);
    const name = emp ? `${emp.first_name.toLowerCase()}_${emp.last_name.toLowerCase()}` : 'employee';

    return [
      {
        document_id: `doc_${employeeId}_id`,
        document_type: 'NATIONAL_ID',
        file_name: `${name}_id.pdf`,
        ocr_status: 'PENDING',
        verification: null,
        can_reupload: true,
      },
      {
        document_id: `doc_${employeeId}_bank`,
        document_type: 'BANK_CONFIRMATION',
        file_name: `${name}_bank.pdf`,
        ocr_status: 'PENDING',
        verification: null,
        can_reupload: true,
      },
      {
        document_id: `doc_${employeeId}_matric`,
        document_type: 'MATRIC_CERTIFICATE',
        file_name: `${name}_matric.pdf`,
        ocr_status: 'PENDING',
        verification: null,
        can_reupload: true,
      },
      {
        document_id: `doc_${employeeId}_tertiary`,
        document_type: 'TERTIARY_QUALIFICATION',
        file_name: `${name}_qualification.pdf`,
        ocr_status: 'PENDING',
        verification: null,
        can_reupload: true,
      },
    ];
  }
}
