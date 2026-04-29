import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { OnboardingStage } from '../../../../shared/models/employee.model';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';

@Component({
  selector: 'app-onboarding-stepper',
  standalone: true,
  imports: [CardModule, TagModule],
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

  readonly steps = [
    { label: 'Profile Created' },
    { label: 'Documents' },
    { label: 'Verification' },
    { label: 'Verified' },
    { label: 'Training' },
    { label: 'Onboarded' },
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
    const idx = this.stageOrder.indexOf(this.currentStage());
    return idx >= 0 ? idx : 0; // Fallback to first step if stage is unrecognised
  });

  readonly progressPercent = computed(() => {
    const idx = this.currentIndex();
    const total = this.steps.length - 1;
    if (total <= 0) return 0;
    return Math.round((idx / total) * 100);
  });

  readonly currentLabel = computed(() => {
    const idx = this.currentIndex();
    return idx >= 0 && idx < this.steps.length ? this.steps[idx].label ?? '' : '';
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

  /** Connector status between steps */
  connectorStatus(index: number): 'completed' | 'upcoming' {
    const current = this.currentIndex();
    if (index < current) return 'completed';
    return 'upcoming';
  }

  /** Guidance for a specific step (used in the step list below the stepper) */
  stepGuidance(stepIndex: number): { icon: string; title: string; description: string } {
    const stage = this.stageOrder[stepIndex];
    const g = this.stageGuidanceMap[stage];
    return { icon: g.icon, title: g.title, description: g.description };
  }
}
