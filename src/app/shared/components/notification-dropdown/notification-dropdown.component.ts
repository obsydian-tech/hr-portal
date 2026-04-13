import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Verification } from '../../../shared/models/employee.model';

/**
 * Dropdown component to display recent notifications (up to 5).
 * Shows employee name, document type icon, and time since creation.
 */
@Component({
  selector: 'app-notification-dropdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-dropdown.component.html',
  styleUrls: ['./notification-dropdown.component.scss'],
})
export class NotificationDropdownComponent {
  // ─── Inputs ──────────────────────────────────────────────
  
  /** List of notifications to display (max 5) */
  readonly notifications = input.required<Verification[]>();
  
  /** URL path to navigate to "View All" page */
  readonly viewAllRoute = input<string>('');
  
  // ─── Outputs ─────────────────────────────────────────────
  
  /** Emitted when a notification item is clicked */
  readonly notificationClick = output<Verification>();
  
  /** Emitted when "View All" link is clicked */
  readonly viewAllClick = output<void>();
  
  // ─── Methods ─────────────────────────────────────────────
  
  onNotificationClick(notification: Verification): void {
    this.notificationClick.emit(notification);
  }
  
  onViewAllClick(event: Event): void {
    event.preventDefault();
    this.viewAllClick.emit();
  }
  
  /**
   * Get icon class for document type
   */
  getDocumentIcon(docType: string | undefined): string {
    switch (docType) {
      case 'ID_DOCUMENT':
        return 'pi pi-id-card';
      case 'BANK_CONFIRMATION':
        return 'pi pi-building';
      case 'PROOF_OF_ADDRESS':
        return 'pi pi-home';
      case 'QUALIFICATION':
        return 'pi pi-file';
      default:
        return 'pi pi-file-o';
    }
  }
  
  /**
   * Format document type for display
   */
  getDocumentTypeLabel(docType: string | undefined): string {
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
  
  /**
   * Calculate time ago from created_at timestamp
   */
  getTimeAgo(timestamp: string): string {
    const now = new Date().getTime();
    const created = new Date(timestamp).getTime();
    const diffMs = now - created;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks}w ago`;
  }
}
