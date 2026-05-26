import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { MessageService } from 'primeng/api';
import { AdminApiService } from '../../../../../services/admin-api.service';
import {
  TenantProfile,
  UpdateTenantProfileRequest,
  TenantIndustry,
  TenantCompanySize,
} from '../../../../../models/admin.models';

const INDUSTRY_OPTIONS: { label: string; value: TenantIndustry }[] = [
  { label: 'Technology',          value: 'TECHNOLOGY'         },
  { label: 'Financial Services',  value: 'FINANCIAL_SERVICES' },
  { label: 'Government',          value: 'GOVERNMENT'         },
  { label: 'Healthcare',          value: 'HEALTHCARE'         },
  { label: 'Education',           value: 'EDUCATION'          },
  { label: 'Retail',              value: 'RETAIL'             },
  { label: 'Manufacturing',       value: 'MANUFACTURING'      },
  { label: 'Other',               value: 'OTHER'              },
];

const COMPANY_SIZE_OPTIONS: { label: string; value: TenantCompanySize }[] = [
  { label: 'Micro  (1–50)',   value: 'MICRO'   },
  { label: 'Small  (51–200)', value: 'SMALL'   },
  { label: 'Medium (201–500)', value: 'MEDIUM' },
  { label: 'Large  (500+)',   value: 'LARGE'   },
];

/** Card 1 — Branding & Identity */
@Component({
  selector: 'tf-branding-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
  ],
  templateUrl: './branding-card.component.html',
  styleUrl:    './branding-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandingCardComponent implements OnInit {
  private readonly api            = inject(AdminApiService);
  private readonly messageService = inject(MessageService);

  readonly loading        = signal(true);
  readonly saving         = signal(false);
  readonly uploadingLogo  = signal(false);

  readonly industries   = INDUSTRY_OPTIONS;
  readonly companySizes = COMPANY_SIZE_OPTIONS;

  readonly form = signal<UpdateTenantProfileRequest>({
    companyName: '',
    tradingName: '',
    industry:    'TECHNOLOGY',
    companySize: 'MEDIUM',
    logoUrl:     undefined,
  });

  readonly logoPreview = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getTenantProfile().subscribe({
      next: (profile: TenantProfile) => {
        this.form.set({
          companyName: profile.companyName,
          tradingName: profile.tradingName ?? '',
          industry:    profile.industry,
          companySize: profile.companySize,
          logoUrl:     profile.logoUrl,
        });
        if (profile.logoUrl) this.logoPreview.set(profile.logoUrl);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/svg+xml'].includes(file.type)) {
      this.toast('error', 'Invalid file type', 'Only PNG or SVG files are accepted.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.toast('error', 'File too large', 'Logo must be under 2 MB.');
      return;
    }

    // Local preview while uploading
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);

    this.uploadingLogo.set(true);
    this.api.uploadTenantLogo(file).subscribe({
      next: (res) => {
        this.form.update((f) => ({ ...f, logoUrl: res.logoUrl }));
        this.uploadingLogo.set(false);
        this.toast('success', 'Logo uploaded', 'Logo will be saved when you click Save.');
      },
      error: () => {
        this.uploadingLogo.set(false);
        this.toast('error', 'Upload failed', 'Could not upload the logo. Please try again.');
      },
    });
  }

  save(): void {
    const f = this.form();
    if (!f.companyName.trim() || this.saving()) return;
    this.saving.set(true);
    this.api.updateTenantProfile(f).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast('success', 'Saved', 'Branding & identity saved successfully.');
      },
      error: () => {
        this.saving.set(false);
        this.toast('error', 'Save failed', 'Could not save branding. Please try again.');
      },
    });
  }

  patchForm(field: keyof UpdateTenantProfileRequest, value: unknown): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  private toast(severity: string, summary: string, detail: string): void {
    this.messageService.add({ severity, summary, detail, life: 4000 });
  }
}
