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
import { SelectModule } from 'primeng/select';
import { MessageService, ConfirmationService } from 'primeng/api';
import { TalentFlowApiService } from '../../../../../services/talent-flow-api.service';
import { ConfigResponse } from '../../../../../models/talent-flow.models';
import {
  LocaleSettingsConfig,
  DEFAULT_LOCALE_SETTINGS,
} from '../../../../../models/admin.models';
import { ConfigVersionBadgeComponent } from '../../../components/config-version-badge/config-version-badge.component';

const TIMEZONE_OPTIONS = [
  { label: 'Africa/Johannesburg (SAST, UTC+2)', value: 'Africa/Johannesburg' },
  { label: 'Africa/Lagos (WAT, UTC+1)',          value: 'Africa/Lagos'         },
  { label: 'Africa/Nairobi (EAT, UTC+3)',        value: 'Africa/Nairobi'       },
  { label: 'Africa/Cairo (EET, UTC+2)',           value: 'Africa/Cairo'         },
  { label: 'Europe/London (GMT/BST)',             value: 'Europe/London'        },
  { label: 'Europe/Paris (CET/CEST)',             value: 'Europe/Paris'         },
  { label: 'America/New_York (EST/EDT)',          value: 'America/New_York'     },
  { label: 'America/Chicago (CST/CDT)',           value: 'America/Chicago'      },
  { label: 'America/Los_Angeles (PST/PDT)',       value: 'America/Los_Angeles'  },
  { label: 'Asia/Dubai (GST, UTC+4)',             value: 'Asia/Dubai'           },
  { label: 'Asia/Kolkata (IST, UTC+5:30)',        value: 'Asia/Kolkata'         },
  { label: 'Australia/Sydney (AEST/AEDT)',        value: 'Australia/Sydney'     },
  { label: 'UTC',                                 value: 'UTC'                  },
];

const DATE_FORMAT_OPTIONS = [
  { label: 'DD MMM YYYY — 25 Jan 2025',    value: 'DD MMM YYYY'  },
  { label: 'DD/MM/YYYY — 25/01/2025',      value: 'DD/MM/YYYY'   },
  { label: 'MM/DD/YYYY — 01/25/2025',      value: 'MM/DD/YYYY'   },
  { label: 'YYYY-MM-DD — 2025-01-25',      value: 'YYYY-MM-DD'   },
  { label: 'DD.MM.YYYY — 25.01.2025',      value: 'DD.MM.YYYY'   },
];

const CURRENCY_OPTIONS = [
  { label: 'ZAR — South African Rand (R)',   value: 'ZAR', symbol: 'R'   },
  { label: 'USD — US Dollar ($)',            value: 'USD', symbol: '$'   },
  { label: 'EUR — Euro (€)',                 value: 'EUR', symbol: '€'   },
  { label: 'GBP — Pound Sterling (£)',       value: 'GBP', symbol: '£'   },
  { label: 'NGN — Nigerian Naira (₦)',       value: 'NGN', symbol: '₦'   },
  { label: 'KES — Kenyan Shilling (KSh)',   value: 'KES', symbol: 'KSh' },
  { label: 'GHS — Ghanaian Cedi (₵)',       value: 'GHS', symbol: '₵'   },
  { label: 'AED — UAE Dirham (د.إ)',         value: 'AED', symbol: 'د.إ' },
];

/** Card 5 — Locale & Regional Settings */
@Component({
  selector: 'tf-locale-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    ConfigVersionBadgeComponent,
  ],
  templateUrl: './locale-card.component.html',
  styleUrl:    './locale-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocaleCardComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading        = signal(true);
  readonly saving         = signal(false);
  readonly configVersion  = signal<string | null>(null);
  readonly updatedAt      = signal<string | null>(null);

  readonly timezones    = TIMEZONE_OPTIONS;
  readonly dateFormats  = DATE_FORMAT_OPTIONS;
  readonly currencies   = CURRENCY_OPTIONS;

  readonly form = signal<LocaleSettingsConfig>({ ...DEFAULT_LOCALE_SETTINGS });

  ngOnInit(): void {
    this.api.getConfig('LOCALE_SETTINGS').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<LocaleSettingsConfig>;
        this.form.set({
          timezone:       d.timezone       ?? DEFAULT_LOCALE_SETTINGS.timezone,
          dateFormat:     d.dateFormat     ?? DEFAULT_LOCALE_SETTINGS.dateFormat,
          currency:       d.currency       ?? DEFAULT_LOCALE_SETTINGS.currency,
          currencySymbol: d.currencySymbol ?? DEFAULT_LOCALE_SETTINGS.currencySymbol,
        });
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  patchForm(field: keyof LocaleSettingsConfig, value: string): void {
    if (field === 'currency') {
      const match = CURRENCY_OPTIONS.find((c) => c.value === value);
      this.form.update((f) => ({ ...f, currency: value, currencySymbol: match?.symbol ?? '' }));
    } else {
      this.form.update((f) => ({ ...f, [field]: value }));
    }
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message:
        'Saving locale settings will update all SLA timestamps and date displays platform-wide. ' +
        'Confirm you want to apply these changes.',
      header:  'Save Locale Settings',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(),
    });
  }

  private doSave(): void {
    this.saving.set(true);
    this.api
      .updateConfig('LOCALE_SETTINGS', this.form() as unknown as Record<string, unknown>)
      .subscribe({
        next: (cfg: ConfigResponse) => {
          this.configVersion.set(cfg.version);
          this.updatedAt.set(cfg.updatedAt);
          this.saving.set(false);
          this.messageService.add({
            severity: 'success',
            summary:  'Saved',
            detail:   'Locale settings updated.',
            life:      4000,
          });
        },
        error: () => {
          this.saving.set(false);
          this.messageService.add({
            severity: 'error',
            summary:  'Save failed',
            detail:   'Could not save locale settings. Please try again.',
            life:      4000,
          });
        },
      });
  }
}
