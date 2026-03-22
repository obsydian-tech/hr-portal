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

  private readonly stageGuidanceMap: Record<OnboardingStage, { icon: string; title: string; description: string; action: string }> = {
    INVITED: {
      icon: 'pi pi-check-circle',
      title: 'Profile Created',
      description: 'Your profile has been set up by the HR team.',
      action: 'No action needed — you\'re all set for this step!',
    },
    DOCUMENTS: {
      icon: 'pi pi-upload',
      title: 'Upload Your Documents',
      description: 'We need your ID, bank confirmation, and certificates to proceed with your onboarding.',
      action: 'Upload all 4 required documents below. Once submitted, they\'ll be sent for verification.',
    },
    VERIFICATION_PENDING: {
      icon: 'pi pi-clock',
      title: 'Documents Under Review',
      description: 'Your documents are being reviewed by our HR team and verification partners.',
      action: 'Sit tight — we\'ll notify you once all documents have been verified.',
    },
    VERIFIED: {
      icon: 'pi pi-verified',
      title: 'Documents Verified',
      description: 'All your documents have been successfully verified!',
      action: 'No action needed — your HR partner will schedule your training next.',
    },
    TRAINING: {
      icon: 'pi pi-play',
      title: 'Complete Your Training',
      description: 'Your onboarding training modules are now available.',
      action: 'Complete all assigned training videos to finalize your onboarding.',
    },
    ONBOARDED: {
      icon: 'pi pi-star',
      title: 'Welcome Aboard!',
      description: 'You\'ve completed all onboarding steps. Welcome to the team!',
      action: 'You\'re all done! Reach out to your HR partner if you have any questions.',
    },
  };

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

  readonly guidance = computed(() => {
    return this.stageGuidanceMap[this.currentStage()];
  });

  /** Returns the status of a given step index relative to the current stage */
  stepStatus(stepIndex: number): 'completed' | 'active' | 'upcoming' {
    const current = this.currentIndex();
    if (stepIndex < current) return 'completed';
    if (stepIndex === current) return 'active';
    return 'upcoming';
  }

  /** Guidance for a specific step (used in the step list below the stepper) */
  stepGuidance(stepIndex: number): { icon: string; title: string; description: string } {
    const stage = this.stageOrder[stepIndex];
    const g = this.stageGuidanceMap[stage];
    return { icon: g.icon, title: g.title, description: g.description };
  }
}
