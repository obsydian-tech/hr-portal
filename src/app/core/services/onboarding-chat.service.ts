import { Injectable, signal, computed } from '@angular/core';
import {
  ChatMessage,
  ChatMode,
  ChatState,
  SuggestedChip,
  MessageSender,
} from '../../shared/models/chat.model';

// ─── FAQ Knowledge Base ──────────────────────────────────────
interface FaqPattern {
  /** Exact phrases score higher than single keywords */
  phrases: string[];
  /** Individual keywords (lower weight) */
  keywords: string[];
  intent: string;
  response: string;
  /** Follow-up chips shown after this intent is matched */
  followUpChips?: SuggestedChip[];
}

const FAQ_PATTERNS: FaqPattern[] = [
  {
    phrases: ['what document', 'which document', 'required document', 'need to upload', 'what do i need'],
    keywords: ['document', 'documents', 'require', 'needed'],
    intent: 'document_types',
    response:
      'You need to upload **4 documents** for onboarding:\n\n' +
      '1. **National ID** — SA ID document or smart card\n' +
      '2. **Bank Confirmation** — Letter from your bank confirming account details\n' +
      '3. **Matric Certificate** — Your NSC or equivalent\n' +
      '4. **Tertiary Qualification** — Degree, diploma, or certificate\n\n' +
      'You can upload them in any order from the Documents step.',
    followUpChips: [
      { label: '📤 How do I upload?', value: 'How do I upload a document?' },
      { label: '❌ What if one is rejected?', value: 'What happens if a document is rejected?' },
      { label: '🔍 Verification process', value: 'How does verification work?' },
    ],
  },
  {
    phrases: ['how to upload', 'how do i upload', 'submit document', 'upload a document'],
    keywords: ['upload', 'attach', 'submit', 'send'],
    intent: 'upload_help',
    response:
      'To upload a document:\n\n' +
      '1. Accept the consent declaration on your dashboard\n' +
      '2. Click the **Upload** button next to each document type\n' +
      '3. Select a clear, readable file (PDF, JPG, or PNG)\n' +
      '4. Wait for the automated verification to complete\n\n' +
      '**Tip:** Make sure the document is not blurry or cropped — this helps the OCR process.',
    followUpChips: [
      { label: '📄 Which documents?', value: 'What documents do I need to upload?' },
      { label: '🔍 Verification status', value: 'How does verification work?' },
      { label: '❓ File too large?', value: 'What if my file is too large?' },
    ],
  },
  {
    phrases: ['how long', 'verification work', 'ocr work', 'document verification'],
    keywords: ['ocr', 'verification', 'verify', 'processing', 'pending', 'automated', 'scan'],
    intent: 'ocr_verification',
    response:
      'Each document goes through **automated OCR verification** after upload. Here\'s what happens:\n\n' +
      '• **Processing** — The system reads and extracts information (usually under 30 seconds)\n' +
      '• **Passed** — The document was verified successfully ✅\n' +
      '• **Manual Review** — HR will review it manually (usually within 1 business day)\n' +
      '• **Failed** — The document couldn\'t be read; you can re-upload a clearer version\n\n' +
      'You\'ll see the status update in real time on your dashboard.',
    followUpChips: [
      { label: '❌ Document rejected?', value: 'What happens if a document is rejected?' },
      { label: '📋 Onboarding stages', value: 'What are the onboarding stages?' },
      { label: '🗣️ Talk to HR', value: 'I want to speak to my HR partner' },
    ],
  },
  {
    phrases: ['onboarding stage', 'what stage', 'where am i', 'onboarding progress'],
    keywords: ['stage', 'onboarding', 'step', 'progress', 'status', 'phase'],
    intent: 'onboarding_stages',
    response:
      'Your onboarding has these stages:\n\n' +
      '1. **Invited** — Your profile has been created\n' +
      '2. **Documents** — You\'re uploading your required documents\n' +
      '3. **Verification Pending** — All docs uploaded, waiting for verification\n' +
      '4. **Verified** — All documents accepted ✅\n' +
      '5. **Training** — Time for orientation & training materials\n' +
      '6. **Onboarded** — You\'re all set! Welcome to the team 🎉\n\n' +
      'Your current stage is shown at the top of your dashboard.',
    followUpChips: [
      { label: '📄 What documents?', value: 'What documents do I need?' },
      { label: '📅 My start date', value: 'When is my start date?' },
      { label: '🗣️ Talk to HR', value: 'I want to speak to my HR partner' },
    ],
  },
  {
    phrases: ['document rejected', 'document failed', 'not accepted', 'rejected document', 're-upload'],
    keywords: ['reject', 'rejected', 'failed', 'declined', 'reupload', 're-upload'],
    intent: 'rejected_docs',
    response:
      'If a document was rejected or failed verification:\n\n' +
      '1. Check the status message next to the document — it explains what went wrong\n' +
      '2. Click **Re-upload** to submit a new version\n' +
      '3. Make sure the new file is clear, not cropped, and matches the required type\n\n' +
      'Common reasons for rejection:\n' +
      '• Blurry or low-resolution image\n' +
      '• Wrong document type uploaded\n' +
      '• Expired document\n\n' +
      'If you keep having issues, I can connect you to your HR partner.',
    followUpChips: [
      { label: '📤 Upload tips', value: 'How do I upload a document?' },
      { label: '🗣️ Talk to HR', value: 'I want to speak to my HR partner' },
    ],
  },
  {
    phrases: ['forgot password', 'can\'t login', 'can\'t sign in', 'password reset', 'login help'],
    keywords: ['login', 'password', 'sign in', 'credentials', 'access', 'forgot'],
    intent: 'login_help',
    response:
      'Your login credentials were sent to your email when your profile was created.\n\n' +
      '• **Username**: Your email address\n' +
      '• **Password**: A temporary password (format: `Naleko` + 7 digits + `!Emp`)\n\n' +
      'If you can\'t find your credentials or need a password reset, please contact your HR partner directly.',
    followUpChips: [
      { label: '👤 Who is my HR partner?', value: 'Who is my HR partner?' },
      { label: '🗣️ Talk to HR', value: 'I want to speak to my HR partner' },
    ],
  },
  {
    phrases: ['who is my hr', 'my hr partner', 'contact hr', 'hr person'],
    keywords: ['hr', 'partner', 'assigned', 'contact'],
    intent: 'hr_partner',
    response: 'HR_PARTNER_DYNAMIC',
    followUpChips: [
      { label: '🗣️ Chat with HR now', value: 'I want to speak to my HR partner' },
      { label: '📅 My start date', value: 'When is my start date?' },
    ],
  },
  {
    phrases: ['when do i start', 'start date', 'first day', 'join date'],
    keywords: ['start', 'starting', 'first day', 'join'],
    intent: 'start_date',
    response: 'START_DATE_DYNAMIC',
    followUpChips: [
      { label: '📋 Onboarding stages', value: 'What are the onboarding stages?' },
      { label: '👤 My HR partner', value: 'Who is my HR partner?' },
    ],
  },
  {
    phrases: ['consent declaration', 'popia consent', 'data protection', 'personal information'],
    keywords: ['consent', 'popia', 'declaration', 'privacy', 'personal information', 'data protection'],
    intent: 'consent_popia',
    response:
      'The consent declaration is required by the **Protection of Personal Information Act (POPIA)**.\n\n' +
      'By accepting, you confirm that:\n' +
      '• Your documents are authentic\n' +
      '• You consent to Naleko processing your personal information\n' +
      '• You understand automated verification will be used\n\n' +
      'This is a standard legal requirement for all new employees. Your data is handled securely.',
    followUpChips: [
      { label: '📄 What documents?', value: 'What documents do I need?' },
      { label: '📤 How to upload', value: 'How do I upload a document?' },
    ],
  },
  {
    phrases: ['file too large', 'file size', 'maximum size', 'size limit'],
    keywords: ['size', 'large', 'big', 'limit', 'mb', 'maximum'],
    intent: 'file_size',
    response:
      'Each document upload supports files up to **10 MB**.\n\n' +
      'If your file is too large:\n' +
      '• Try scanning at a lower resolution (150-300 DPI is ideal)\n' +
      '• Use a free online PDF compressor\n' +
      '• Take a clear photo with your phone instead of scanning\n\n' +
      'Supported formats: **PDF**, **JPG**, and **PNG**.',
    followUpChips: [
      { label: '📤 Upload tips', value: 'How do I upload a document?' },
      { label: '📄 Required documents', value: 'What documents do I need?' },
    ],
  },
  {
    phrases: [],
    keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'howdy', 'sup'],
    intent: 'greeting',
    response:
      'Hello! 👋 I\'m the **Naleko Onboarding Assistant**. I can help you with:\n\n' +
      '• Document uploads and requirements\n' +
      '• Verification status and stages\n' +
      '• Login and access questions\n' +
      '• Connecting you to your HR partner\n\n' +
      'What can I help you with today?',
  },
  {
    phrases: [],
    keywords: ['thank', 'thanks', 'cheers', 'appreciate', 'awesome', 'great'],
    intent: 'thanks',
    response: 'You\'re welcome! 😊 Let me know if there\'s anything else I can help with.',
  },
  {
    phrases: ['talk to human', 'speak to someone', 'real person', 'talk to hr', 'speak to hr'],
    keywords: ['escalate', 'not helpful', 'human', 'real person', 'someone'],
    intent: 'escalation_trigger',
    response: 'ESCALATION_TRIGGER',
  },
];

