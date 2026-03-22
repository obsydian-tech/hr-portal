import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { Employee } from '../../../../shared/models/employee.model';
import { DatePipe } from '@angular/common';
import { CardModule } from 'primeng/card';
import { AvatarModule } from 'primeng/avatar';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';

@Component({
  selector: 'app-employee-highlights',
  standalone: true,
  imports: [DatePipe, CardModule, AvatarModule, TagModule, DividerModule],
  templateUrl: './employee-highlights.component.html',
  styleUrl: './employee-highlights.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeHighlightsComponent {
  readonly employee = input.required<Employee>();
  readonly hrPartner = input<string>('Sandra Nkosi');
}
