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
import {
  Employee,
  Verification,
  OnboardingStage,
} from '../../../../shared/models/employee.model';
import { StatCardComponent } from '../stat-card/stat-card.component';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-hr-dashboard-home',
  standalone: true,
  imports: [
    DatePipe,
    StatCardComponent,
    TableModule,
    TagModule,
    ButtonModule,
    CardModule,
    SkeletonModule,
    InputTextModule,
  ],
  templateUrl: './hr-dashboard-home.component.html',
  styleUrl: './hr-dashboard-home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HrDashboardHomeComponent implements OnInit {
  private readonly hrApi = inject(HrApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly employees = signal<Employee[]>([]);
  readonly verifications = signal<Verification[]>([]);
  readonly loading = signal(true);

  readonly searchEmail = signal('');

  readonly filteredEmployees = computed(() => {
    const term = this.searchEmail().toLowerCase().trim();
    if (!term) return this.employees();
    return this.employees().filter((e) => e.email.toLowerCase().includes(term));
  });

  // Stat computations
  readonly totalEmployees = computed(() => this.employees().length);
  readonly pendingDocuments = computed(
    () => this.employees().filter((e) => e.stage === 'INVITED' || e.stage === 'DOCUMENTS').length
  );
  readonly verificationPending = computed(
    () => this.employees().filter((e) => e.stage === 'VERIFICATION_PENDING').length
  );
  readonly onboarded = computed(
    () => this.employees().filter((e) => e.stage === 'ONBOARDED').length
  );

  ngOnInit(): void {
    const staffId = this.route.parent?.snapshot.params['staffId'] ?? 'AS00001';

    this.hrApi.getEmployees(staffId).subscribe((res) => {
      this.employees.set(res.items);
      this.loading.set(false);
    });

    this.hrApi.getVerifications(staffId).subscribe((res) => {
      this.verifications.set(res.items);
    });
  }

  stageSeverity(stage: OnboardingStage): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (stage) {
      case 'ONBOARDED': return 'success';
      case 'VERIFIED':
      case 'TRAINING': return 'info';
      case 'VERIFICATION_PENDING': return 'warn';
      case 'DOCUMENTS': return 'secondary';
      case 'INVITED': return 'contrast';
      default: return 'secondary';
    }
  }

  stageLabel(stage: OnboardingStage): string {
    return stage.replace(/_/g, ' ');
  }

  decisionSeverity(decision: string): 'success' | 'warn' | 'danger' | 'secondary' {
    switch (decision) {
      case 'PASSED': return 'success';
      case 'MANUAL_REVIEW': return 'warn';
      case 'FAILED': return 'danger';
      default: return 'secondary';
    }
  }

  navigateToEmployee(employeeId: string): void {
    this.router.navigate(['employees', employeeId], { relativeTo: this.route.parent });
  }

  onSearchInput(event: Event): void {
    this.searchEmail.set((event.target as HTMLInputElement).value);
  }
}
