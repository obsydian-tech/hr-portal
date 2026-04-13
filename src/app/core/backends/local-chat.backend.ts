import { Injectable } from '@angular/core';
import {
  ChatState,
  SuggestedChip,
} from '../../shared/models/chat.model';
import {
  EmployeeChatBackend,
  ChatBackendContext,
  AiResponse,
  HrResponse,
} from './chat-backend.interface';

// ═══════════════════════════════════════════════════════════
//  LOCAL CHAT BACKEND
//  FAQ weighted matching + localStorage persistence
//  Swap this with ApiChatBackend when the real API is ready.
// ═══════════════════════════════════════════════════════════

// ─── FAQ Knowledge Base ──────────────────────────────────────
interface FaqPattern {
  phrases: string[];
  keywords: string[];
  intent: string;
  response: string;
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

/** Default suggested chips — AI mode */
const DEFAULT_AI_CHIPS: SuggestedChip[] = [
  { label: '📄 What documents do I need?', value: 'What documents do I need to upload?' },
  { label: '📤 How do I upload?', value: 'How do I upload a document?' },
  { label: '🔍 Verification status', value: 'How does document verification work?' },
  { label: '🗣️ Talk to HR', value: 'I want to speak to my HR partner' },
];

/** Chips shown during HR escalation */
const HR_CHIPS: SuggestedChip[] = [
  { label: '🤖 Back to AI Assistant', value: '__BACK_TO_AI__' },
  { label: '📋 My documents', value: 'Can you check the status of my documents?' },
  { label: '📅 Start date', value: 'When is my start date?' },
  { label: '🔑 Login help', value: 'I need help with my login credentials' },
];

// ─── HR Mock Response Templates ──────────────────────────────
interface HrResponseTemplate {
  keywords: string[];
  responses: string[];
}

const HR_RESPONSE_TEMPLATES: HrResponseTemplate[] = [
  {
    keywords: ['document', 'upload', 'file', 'submit'],
    responses: [
      'I can see your document submissions on my end. Let me pull up the details and get back to you within the hour.',
      'Thanks for asking! I\'ll check the status of your documents now. Give me a moment to review everything.',
      'I\'ve got your documents in front of me. Let me verify the details and I\'ll update you shortly.',
    ],
  },
  {
    keywords: ['start', 'date', 'first day', 'begin', 'join'],
    responses: [
      'Great question! Let me confirm your start date with the team and loop back to you today.',
      'I\'ll double-check your planned start date and send you all the first-day details by end of day.',
      'Your start date should be confirmed in your offer letter. Let me verify and get back to you with the exact details.',
    ],
  },
  {
    keywords: ['password', 'login', 'access', 'credential', 'sign in'],
    responses: [
      'I\'ll reset your credentials now. Please check your email in the next 5-10 minutes for a new temporary password.',
      'Let me look into your access issues. I\'ll have this sorted out for you shortly — check your inbox soon.',
      'Access issues can be frustrating! I\'m escalating this to our IT team and you should hear back within the hour.',
    ],
  },
  {
    keywords: ['reject', 'failed', 'problem', 'issue', 'error', 'wrong'],
    responses: [
      'I\'m sorry about that issue. Let me review what happened and guide you through resolving it. Can you tell me which document is affected?',
      'No worries, these things happen. I\'m looking into it now and I\'ll make sure we get it sorted for you.',
      'I understand that must be frustrating. Let me check the verification details and I\'ll follow up with specific guidance.',
    ],
  },
];

const HR_GENERIC_RESPONSES = [
  'Thanks for reaching out! I\'ve noted your question and I\'m looking into it. I\'ll get back to you shortly with an update.',
  'I appreciate you letting me know. Let me review the details and follow up with you within the hour.',
  'Got it! I\'ll investigate this and provide you with a thorough response. Is there anything else in the meantime?',
  'Thank you for your patience. I\'m working on this now and will have an answer for you soon.',
];

const STORAGE_KEY_PREFIX = 'naleko_chat_';

// ─── Implementation ──────────────────────────────────────────

@Injectable()
export class LocalChatBackend extends EmployeeChatBackend {
  /** Tracks consecutive fallback count — offer escalation after 2 */
  private consecutiveFallbacks = 0;

