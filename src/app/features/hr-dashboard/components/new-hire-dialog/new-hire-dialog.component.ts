import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HrApiService } from '../../../../core/services/hr-api.service';
import { CreateEmployeeRequest } from '../../../../shared/models/employee.model';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { DividerModule } from 'primeng/divider';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-new-hire-dialog',
  standalone: true,
  imports: [
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    DatePickerModule,
    DividerModule,
    MessageModule,
  ],
  templateUrl: './new-hire-dialog.component.html',
  styleUrl: './new-hire-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewHireDialogComponent {
  private readonly hrApi = inject(HrApiService);

  readonly visible = model(false);
  readonly employeeCreated = output<void>();

  readonly submitting = signal(false);
  readonly searchingEmail = signal(false);
  readonly emailExists = signal(false);
  readonly successMessage = signal('');

  readonly departments = [
    { label: 'Engineering', value: 'Engineering' },
    { label: 'Finance', value: 'Finance' },
    { label: 'Marketing', value: 'Marketing' },
    { label: 'HR', value: 'HR' },
    { label: 'Legal', value: 'Legal' },
    { label: 'Operations', value: 'Operations' },
  ];

  // Form fields
  firstName = '';
  lastName = '';
  email = '';
  phone = '';
  department = '';
  offerAcceptDate: Date | null = null;
  plannedStartDate: Date | null = null;

  get isFormValid(): boolean {
    return !!(
      this.firstName.trim() &&
      this.lastName.trim() &&
      this.email.trim() &&
      this.phone.trim() &&
      this.department &&
      this.offerAcceptDate &&
      this.plannedStartDate
    );
  }

  searchByEmail(): void {
    if (!this.email.trim()) return;
    this.searchingEmail.set(true);
    this.emailExists.set(false);

    this.hrApi.searchEmployeeByEmail(this.email.trim()).subscribe((exists) => {
      this.emailExists.set(exists);
      this.searchingEmail.set(false);
    });
  }

  submit(): void {
    if (!this.isFormValid || this.emailExists()) return;
    this.submitting.set(true);

    const payload: CreateEmployeeRequest = {
      first_name: this.firstName.trim(),
      last_name: this.lastName.trim(),
      email: this.email.trim(),
      phone: this.phone.trim(),
      department: this.department,
      offer_accept_date: this.offerAcceptDate!.toISOString().split('T')[0],
      planned_start_date: this.plannedStartDate!.toISOString().split('T')[0],
    };

    this.hrApi.createEmployee('AS00001', payload).subscribe(() => {
      this.submitting.set(false);
      this.successMessage.set(`${payload.first_name} ${payload.last_name} has been added.`);
      this.resetForm();
      this.employeeCreated.emit();

      setTimeout(() => {
        this.successMessage.set('');
        this.visible.set(false);
      }, 1500);
    });
  }

  onHide(): void {
    this.resetForm();
    this.successMessage.set('');
  }

  private resetForm(): void {
    this.firstName = '';
    this.lastName = '';
    this.email = '';
    this.phone = '';
    this.department = '';
    this.offerAcceptDate = null;
    this.plannedStartDate = null;
    this.emailExists.set(false);
  }
}
