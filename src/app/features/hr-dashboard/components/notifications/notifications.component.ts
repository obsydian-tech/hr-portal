import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { NotificationService } from '../../../../core/services/notification.service';
import { Verification } from '../../../../shared/models/employee.model';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    DatePipe,
    TableModule,
    TagModule,
    ButtonModule,
    CardModule,
    SkeletonModule,
    TooltipModule,
  ],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  private readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Access notification data from service
  readonly notifications = this.notificationService.notifications;
  readonly loading = this.notificationService.loading;
  readonly error = this.notificationService.error;
  
  readonly notificationCount = computed(() => this.notifications().length);

  /**
   * Get document type icon class
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
   * Navigate to employee detail page
   */
  navigateToEmployee(employeeId: string | undefined): void {
    if (!employeeId) return;
    this.router.navigate(['../employees', employeeId], { relativeTo: this.route });
  }

  /**
   * Navigate to verification detail page for review
   */
  navigateToVerification(documentId: string | undefined): void {
    if (!documentId) return;
    this.router.navigate(['../verifications', documentId], { relativeTo: this.route });
  }
  
  /**
   * Trigger manual refresh of notifications
   */
  refreshNotifications(): void {
    this.notificationService.refreshNotifications();
  }
  
  /**
   * Format confidence percentage
   */
  formatConfidence(confidence: number): string {
    return `${(confidence * 100).toFixed(0)}%`;
  }
}
