# TalentFlow Admin UI Patterns - Reference Document

**Date:** 2026-06-08
**Purpose:** Comprehensive reference for building new admin config components
**Source:** Analysis of existing admin config components (scoring-weights, sla-thresholds, panel-rules, routing-rules, notification-rules)

---

## 1. Component Structure

### File Organization
Each admin config feature follows a consistent structure:
```
admin/talentflow-config/[feature-name]/
├── admin-[feature-name].component.ts
├── admin-[feature-name].component.html
└── admin-[feature-name].component.scss
```

### TypeScript Component Pattern

**Component Decorator:**
```typescript
@Component({
  selector: 'tf-admin-[feature-name]',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    ToggleButtonModule,
    SelectModule,
    ConfigVersionBadgeComponent
  ],
  templateUrl: './admin-[feature-name].component.html',
  styleUrl:    './admin-[feature-name].component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

**Key patterns:**
- All components are **standalone** (standalone: true)
- Use **OnPush change detection** for performance
- Import only the PrimeNG modules needed

**Class Structure:**
```typescript
export class AdminScoringWeightsComponent implements OnInit {
  // 1. Inject services using inject() function
  private readonly api             = inject(TalentFlowApiService);
  private readonly messageService  = inject(MessageService);
  private readonly confirmService  = inject(ConfirmationService);

  // 2. Define signals for reactive state
  readonly loading      = signal(true);
  readonly saving       = signal(false);
  readonly configData   = signal<YourDataType>({ ...DEFAULT_DATA });
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt    = signal<string | null>(null);

  // 3. Optional computed signals for derived state
  readonly total     = computed(() => {
    // compute from this.configData()
  });

  // 4. Lifecycle hook
  ngOnInit(): void {
    this.loadConfig();
  }

  // 5. Private load method
  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('YOUR_CONFIG_TYPE').subscribe({
      next: (cfg: ConfigResponse) => {
        const d = cfg.data as Partial<YourDataType>;
        this.configData.set({ ...DEFAULT_DATA, ...d });
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  // 6. Update methods
  updateField(key: string, value: unknown): void {
    this.configData.update((data) => ({ ...data, [key]: value }));
  }

  // 7. Confirm dialog methods
  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save these changes? Updated config will apply immediately.',
      header:  'Save Configuration',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave(this.configData()),
    });
  }

  confirmReset(): void {
    this.confirmService.confirm({
      message: 'Reset to factory defaults?',
      header:  'Reset to Defaults',
      icon:    'pi pi-refresh',
      accept:  () => this.doSave({ ...DEFAULT_DATA }),
    });
  }

  // 8. Private save method
  private doSave(payload: YourDataType): void {
    this.saving.set(true);
    this.api.updateConfig('YOUR_CONFIG_TYPE', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configData.set(payload);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Saved',
          detail:   `Configuration saved as version ${cfg.version}.`,
          life:     4000,
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save Failed',
          detail:   err.userMessage ?? 'Could not save configuration.',
          life:     5000,
        });
      },
    });
  }
}
```

---

## 2. Design System - Naleko Tokens

**Main theme file:** `src/styles/naleko-tokens.css`

### Colors
```css
/* Primary/Brand */
--naleko-primary: #1a1a2e;              /* Anchor navy */
--naleko-secondary: #4a3f8a;            /* Indigo accent */
--naleko-tertiary: #2d8f9e;             /* Teal/cyan */

/* Surfaces (Material-3 inspired hierarchy) */
--naleko-surface: #f8f9fa;              /* Page backdrop */
--naleko-surface-container-lowest: #ffffff;  /* Cards, interaction */
--naleko-surface-container-low: #f3f4f5;     /* Section bg */
--naleko-surface-container: #edeeef;
--naleko-surface-container-high: #e7e8e9;

/* Foreground */
--naleko-on-surface: #191c1d;           /* Body text */
--naleko-on-surface-variant: #47464c;   /* Secondary/muted text */
--naleko-on-primary: #ffffff;

/* Borders */
--naleko-outline: #78767d;
--naleko-outline-variant: #c8c5cd;

/* Semantic Status */
--naleko-success: #2e7d32;
--naleko-success-bg: #e8f5e9;
--naleko-warning: #f57f17;
--naleko-warning-bg: #fff8e1;
--naleko-error: #ba1a1a;
--naleko-error-bg: #fef2f2;
```

### Typography
```css
/* Font families */
--naleko-font-display: 'Manrope', 'Inter', system-ui, sans-serif;
--naleko-font-body: 'Inter', system-ui, -apple-system, sans-serif;
--naleko-font-mono: 'JetBrains Mono', 'SF Mono', monospace;

