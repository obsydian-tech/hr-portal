import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  OnInit,
  input,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HrApiService } from '../../../../core/services/hr-api.service';
import {
  EmployeeDocument,
  EmployeeDocumentResponse,
} from '../../../../shared/models/employee.model';
import { DocumentDetailCardComponent } from '../document-detail-card/document-detail-card.component';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { DividerModule } from 'primeng/divider';
import { ProgressBarModule } from 'primeng/progressbar';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    DatePipe,
    DocumentDetailCardComponent,
    ButtonModule,
    TagModule,
    SkeletonModule,
    DividerModule,
    ProgressBarModule,
  ],
  templateUrl: './employee-detail.component.html',
  styleUrl: './employee-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDetailComponent implements OnInit {
  private readonly hrApi = inject(HrApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly employeeId = input<string>('');

  readonly loading = signal(true);
  readonly data = signal<EmployeeDocumentResponse | null>(null);
  /** NH-41: true while the Bedrock risk-classification request is in-flight */
  readonly riskLoading = signal(false);

  get employee() {
    return this.data()?.employee ?? null;
  }

  get documents(): EmployeeDocument[] {
    return this.data()?.documents ?? [];
  }

  get summary() {
    return this.data()?.summary ?? null;
  }

  get completionPercent(): number {
    const s = this.summary;
    if (!s || s.total === 0) return 0;
    return Math.round((s.verified / s.total) * 100);
  }

  ngOnInit(): void {
    const id = this.employeeId() || this.route.snapshot.params['employeeId'];
    if (id) {
      this.hrApi.getEmployeeDocuments(id).subscribe((res) => {
        this.data.set(res);
        this.loading.set(false);
      });
    }
  }

  stageSeverity(stage: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
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

  goBack(): void {
    this.router.navigate(['../../'], { relativeTo: this.route });
  }

  /** NH-41: Trigger Bedrock risk classification and update the displayed risk band. */
  assessRisk(): void {
    const id = this.employee?.employee_id;
    if (!id || this.riskLoading()) return;

    this.riskLoading.set(true);
    this.hrApi.assessRisk(id).subscribe({
      next: (result) => {
        const current = this.data();
        if (current) {
          this.data.set({
            ...current,
            employee: {
              ...current.employee,
              riskBand: result.risk,
              riskReason: result.reason,
              riskAssessedAt: new Date().toISOString(),
            },
          });
        }
        this.riskLoading.set(false);
      },
      error: (err) => {
        console.error('Risk assessment failed', err);
        this.riskLoading.set(false);
      },
    });
  }
}
