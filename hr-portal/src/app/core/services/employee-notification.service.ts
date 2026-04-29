import { Injectable, computed, signal, inject, OnDestroy } from '@angular/core';
import { HrApiService } from './hr-api.service';
import { EmployeeDocument } from '../../shared/models/employee.model';

/**
 * Notification item for employee dashboard
 */
export interface EmployeeNotification {
  document_id: string;
  document_type: string;
  status: 'FAILED' | 'PASSED';
  statusText: string;
  actionText: string;
  created_at: string;
}

/**
 * Service to manage notifications for employee dashboard.
 * Polls document status every 60 seconds to show FAILED (rejected) and PASSED (approved) documents.
 */
@Injectable()
export class EmployeeNotificationService implements OnDestroy {
  private readonly hrApi = inject(HrApiService);
  private pollInterval?: number;
  private employeeId = signal<string>('');
  
  // ─── State Signals ───────────────────────────────────────
  
  /** All documents fetched from API */
  private readonly allDocuments = signal<EmployeeDocument[]>([]);
  
  /** Loading state for initial fetch and refreshes */
  readonly loading = signal<boolean>(false);
  
  /** Error state if API call fails */
  readonly error = signal<string | null>(null);
  
  // ─── Computed Signals ────────────────────────────────────
  
  /** Documents that were rejected (FAILED) - need reupload */
  readonly rejectedDocuments = computed(() => 
    this.allDocuments().filter(doc => {
      // Check both ocr_status and verification decision
      if (doc.ocr_status === 'FAILED') return true;
      if (doc.verification?.decision === 'FAILED') return true;
      return false;
    })
  );
  
  /** Documents that were approved (PASSED) */
  readonly approvedDocuments = computed(() => 
    this.allDocuments().filter(doc => {
      if (doc.ocr_status === 'PASSED') return true;
      if (doc.verification?.decision === 'PASSED') return true;
      return false;
    })
  );
  
  /** Total notification count (rejected + approved) */
  readonly totalNotificationCount = computed(() => 
    this.rejectedDocuments().length + this.approvedDocuments().length
  );
  
  /** Recent 5 notifications for dropdown display */
  readonly recentNotifications = computed((): EmployeeNotification[] => {
    const rejected = this.rejectedDocuments().map(doc => this.mapToNotification(doc, 'FAILED'));
    const approved = this.approvedDocuments().map(doc => this.mapToNotification(doc, 'PASSED'));
    
    // Combine and sort by timestamp (most recent first)
    const all = [...rejected, ...approved].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    return all.slice(0, 5);
  });
  
  // ─── Public Methods ──────────────────────────────────────
  
  /**
   * Initialize the service with employee ID and start polling
   */
  initialize(employeeId: string): void {
    this.employeeId.set(employeeId);
    this.refreshDocuments();
    this.startPolling();
  }
  
  /**
   * Manually trigger a refresh of document data
   */
  refreshDocuments(): void {
    const empId = this.employeeId();
    if (!empId) return;
    
    this.loading.set(true);
    this.error.set(null);
    
    this.hrApi.getEmployeeDocuments(empId).subscribe({
      next: (response) => {
        this.allDocuments.set(response.documents || []);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to fetch employee documents for notifications:', err);
        this.error.set('Failed to load notifications');
        this.loading.set(false);
      },
    });
  }
  
  ngOnDestroy(): void {
    this.stopPolling();
  }
  
  // ─── Private Methods ─────────────────────────────────────
  
  private startPolling(): void {
    // Poll every 60 seconds (60,000 ms)
    this.pollInterval = window.setInterval(() => {
      this.refreshDocuments();
    }, 60_000);
  }
  
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }
  
  /**
   * Map EmployeeDocument to EmployeeNotification with user-friendly text
   */
  private mapToNotification(doc: EmployeeDocument, status: 'FAILED' | 'PASSED'): EmployeeNotification {
    const docTypeLabel = this.getDocumentTypeLabel(doc.document_type);
    
    let statusText: string;
    let actionText: string;
    
    if (status === 'FAILED') {
      statusText = 'rejected';
      actionText = 'Reupload required';
    } else {
      statusText = 'approved';
      actionText = 'Verified successfully';
    }
    
    return {
      document_id: doc.document_id,
      document_type: doc.document_type,
      status,
      statusText: `${docTypeLabel} ${statusText}`,
      actionText,
      created_at: doc.ocr_completed_at || doc.uploaded_at || new Date().toISOString(),
    };
  }
  
  /**
   * Get user-friendly label for document type
   */
  private getDocumentTypeLabel(docType: string): string {
    switch (docType) {
      case 'ID_DOCUMENT':
        return 'ID Document';
      case 'BANK_CONFIRMATION':
        return 'Bank Confirmation';
      case 'PROOF_OF_ADDRESS':
        return 'Proof of Address';
      case 'QUALIFICATION':
        return 'Qualification';
      default:
        return 'Document';
    }
  }
}