/* Type scale */
--naleko-text-sm: 0.75rem;    /* 12px */
--naleko-text-base: 0.875rem; /* 14px */
--naleko-text-md: 1rem;       /* 16px */
--naleko-text-xl: 1.5rem;     /* 24px */
```

### Spacing
```css
--naleko-space-1: 0.25rem;
--naleko-space-2: 0.5rem;
--naleko-space-3: 0.75rem;
--naleko-space-4: 1rem;
--naleko-space-6: 1.5rem;
--naleko-space-8: 2rem;
```

### Border Radius
```css
--naleko-radius-sm: 0.25rem;   /* 4px */
--naleko-radius-md: 0.375rem;  /* 6px - buttons */
--naleko-radius-lg: 0.5rem;    /* 8px - inputs */
--naleko-radius-xl: 0.75rem;   /* 12px - cards (signature) */
--naleko-radius-2xl: 1rem;     /* 16px */
```

### Shadows
```css
--naleko-shadow-card: 0 2px 12px rgba(26,26,46,0.06);
--naleko-shadow-focus: 0 0 0 3px rgba(74,63,138,0.10);
```

---

## 3. Component SCSS Patterns

**Standard SCSS structure** (copy this into your component's SCSS file):

```scss
// Config-page layout (self-contained)

.config-page {
  padding: 1.5rem 2rem;

  &__header {
    display:         flex;
    justify-content: space-between;
    align-items:     flex-start;
    margin-bottom:   1.5rem;
    gap:             1rem;
  }

  &__title {
    font-family: var(--naleko-font-display);
    font-size:   1.375rem;
    font-weight: 700;
    color:       var(--naleko-on-surface);
    margin:      0 0 0.25rem;
  }

  &__subtitle {
    font-size: 0.875rem;
    color:     var(--naleko-on-surface-variant);
    margin:    0;
  }

  &__skeleton {
    display:        flex;
    flex-direction: column;
    gap:            0.75rem;
  }
}

.config-skeleton-row {
  height:          2.5rem;
  border-radius:   0.5rem;
  background:      linear-gradient(90deg, var(--naleko-surface-container-low) 25%, var(--naleko-surface-container) 50%, var(--naleko-surface-container-low) 75%);
  background-size: 200% 100%;
  animation:       shimmer 1.5s infinite;
}

@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}

.config-card {
  background:    var(--naleko-surface-container-lowest);
  border:        1.5px solid var(--naleko-outline-variant);
  border-radius: var(--naleko-radius-xl);
  box-shadow:    var(--naleko-shadow-card);
  margin-bottom: 1rem;

  &__section-label {
    padding:        0.625rem 1rem;
    font-size:      0.75rem;
    font-weight:    600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color:          var(--naleko-on-surface-variant);
    background:     var(--naleko-surface-container-low);
    border-bottom:  1px solid var(--naleko-outline-variant);
    border-radius:  var(--naleko-radius-xl) var(--naleko-radius-xl) 0 0;
  }
}

.config-row {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  padding:         0.75rem 1rem;
  gap:             1rem;
  border-bottom:   1px solid var(--naleko-outline-variant);

  &:last-child { border-bottom: none; }

  &__label {
    flex:       1;
    min-width:  0;
    font-size:  0.875rem;
    color:      var(--naleko-on-surface);
  }

  &__label-main {
    display:     block;
    font-weight: 600;
  }

  &__label-desc {
    display:    block;
    font-size:  0.75rem;
    color:      var(--naleko-on-surface-variant);
    margin-top: 0.125rem;
  }

  &__control {
    flex-shrink: 0;
    &--compact { width: 11rem; }
  }
}

.config-save-row {
  display:         flex;
  justify-content: flex-end;
  gap:             0.75rem;
  padding:         0.5rem 0;
  margin-top:      0.5rem;
}

.cfg-btn-reset {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  background: none;
  border: 1.5px solid var(--naleko-outline-variant);
  border-radius: var(--naleko-radius-md);
  padding: 0.6rem 1.25rem;
  font-family: var(--naleko-font-body);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--naleko-on-surface-variant);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;

  &:hover:not(:disabled) {
    background: var(--naleko-surface-container);
    color: var(--naleko-on-surface);
  }

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.cfg-btn-save {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.6rem 1.5rem;
  border: none;
  border-radius: var(--naleko-radius-md);
  background: linear-gradient(135deg, var(--naleko-secondary), var(--naleko-primary));
  color: var(--naleko-on-primary);
  font-family: var(--naleko-font-body);
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s, box-shadow 0.15s;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--naleko-primary) 30%, transparent);

  &:hover:not(:disabled) {
    opacity: 0.92;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--naleko-primary) 40%, transparent);
  }

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
```

---

## 4. PrimeNG Components

### InputNumber
```html
<p-inputNumber
  [ngModel]="value"
  (ngModelChange)="updateValue($event)"
  [min]="0"
  [max]="100"
  [showButtons]="true"
  buttonLayout="horizontal"
  incrementButtonIcon="pi pi-plus"
  decrementButtonIcon="pi pi-minus"
  suffix="%"
  styleClass="config-input-number"
  [style]="{ width: '11rem' }"
  [inputStyle]="{ width: '4.5rem', 'min-width': '0' }"
