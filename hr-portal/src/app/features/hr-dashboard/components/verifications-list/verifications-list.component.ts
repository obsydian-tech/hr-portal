import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HrApiService } from '../../../../core/services/hr-api.service';
import { Verification, VerificationDecision } from '../../../../shared/models/employee.model';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-verifications-list',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    TagModule,
    ButtonModule,
    CardModule,
    SkeletonModule,
    SelectModule,
  ],
  templateUrl: './verifications-list.component.html',
  styleUrl: './verifications-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerificationsListComponent implements OnInit {
  private readonly hrApi = inject(HrApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly verifications = signal<Verification[]>([]);
  readonly loading = signal(true);

  readonly decisionFilter = signal<VerificationDecision | ''>('');

  readonly decisionOptions = [
    { label: 'All Decisions', value: '' },
    { label: 'Manual Review', value: 'MANUAL_REVIEW' },
    { label: 'Passed', value: 'PASSED' },
    { label: 'Failed', value: 'FAILED' },
  ];

  readonly filteredVerifications = computed(() => {
    const filter = this.decisionFilter();
    if (!filter) return this.verifications();
    return this.verifications().filter((v) => v.decision === filter);
  });

  readonly totalCount = computed(() => this.verifications().length);
  readonly manualReviewCount = computed(
    () => this.verifications().filter((v) => v.decision === 'MANUAL_REVIEW').length
  );
  readonly passedCount = computed(
    () => this.verifications().filter((v) => v.decision === 'PASSED').length
  );
  readonly failedCount = computed(
    () => this.verifications().filter((v) => v.decision === 'FAILED').length
  );

  ngOnInit(): void {
    const staffId = this.route.parent?.snapshot.params['staffId'] ?? '';
    this.hrApi.getVerifications(staffId).subscribe((res) => {
      this.verifications.set(res.items);
      this.loading.set(false);
    });
  }

  onDecisionChange(value: VerificationDecision | ''): void {
    this.decisionFilter.set(value);
  }

  decisionSeverity(decision: string): 'success' | 'warn' | 'danger' | 'secondary' {
    switch (decision) {
      case 'PASSED': return 'success';
      case 'MANUAL_REVIEW': return 'warn';
      case 'FAILED': return 'danger';
      default: return 'secondary';
    }
  }

  navigateToEmployee(employeeId: string | undefined): void {
    if (!employeeId) return;
    this.router.navigate(['../employees', employeeId], { relativeTo: this.route });
  }

  navigateToVerification(documentId: string | undefined): void {
    if (!documentId) return;
    this.router.navigate(['..', 'verifications', documentId], { relativeTo: this.route });
  }

  goBack(): void {
    this.router.navigate(['../'], { relativeTo: this.route });
  }
}
