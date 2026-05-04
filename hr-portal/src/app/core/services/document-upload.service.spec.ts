import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';

import { DocumentUploadService, UploadUrlResponse } from './document-upload.service';
import { environment } from '../../../environments/environment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name = 'test.pdf', type = 'application/pdf', sizeBytes = 1024): File {
  const content = new Uint8Array(sizeBytes).fill(1);
  return new File([content], name, { type });
}

const PRESIGNED_URL = 'https://s3.af-south-1.amazonaws.com/bucket/key?X-Amz-Signature=abc';

const UPLOAD_URL_RESPONSE: UploadUrlResponse = {
  url: PRESIGNED_URL,
  document_id: 'DOC-99',
  s3_key: 'uploads/EMP-0000001/DOC-99.pdf',
  expires_in: 300,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocumentUploadService', () => {
  let service: DocumentUploadService;
  let httpMock: HttpTestingController;

  const docBase = environment.documentUploadApiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DocumentUploadService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(DocumentUploadService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ── Construction ──────────────────────────────────────────────────────────

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── upload: POST /upload-url then PUT to S3 ─────────────────────────────

  it('upload: should POST to /v1/employees/{employeeId}/documents/upload-url', (done) => {
    const file = makeFile('id-doc.pdf', 'application/pdf');

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe((resp) => {
      expect(resp).toBeTruthy();
      done();
    });

    const postReq = httpMock.expectOne(
      r => r.url.includes('/v1/employees/EMP-0000001/documents/upload-url') && r.method === 'POST'
    );
    postReq.flush(UPLOAD_URL_RESPONSE);
    httpMock.expectOne(r => r.url === PRESIGNED_URL && r.method === 'PUT').flush(null);
  });

  it('upload: should use the documentUploadApiUrl from environment', (done) => {
    const file = makeFile();

    service.upload(file, 'BANK_CONFIRMATION', 'EMP-0000002').subscribe(() => done());

    const postReq = httpMock.expectOne(r => r.url.startsWith(docBase) && r.method === 'POST');
    expect(postReq.request.url).toContain(docBase);
    postReq.flush({ ...UPLOAD_URL_RESPONSE, document_id: 'DOC-100' });
    httpMock.expectOne(r => r.method === 'PUT').flush(null);
  });

  it('upload: should send documentType in the POST body', (done) => {
    const file = makeFile('payslip.pdf', 'application/pdf');

    service.upload(file, 'BANK_CONFIRMATION', 'EMP-0000001').subscribe(() => done());

    const postReq = httpMock.expectOne(
      r => r.url.includes('/v1/employees/EMP-0000001/documents/upload-url')
    );
    expect(postReq.request.body.documentType).toBe('BANK_CONFIRMATION');
    postReq.flush(UPLOAD_URL_RESPONSE);
    httpMock.expectOne(r => r.method === 'PUT').flush(null);
  });

  it('upload: should send the file name in the POST body', (done) => {
    const file = makeFile('my-contract.pdf', 'application/pdf');

    service.upload(file, 'MATRIC_CERTIFICATE', 'EMP-0000003').subscribe(() => done());

    const postReq = httpMock.expectOne(
      r => r.url.includes('/v1/employees/EMP-0000003/documents/upload-url')
    );
    expect(postReq.request.body.fileName).toBe('my-contract.pdf');
    postReq.flush(UPLOAD_URL_RESPONSE);
    httpMock.expectOne(r => r.method === 'PUT').flush(null);
  });

  it('upload: should send the MIME type as contentType in the POST body', (done) => {
    const file = makeFile('photo.jpg', 'image/jpeg');

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe(() => done());

    const postReq = httpMock.expectOne(
      r => r.url.includes('/v1/employees/EMP-0000001/documents/upload-url')
    );
    expect(postReq.request.body.contentType).toBe('image/jpeg');
    postReq.flush(UPLOAD_URL_RESPONSE);
    httpMock.expectOne(r => r.method === 'PUT').flush(null);
  });

  it('upload: should PUT the raw File to the presigned S3 URL', (done) => {
    const file = makeFile('doc.pdf', 'application/pdf');

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe(() => done());

    httpMock.expectOne(r => r.method === 'POST').flush(UPLOAD_URL_RESPONSE);

    const putReq = httpMock.expectOne(r => r.url === PRESIGNED_URL && r.method === 'PUT');
    expect(putReq.request.body).toBe(file);
    putReq.flush(null);
  });

  it('upload: should return a normalised DocumentUploadResponse', (done) => {
    const file = makeFile();

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe((resp) => {
      expect(resp.document_id).toBe('DOC-99');
      expect(resp.employee_id).toBe('EMP-0000001');
      expect(resp.s3_key).toBe(UPLOAD_URL_RESPONSE.s3_key);
      expect(resp.ocr_status).toBe('PENDING');
      expect(resp.message).toBe('Document uploaded successfully');
      done();
    });

    httpMock.expectOne(r => r.method === 'POST').flush(UPLOAD_URL_RESPONSE);
    httpMock.expectOne(r => r.method === 'PUT').flush(null);
  });

  it('upload: PUT should not include an Authorization header', (done) => {
    const file = makeFile();

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe(() => done());

    httpMock.expectOne(r => r.method === 'POST').flush(UPLOAD_URL_RESPONSE);

    const putReq = httpMock.expectOne(r => r.method === 'PUT');
    expect(putReq.request.headers.has('Authorization')).toBeFalse();
    putReq.flush(null);
  });

  it('upload: should propagate POST /upload-url errors as observable errors', (done) => {
    const file = makeFile();

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe({
      next: () => fail('Expected error'),
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });

    httpMock.expectOne(r => r.method === 'POST').flush(
      { message: 'Internal Server Error' },
      { status: 500, statusText: 'Server Error' }
    );
  });
});
