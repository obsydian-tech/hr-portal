import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';

import { DocumentUploadService } from './document-upload.service';
import { environment } from '../../../environments/environment';

// ---------------------------------------------------------------------------
// FileReader stub
// ---------------------------------------------------------------------------

/** Replaces browser FileReader for testing.
 *  Call triggerLoad / triggerError to simulate async events.
 */
class MockFileReader {
  result: string | null = null;
  onload: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;

  readAsDataURL(_blob: Blob): void {
    // Nothing — test drives the event manually
  }

  triggerLoad(dataUrl: string): void {
    this.result = dataUrl;
    if (this.onload) {
      this.onload({ target: this } as unknown as ProgressEvent);
    }
  }

  triggerError(): void {
    if (this.onerror) {
      this.onerror({ target: this } as unknown as ProgressEvent);
    }
  }
}

function makeFile(name = 'test.pdf', type = 'application/pdf', sizeBytes = 1024): File {
  const content = new Uint8Array(sizeBytes).fill(1);
  return new File([content], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocumentUploadService', () => {
  let service: DocumentUploadService;
  let httpMock: HttpTestingController;
  let mockReader: MockFileReader;

  const docBase = environment.documentUploadApiUrl;

  beforeEach(() => {
    mockReader = new MockFileReader();

    // Replace window.FileReader for the duration of each test
    spyOn(window as any, 'FileReader').and.returnValue(mockReader);

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

  // ── fileToBase64 ──────────────────────────────────────────────────────────

  it('fileToBase64: should resolve with the raw base64 string (no data-URI prefix)', (done) => {
    const file = makeFile();

    (service as any).fileToBase64(file).subscribe((base64: string) => {
      expect(base64).toBe('SGVsbG8gV29ybGQ=');
      done();
    });

    // Simulate FileReader completing with a data-URI
    mockReader.triggerLoad('data:application/pdf;base64,SGVsbG8gV29ybGQ=');
  });

  it('fileToBase64: should strip the comma and everything before it', (done) => {
    const file = makeFile();

    (service as any).fileToBase64(file).subscribe((base64: string) => {
      // Must not contain the data-URI preamble
      expect(base64).not.toContain('base64,');
      expect(base64).toBe('YWJj');
      done();
    });

    mockReader.triggerLoad('data:text/plain;base64,YWJj');
  });

  it('fileToBase64: should emit an error when FileReader fails', (done) => {
    const file = makeFile();

    (service as any).fileToBase64(file).subscribe({
      next: () => fail('Expected an error, not a value'),
      error: (err: any) => {
        expect(err).toBeDefined();
        done();
      },
    });

    mockReader.triggerError();
  });

  // ── upload ────────────────────────────────────────────────────────────────

  it('upload: should POST to /employees/{employeeId}/documents/upload', (done) => {
    const file = makeFile('id-doc.pdf', 'application/pdf');

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe((resp) => {
      expect(resp).toBeTruthy();
      done();
    });

    // Resolve the FileReader first
    mockReader.triggerLoad('data:application/pdf;base64,dGVzdA==');

    const req = httpMock.expectOne(
      r => r.url.includes('/employees/EMP-0000001/documents/upload')
    );
    expect(req.request.method).toBe('POST');
    req.flush({ success: true, documentId: 'DOC-99' });
  });

  it('upload: should use the documentUploadApiUrl from environment', (done) => {
    const file = makeFile();

    service.upload(file, 'BANK_CONFIRMATION', 'EMP-0000002').subscribe(() => done());

    mockReader.triggerLoad('data:application/pdf;base64,dGVzdA==');

    const req = httpMock.expectOne(
      r => r.url.startsWith(docBase)
    );
    expect(req.request.url).toContain(docBase);
    req.flush({});
  });

  it('upload: should send documentType in the request body', (done) => {
    const file = makeFile('payslip.pdf', 'application/pdf');

    service.upload(file, 'BANK_CONFIRMATION', 'EMP-0000001').subscribe(() => done());

    mockReader.triggerLoad('data:application/pdf;base64,cGF5c2xpcA==');

    const req = httpMock.expectOne(
      r => r.url.includes('/employees/EMP-0000001/documents/upload')
    );
    expect(req.request.body.documentType).toBe('BANK_CONFIRMATION');
    req.flush({});
  });

  it('upload: should send the file name in the request body', (done) => {
    const file = makeFile('my-contract.pdf', 'application/pdf');

    service.upload(file, 'MATRIC_CERTIFICATE', 'EMP-0000003').subscribe(() => done());

    mockReader.triggerLoad('data:application/pdf;base64,Y29udHJhY3Q=');

    const req = httpMock.expectOne(
      r => r.url.includes('/employees/EMP-0000003/documents/upload')
    );
    expect(req.request.body.fileName).toBe('my-contract.pdf');
    req.flush({});
  });

  it('upload: should send the raw base64 as fileContent (no data-URI prefix)', (done) => {
    const file = makeFile('doc.pdf', 'application/pdf');

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe(() => done());

    mockReader.triggerLoad('data:application/pdf;base64,cmF3YmFzZTY0');

    const req = httpMock.expectOne(
      r => r.url.includes('/employees/EMP-0000001/documents/upload')
    );
    expect(req.request.body.fileContent).toBe('cmF3YmFzZTY0');
    expect(req.request.body.fileContent).not.toContain('base64,');
    req.flush({});
  });

  it('upload: should send the MIME type as contentType in the body', (done) => {
    const file = makeFile('photo.jpg', 'image/jpeg');

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe(() => done());

    mockReader.triggerLoad('data:image/jpeg;base64,cGhvdG8=');

    const req = httpMock.expectOne(
      r => r.url.includes('/employees/EMP-0000001/documents/upload')
    );
    expect(req.request.body.contentType).toBe('image/jpeg');
    req.flush({});
  });

  it('upload: should propagate FileReader errors as observable errors', (done) => {
    const file = makeFile();

    service.upload(file, 'NATIONAL_ID', 'EMP-0000001').subscribe({
      next: () => fail('Expected error'),
      error: (err) => {
        expect(err).toBeDefined();
        done();
      },
    });

    // Simulate a file read failure
    mockReader.triggerError();
    // No HTTP request should be made
    httpMock.expectNone(() => true);
  });
});