/** Default suggested chips for AI mode */
const AI_CHIPS: SuggestedChip[] = [
  { label: '📄 What documents do I need?', value: 'What documents do I need to upload?' },
  { label: '📤 How do I upload?', value: 'How do I upload a document?' },
  { label: '🔍 Verification status', value: 'How does document verification work?' },
  { label: '🗣️ Talk to HR', value: 'I want to speak to my HR partner' },
];

/** Chips shown after escalation */
const HR_CHIPS: SuggestedChip[] = [
  { label: '🤖 Back to AI Assistant', value: '__BACK_TO_AI__' },
  { label: '📋 My documents', value: 'Can you check the status of my documents?' },
  { label: '📅 Start date', value: 'When is my start date?' },
];

const STORAGE_KEY_PREFIX = 'naleko_chat_';

@Injectable()
export class OnboardingChatService {
  // ─── State Signals ──────────────────────────────
  private readonly _messages = signal<ChatMessage[]>([]);
  private readonly _mode = signal<ChatMode>('ai');
  private readonly _escalated = signal(false);
  private readonly _isTyping = signal(false);
  private readonly _employeeId = signal('');
  private readonly _hrPartnerName = signal('');
  private readonly _employeeName = signal('');
  private readonly _startDate = signal('');

  /** Public read-only signals */
  readonly messages = this._messages.asReadonly();
  readonly mode = this._mode.asReadonly();
  readonly escalated = this._escalated.asReadonly();
  readonly isTyping = this._isTyping.asReadonly();