/>
```

**IMPORTANT:** Always include `'min-width': '0'` in inputStyle to prevent + button overflow!

### ToggleButton
```html
<p-toggleButton
  [ngModel]="enabled"
  (ngModelChange)="toggle($event)"
  onLabel="Enabled"
  offLabel="Disabled"
  onIcon="pi pi-check"
  offIcon="pi pi-times"
  styleClass="config-toggle"
/>
```

### Select (Dropdown)
```html
<p-select
  [ngModel]="selectedValue"
  (ngModelChange)="onSelect($event)"
  [options]="options"
  optionLabel="label"
  optionValue="value"
  styleClass="config-dropdown"
  appendTo="body"
/>
```

---

## 5. Standard Layout Structure

```html
<div class="config-page">

  <!-- Header with title, subtitle, and version badge -->
  <div class="config-page__header">
    <div class="config-page__header-left">
      <h2 class="config-page__title">Your Config Title</h2>
      <p class="config-page__subtitle">Brief description of what this config controls.</p>
    </div>
    <div class="config-page__header-right">
      @if (!loading()) {
        <tf-config-version-badge
          [version]="configVersion()"
          [changedAt]="updatedAt()"
        />
      }
    </div>
  </div>

  <!-- Loading skeleton -->
  @if (loading()) {
    <div class="config-page__skeleton">
      @for (_ of [1,2,3,4]; track $index) {
        <div class="config-skeleton-row"></div>
      }
    </div>
  } @else {

    <!-- Config cards -->
    <div class="config-card">
      <div class="config-card__section-label">Section Name</div>

      @for (item of items; track item.key) {
        <div class="config-row">
          <div class="config-row__label">
            <span class="config-row__label-main">{{ item.label }}</span>
            <span class="config-row__label-desc">{{ item.description }}</span>
          </div>
          <div class="config-row__control">
            <!-- PrimeNG control here -->
          </div>
        </div>
      }
    </div>

    <!-- Save/Reset buttons -->
    <div class="config-save-row">
      <button type="button" class="cfg-btn-reset"
              [disabled]="saving()"
              (click)="confirmReset()">
        <i class="pi pi-refresh"></i> Reset to Defaults
      </button>
      <button type="button" class="cfg-btn-save"
              [disabled]="saving()"
              (click)="confirmSave()">
        <i class="pi"
           [class.pi-check]="!saving()"
           [class.pi-spinner]="saving()"
           [class.pi-spin]="saving()"></i>
        Save Changes
      </button>
    </div>
  }

</div>
```

---

## 6. API Service Patterns

**Service Location:** `src/app/features/talent-flow/services/talent-flow-api.service.ts`

**Get Config:**
```typescript
getConfig(configType: ConfigType, version?: string): Observable<ConfigResponse>
```

**Update Config:**
```typescript
updateConfig(configType: ConfigType, data: unknown): Observable<ConfigResponse>
```

**ConfigResponse Structure:**
```typescript
interface ConfigResponse {
  configType: ConfigType;
  version:    string;
  isActive:   boolean;
  data:       Record<string, unknown>;
  createdAt:  string;
  updatedAt:  string;
}
```

---

## 7. Common Patterns

### Signal-Based State
```typescript
readonly loading = signal(true);
readonly saving = signal(false);
readonly configData = signal<YourType>({ ...DEFAULT_DATA });

// Updating
this.loading.set(false);
this.configData.update((current) => ({ ...current, field: newValue }));
```

### Service Injection
```typescript
private readonly api             = inject(TalentFlowApiService);
private readonly messageService  = inject(MessageService);
private readonly confirmService  = inject(ConfirmationService);
```

### Confirmation Dialogs
```typescript
confirmSave(): void {
  if (this.saving()) return;
  this.confirmService.confirm({
    message: 'Save these changes? Updated config will apply immediately.',
    header:  'Save Configuration',
    icon:    'pi pi-exclamation-triangle',
    accept:  () => this.doSave(this.configData()),
  });
}
```

### Toast Messages
```typescript
// Success
this.messageService.add({
  severity: 'success',
  summary:  'Saved',
  detail:   `Configuration saved as version ${cfg.version}.`,
  life:     4000,
});

// Error
this.messageService.add({
  severity: 'error',
  summary:  'Save Failed',
  detail:   err.userMessage ?? 'Could not save configuration.',
  life:     5000,
});
```

---

## 8. Key Takeaways

1. ✅ **Always use standalone components** with ChangeDetectionStrategy.OnPush
2. ✅ **Use Angular signals** for all component state
3. ✅ **Use inject()** for service injection (not constructor)
4. ✅ **Follow Naleko design tokens** (CSS variables from naleko-tokens.css)
5. ✅ **Use standard SCSS classes** (config-page, config-card, config-row, etc.)
6. ✅ **Include loading skeleton** with shimmer animation
7. ✅ **Include ConfigVersionBadge** in header
8. ✅ **Always confirm** before save/reset operations
9. ✅ **Add 'min-width': '0'** to InputNumber inputStyle
10. ✅ **Follow existing component structure exactly** to avoid regressions

---

**This reference ensures your new Intelligence Rules component will match the existing TalentFlow admin UI patterns precisely.**
