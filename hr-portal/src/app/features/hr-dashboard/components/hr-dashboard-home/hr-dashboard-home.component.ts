import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { HrApiService } from '../../../../core/services/hr-api.service';
import {
  Employee,
  OnboardingStage,
} from '../../../../shared/models/employee.model';
import { StatCardComponent } from '../stat-card/stat-card.component';
import { isHrManager, getHrPartners, HrStaffMember } from '../../../../shared/constants/hr-staff';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { AiModeService } from '../../services/ai-mode.service';

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
    SelectModule,
    FormsModule,
  ],
  templateUrl: './hr-dashboard-home.component.html',
  styleUrl: './hr-dashboard-home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HrDashboardHomeComponent implements OnInit, OnDestroy {
  private readonly hrApi = inject(HrApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly aiMode = inject(AiModeService);

  private readonly subs = new Subscription();

  readonly employees = signal<Employee[]>([]);
  readonly loading = signal(true);

  /** Whether the current user is an HR Manager (sees all employees) */
  readonly isManager = signal(false);

  /** HR Partner filter (manager only) */
  readonly partnerFilter = signal<string>('');
  readonly partnerOptions = computed(() => {
    const partners = getHrPartners();
    return [
      { label: 'All HR Partners', value: '' },
      ...partners.map((p) => ({ label: p.fullName, value: p.staffId })),
    ];
  });

  readonly searchEmail = signal('');

  readonly filteredEmployees = computed(() => {
    let list = this.employees();
    const term = this.searchEmail().toLowerCase().trim();
    if (term) {
      list = list.filter((e) => e.email.toLowerCase().includes(term));
    }
    const partnerFilterVal = this.partnerFilter();
    if (partnerFilterVal) {
      list = list.filter((e) => e.hr_staff_id === partnerFilterVal);
    }
    return list;
  });

  // Stat computations
  readonly totalEmployees = computed(() => this.employees().length);
  readonly pendingDocuments = computed(
    () => this.employees().filter((e) => e.stage === 'INVITED' || e.stage === 'ACTIVE').length
  );
  readonly verificationPending = computed(
    () => this.employees().filter((e) => e.stage === 'DOCUMENTS_SUBMITTED').length
  );
  readonly onboarded = computed(
    () => this.employees().filter((e) => e.stage === 'ONBOARDED').length
  );

  ngOnInit(): void {
    const staffId = this.route.parent?.snapshot.params['staffId'] ?? 'AS00001';
    this.isManager.set(isHrManager(staffId));

    this.loadEmployees();

    // Refresh list when AI assistant creates a new employee via HITL flow
    this.subs.add(
      this.aiMode.employeeCreated$.subscribe(() => this.loadEmployees())
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private loadEmployees(): void {
    this.loading.set(true);
    this.hrApi.getEmployees().subscribe((res) => {
      this.employees.set(res.items);
      this.loading.set(false);
    });
  }

  stageSeverity(stage: OnboardingStage): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (stage) {
      case 'ONBOARDED': return 'success';
      case 'VERIFIED':
      case 'TRAINING': return 'info';
      case 'DOCUMENTS_SUBMITTED': return 'warn';
      case 'ACTIVE': return 'secondary';
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
