import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { OnboardingStage } from '../../../../shared/models/employee.model';
import { StepsModule } from 'primeng/steps';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'app-onboarding-stepper',
  standalone: true,
  imports: [StepsModule, CardModule, TagModule],
  templateUrl: './onboarding-stepper.component.html',
  styleUrl: './onboarding-stepper.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingStepperComponent {
  readonly currentStage = input<OnboardingStage>('DOCUMENTS');

  private readonly stageOrder: OnboardingStage[] = [
    'INVITED',
    'DOCUMENTS',
    'VERIFICATION_PENDING',
    'VERIFIED',
    'TRAINING',
    'ONBOARDED',
  ];

  readonly stepItems: MenuItem[] = [
    { label: 'Profile Created', icon: 'pi pi-check' },
    { label: 'Documents', icon: 'pi pi-file' },
    { label: 'Verification', icon: 'pi pi-clock' },
    { label: 'Verified', icon: 'pi pi-verified' },
    { label: 'Training', icon: 'pi pi-video' },
    { label: 'Onboarded', icon: 'pi pi-flag' },
  ];

  readonly currentIndex = computed(() => {
    return this.stageOrder.indexOf(this.currentStage());
  });

  readonly progressPercent = computed(() => {
    return Math.round((this.currentIndex() / (this.stepItems.length - 1)) * 100);
  });

  readonly currentLabel = computed(() => {
    const idx = this.currentIndex();
    return idx >= 0 && idx < this.stepItems.length ? this.stepItems[idx].label ?? '' : '';
  });
}