  /** Computed suggested chips based on current mode */
  readonly suggestedChips = computed<SuggestedChip[]>(() =>
    this._mode() === 'hr' ? HR_CHIPS : AI_CHIPS,
  );

  /** Chat header title */
  readonly headerTitle = computed(() =>
    this._mode() === 'hr'
      ? this._hrPartnerName() || 'HR Partner'
      : 'Naleko Assistant',
  );

  /** Chat header subtitle */
  readonly headerSubtitle = computed(() =>
    this._mode() === 'hr'
      ? 'HR Support • Connected'
      : 'Onboarding Support',
  );

  readonly messageCount = computed(() => this._messages().length);

  // ─── Initialization ─────────────────────────────
  initialize(
    employeeId: string,
    employeeName: string,
    hrPartnerName: string,
    startDate: string,
  ): void {
    this._employeeId.set(employeeId);
    this._employeeName.set(employeeName);
    this._hrPartnerName.set(hrPartnerName);
    this._startDate.set(startDate);

    // Restore from localStorage
    const saved = this.loadState();
    if (saved && saved.messages.length > 0) {
      this._messages.set(saved.messages);
      this._mode.set(saved.mode);
      this._escalated.set(saved.escalated);
    } else {
      // Send welcome message
      this.addSystemMessage(
        `Hi ${employeeName}! 👋 I'm the Naleko Onboarding Assistant. I can help with document uploads, verification status, and more. What can I help you with?`,
      );
    }
  }

  // ─── Message Handling ───────────────────────────
  sendMessage(text: string): void {
    if (!text.trim()) return;

    // Special chip actions
    if (text === '__BACK_TO_AI__') {
      this.switchToAI();
      return;
    }

    // Add user message
    this.addMessage('user', text);

    if (this._mode() === 'hr') {
      // In HR mode — simulate HR response
      this.simulateHRResponse(text);
    } else {
      // In AI mode — match FAQ
      this.getAIResponse(text);
    }
  }

  escalateToHR(): void {
    this._escalated.set(true);
    this._mode.set('hr');

    this.addMessage(
      'system',
      `Connecting you to **${this._hrPartnerName() || 'your HR partner'}**...`,
    );

    // Simulate connection delay
    this._isTyping.set(true);
    setTimeout(() => {
      this._isTyping.set(false);
      this.addMessage(
        'hr',
        `Hi ${this._employeeName()}! This is ${this._hrPartnerName() || 'your HR partner'}. How can I help you with your onboarding?`,
      );
      this.persistState();
    }, 2000);
  }

