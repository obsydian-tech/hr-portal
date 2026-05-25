import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrandingCardComponent } from './components/branding-card/branding-card.component';
import { SeniorityCardComponent } from './components/seniority-card/seniority-card.component';
import { WorkflowTemplatesCardComponent } from './components/workflow-templates-card/workflow-templates-card.component';
import { ApprovalChainsCardComponent } from './components/approval-chains-card/approval-chains-card.component';
import { LocaleCardComponent } from './components/locale-card/locale-card.component';

/**
 * AdminTenantSettingsComponent — Admin-S3
 *
 * Route: /platform/talentflow/admin/tenant
 *
 * Shell page: renders the 5 Tenant Settings cards as standalone child components.
 * Each card owns its own API calls, state and save logic independently.
 */
@Component({
  selector: 'tf-admin-tenant-settings',
  standalone: true,
  imports: [
    CommonModule,
    BrandingCardComponent,
    SeniorityCardComponent,
    WorkflowTemplatesCardComponent,
    ApprovalChainsCardComponent,
    LocaleCardComponent,
  ],
  templateUrl: './admin-tenant-settings.component.html',
  styleUrl:    './admin-tenant-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminTenantSettingsComponent {}