  // ─── AI Response (Weighted FAQ Matching) ─────────
  async getAiResponse(
    userText: string,
    context: ChatBackendContext,
  ): Promise<AiResponse> {
    const lower = userText.toLowerCase();

    let bestMatch: FaqPattern | null = null;
    let bestScore = 0;

    for (const pattern of FAQ_PATTERNS) {
      let score = 0;
      score += pattern.phrases.filter((p) => lower.includes(p)).length * 3;
      score += pattern.keywords.filter((kw) => lower.includes(kw)).length;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    if (bestMatch && bestScore > 0) {
      this.consecutiveFallbacks = 0;

      // Escalation trigger
      if (bestMatch.intent === 'escalation_trigger') {
        return {
          text: `No problem! I'll connect you with **${context.hrPartnerName || 'your HR partner'}** right away.`,
          intent: 'escalation_trigger',
          shouldEscalate: true,
        };
      }

      let response = bestMatch.response;

      // Dynamic replacements
      if (bestMatch.intent === 'hr_partner') {
        const name = context.hrPartnerName || 'your assigned HR partner';
        response =
          `Your HR partner is **${name}**. They're responsible for guiding you through onboarding.\n\n` +
          'If you\'d like to chat with them directly, just say **"talk to HR"** and I\'ll connect you.';
      }

      if (bestMatch.intent === 'start_date') {
        const date = context.startDate;
        response = date
          ? `Your planned start date is **${date}**. Make sure all your documents are uploaded and verified before then!\n\nIf you have questions about your first day, your HR partner can help.`
          : 'I don\'t have your start date on file yet. Your HR partner will confirm it once your onboarding is complete.\n\nWant me to connect you to them?';
      }

      return {
        text: response,
        intent: bestMatch.intent,
        followUpChips: bestMatch.followUpChips,
      };
    }

    // Fallback
    this.consecutiveFallbacks++;

    let fallbackText: string;
    if (this.consecutiveFallbacks >= 2) {
      fallbackText =
        'I\'m having trouble understanding your question. It might be best to connect you with your HR partner who can help directly.\n\n' +
        'Would you like me to connect you? Just say **"talk to HR"** or use the chip below.';
    } else {
      fallbackText =
        'I\'m not sure I understand that question. Here are some things I can help with:\n\n' +
        '• Document requirements and upload help\n' +
        '• Verification status and onboarding stages\n' +
        '• Login and access questions\n' +
        '• Connecting you to your HR partner\n\n' +
        'Try asking about one of these, or say **"talk to HR"** to speak with a real person.';
    }

    return {
      text: fallbackText,
      intent: 'fallback',
    };
  }

  // ─── HR Response (Template Matching) ─────────────
  async getHrResponse(
    userText: string,
    _context: ChatBackendContext,
  ): Promise<HrResponse> {
    const lower = userText.toLowerCase();

    for (const template of HR_RESPONSE_TEMPLATES) {
      if (template.keywords.some((kw) => lower.includes(kw))) {
        const text =
          template.responses[
            Math.floor(Math.random() * template.responses.length)
          ];
        return { text };
      }
    }

    return {
      text: HR_GENERIC_RESPONSES[
        Math.floor(Math.random() * HR_GENERIC_RESPONSES.length)
      ],
    };
  }

  // ─── Persistence (localStorage) ──────────────────
  async saveState(state: ChatState): Promise<void> {
    try {
      const key = `${STORAGE_KEY_PREFIX}${state.employeeId}`;
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable — silently fail
    }
  }

  async loadState(employeeId: string): Promise<ChatState | null> {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${employeeId}`);
      if (!raw) return null;
      return JSON.parse(raw) as ChatState;
    } catch {
      return null;
    }
  }

  async clearState(employeeId: string): Promise<void> {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${employeeId}`);
    } catch {
      // Ignore
    }
    this.consecutiveFallbacks = 0;
  }

  // ─── Chips ───────────────────────────────────────
  getDefaultAiChips(): SuggestedChip[] {
    return DEFAULT_AI_CHIPS;
  }

  getHrChips(): SuggestedChip[] {
    return HR_CHIPS;
  }

  // ─── Context Reset ──────────────────────────────
  resetConversation(): void {
    this.consecutiveFallbacks = 0;
  }
}