  clearChat(): void {
    this._messages.set([]);
    this._mode.set('ai');
    this._escalated.set(false);
    this._isTyping.set(false);
    this.removeState();

    // Re-send welcome
    const name = this._employeeName();
    this.addSystemMessage(
      `Hi ${name}! 👋 I'm the Naleko Onboarding Assistant. I can help with document uploads, verification status, and more. What can I help you with?`,
    );
  }

  // ─── Private Helpers ────────────────────────────
  private switchToAI(): void {
    this._mode.set('ai');
    this.addMessage(
      'system',
      'You\'re now chatting with the **Naleko Assistant** again. How can I help?',
    );
  }

  private getAIResponse(userText: string): void {
    const lower = userText.toLowerCase();

    // Find the best matching FAQ pattern
    let bestMatch: FaqPattern | null = null;
    let bestScore = 0;

    for (const pattern of FAQ_PATTERNS) {
      const score = pattern.keywords.filter((kw) => lower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    this._isTyping.set(true);

    // Simulate typing delay (300-800ms)
    const delay = 400 + Math.random() * 400;
    setTimeout(() => {
      this._isTyping.set(false);

      if (bestMatch && bestScore > 0) {
        // Handle special dynamic responses
        if (bestMatch.intent === 'escalation_trigger') {
          this.addMessage(
            'ai',
            'I\'ll connect you with your HR partner right away.',
            'escalation_trigger',
          );
          setTimeout(() => this.escalateToHR(), 500);
          return;
        }

        let response = bestMatch.response;

        // Dynamic replacements
        if (bestMatch.intent === 'hr_partner') {
          const name = this._hrPartnerName() || 'your assigned HR partner';
          response =
            `Your HR partner is **${name}**. They're responsible for guiding you through onboarding.\n\n` +
            'If you\'d like to chat with them directly, just say "talk to HR" and I\'ll connect you.';
        }

        if (bestMatch.intent === 'start_date') {
          const date = this._startDate();
          response = date
            ? `Your planned start date is **${date}**. Make sure all your documents are uploaded and verified before then!\n\nIf you have questions about your first day, your HR partner can help.`
            : 'I don\'t have your start date on file yet. Your HR partner will confirm it once your onboarding is complete. Want me to connect you to them?';
        }

        this.addMessage('ai', response, bestMatch.intent);
      } else {
        // Fallback response
        this.addMessage(
          'ai',
          'I\'m not sure I understand that question. Here are some things I can help with:\n\n' +
            '• Document requirements and upload help\n' +
            '• Verification status and onboarding stages\n' +
            '• Login and access questions\n' +
            '• Connecting you to your HR partner\n\n' +
            'Try asking about one of these, or say **"talk to HR"** to speak with a real person.',
          'fallback',
        );
      }
      this.persistState();
    }, delay);
  }

  private simulateHRResponse(userText: string): void {
    this._isTyping.set(true);

    // Simulate longer HR response time (2-4s)
    const delay = 2000 + Math.random() * 2000;
    setTimeout(() => {
      this._isTyping.set(false);
      this.addMessage(
        'hr',
        `Thanks for your message. I've noted your question about "${userText.substring(0, 50)}${userText.length > 50 ? '...' : ''}". I'll look into this and get back to you shortly. In the meantime, is there anything else I can help with?`,
      );
      this.persistState();
    }, delay);
  }

  private addMessage(sender: MessageSender, text: string, intent?: string): void {
    const message: ChatMessage = {
      id: this.generateId(),
      sender,
      text,
      timestamp: Date.now(),
      intent,
    };
    this._messages.update((msgs) => [...msgs, message]);
    this.persistState();
  }

  private addSystemMessage(text: string): void {
    this.addMessage('system', text);
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ─── localStorage Persistence ───────────────────
  private get storageKey(): string {
    return `${STORAGE_KEY_PREFIX}${this._employeeId()}`;
  }

  private persistState(): void {
    try {
      const state: ChatState = {
        employeeId: this._employeeId(),
        mode: this._mode(),
        messages: this._messages(),
        escalated: this._escalated(),
        lastActivity: Date.now(),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable — silently fail
    }
  }

  private loadState(): ChatState | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as ChatState;
    } catch {
      return null;
    }
  }

  private removeState(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Ignore
    }
  }
}
