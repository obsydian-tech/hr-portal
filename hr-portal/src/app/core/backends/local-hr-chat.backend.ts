import { Injectable } from '@angular/core';
import { Observable, EMPTY } from 'rxjs';
import {
  ChatMessage,
  ChatConversation,
  ConversationStatus,
  ConversationPriority,
  MessageSender,
} from '../../shared/models/chat.model';
import { HrChatBackend } from './chat-backend.interface';

// ═══════════════════════════════════════════════════════════
//  LOCAL HR CHAT BACKEND
//  Mock conversations + in-memory operations.
//  Swap this with ApiHrChatBackend when the real API is ready.
// ═══════════════════════════════════════════════════════════

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function ts(minutesAgo: number): number {
  return Date.now() - minutesAgo * 60_000;
}

function buildMockConversations(_hrStaffId: string): ChatConversation[] {
  return [
    {
      employeeId: 'EMP-8291034',
      employeeName: 'Katlego Modise',
      employeeEmail: 'katlego.modise@gmail.com',
      department: 'Engineering',
      stage: 'DOCUMENTS',
      escalated: true,
      lastActivity: ts(3),
      status: 'active',
      priority: 'high',
      unreadCount: 2,
      messages: [
        { id: generateId(), sender: 'system', text: 'Hi Katlego! 👋 I\'m the Naleko Onboarding Assistant.', timestamp: ts(45) },
        { id: generateId(), sender: 'user', text: 'How do I upload my bank confirmation?', timestamp: ts(42) },
        { id: generateId(), sender: 'ai', text: 'To upload a document:\n\n1. Accept the consent declaration\n2. Click the **Upload** button next to Bank Confirmation\n3. Select a clear, readable file (PDF, JPG, or PNG)\n4. Wait for verification\n\n**Tip:** Make sure the document is not blurry.', timestamp: ts(42), intent: 'upload_help' },
        { id: generateId(), sender: 'user', text: 'I keep getting an error when I upload. It says processing failed.', timestamp: ts(30) },
        { id: generateId(), sender: 'ai', text: 'I\'m not sure I understand that question. Here are some things I can help with:\n\n• Document requirements and upload help\n• Verification status and onboarding stages\n• Login and access questions\n\nTry asking about one of these, or say **"talk to HR"** to speak with a real person.', timestamp: ts(30), intent: 'fallback' },
        { id: generateId(), sender: 'user', text: 'I want to speak to my HR partner', timestamp: ts(25) },
        { id: generateId(), sender: 'ai', text: 'No problem! I\'ll connect you with **your HR partner** right away.', timestamp: ts(25), intent: 'escalation_trigger' },
        { id: generateId(), sender: 'system', text: 'Connecting you to **your HR partner**...', timestamp: ts(24) },
        { id: generateId(), sender: 'hr', text: 'Hi Katlego! 👋 I can see you\'re having trouble with bank confirmation upload. Let me look into it.', timestamp: ts(23) },
        { id: generateId(), sender: 'user', text: 'Yes, every time I try to upload my FNB letter it fails after processing.', timestamp: ts(8) },
        { id: generateId(), sender: 'user', text: 'Can you help? I need to get this sorted before my start date.', timestamp: ts(3) },
      ],
    },
    {
      employeeId: 'EMP-5517823',
      employeeName: 'Zanele Nkosi',
      employeeEmail: 'zanele.nkosi@outlook.com',
      department: 'Marketing',
      stage: 'VERIFICATION_PENDING',
      escalated: true,
      lastActivity: ts(18),
      status: 'waiting',
      priority: 'medium',
      unreadCount: 1,
      messages: [
        { id: generateId(), sender: 'system', text: 'Hi Zanele! 👋 I\'m the Naleko Onboarding Assistant.', timestamp: ts(120) },
        { id: generateId(), sender: 'user', text: 'When is my start date?', timestamp: ts(115) },
        { id: generateId(), sender: 'ai', text: 'Your planned start date is **5 May 2026**. Make sure all your documents are uploaded and verified before then!', timestamp: ts(115), intent: 'start_date' },
        { id: generateId(), sender: 'user', text: 'My ID document verification has been pending for 3 days. Is that normal?', timestamp: ts(60) },
        { id: generateId(), sender: 'ai', text: 'I\'m having trouble understanding your question. It might be best to connect you with your HR partner who can help directly.', timestamp: ts(60), intent: 'fallback' },
        { id: generateId(), sender: 'user', text: 'Talk to HR', timestamp: ts(55) },
        { id: generateId(), sender: 'system', text: 'Connecting you to **your HR partner**...', timestamp: ts(54) },
        { id: generateId(), sender: 'hr', text: 'Hi Zanele! Let me check your verification status. Sometimes manual review takes a bit longer — I\'ll expedite it.', timestamp: ts(50) },
        { id: generateId(), sender: 'user', text: 'Thank you! Please let me know when it\'s resolved.', timestamp: ts(18) },
      ],
    },
    {
      employeeId: 'EMP-3349102',
      employeeName: 'Bongani Mthethwa',
      employeeEmail: 'bongani.m@yahoo.com',
      department: 'Finance',
      stage: 'DOCUMENTS',
      escalated: true,
      lastActivity: ts(65),
      status: 'resolved',
      priority: 'low',
      unreadCount: 0,
      messages: [
        { id: generateId(), sender: 'system', text: 'Hi Bongani! 👋 I\'m the Naleko Onboarding Assistant.', timestamp: ts(200) },
        { id: generateId(), sender: 'user', text: 'I can\'t login to the portal', timestamp: ts(195) },
        { id: generateId(), sender: 'ai', text: 'Your login credentials were sent to your email when your profile was created.\n\n• **Username**: Your email address\n• **Password**: A temporary password\n\nIf you can\'t find your credentials, please contact your HR partner.', timestamp: ts(195), intent: 'login_help' },
        { id: generateId(), sender: 'user', text: 'I never received the email. Can I talk to HR?', timestamp: ts(190) },
        { id: generateId(), sender: 'system', text: 'Connecting you to **your HR partner**...', timestamp: ts(189) },
        { id: generateId(), sender: 'hr', text: 'Hi Bongani! Let me resend your credentials. Check your inbox in the next 5-10 minutes.', timestamp: ts(185) },
        { id: generateId(), sender: 'user', text: 'Got it now, thanks so much!', timestamp: ts(70) },
        { id: generateId(), sender: 'hr', text: 'Great to hear! 🎉 Let me know if you need anything else. Happy onboarding!', timestamp: ts(65) },
      ],
    },
    {
      employeeId: 'EMP-7783901',
      employeeName: 'Amahle Dlamini',
      employeeEmail: 'amahle.d@gmail.com',
      department: 'Operations',
      stage: 'INVITED',
      escalated: true,
      lastActivity: ts(120),
      status: 'waiting',
      priority: 'medium',
      unreadCount: 1,
      messages: [
        { id: generateId(), sender: 'system', text: 'Hi Amahle! 👋 I\'m the Naleko Onboarding Assistant.', timestamp: ts(300) },
        { id: generateId(), sender: 'user', text: 'What documents do I need to upload?', timestamp: ts(295) },
        { id: generateId(), sender: 'ai', text: 'You need to upload **4 documents** for onboarding:\n\n1. **National ID**\n2. **Bank Confirmation**\n3. **Matric Certificate**\n4. **Tertiary Qualification**', timestamp: ts(295), intent: 'document_types' },
        { id: generateId(), sender: 'user', text: 'I don\'t have a tertiary qualification. I only finished matric. What do I do?', timestamp: ts(250) },
        { id: generateId(), sender: 'ai', text: 'I\'m not sure I understand that question. Would you like me to connect you with your HR partner?', timestamp: ts(250), intent: 'fallback' },
        { id: generateId(), sender: 'user', text: 'Yes please, talk to HR', timestamp: ts(245) },
        { id: generateId(), sender: 'system', text: 'Connecting you to **your HR partner**...', timestamp: ts(244) },
        { id: generateId(), sender: 'hr', text: 'Hi Amahle! Great question. If you don\'t have a tertiary qualification, we can accept a highest NQF level certificate or a skills training certificate instead. Let me update the requirements for your profile.', timestamp: ts(240) },
        { id: generateId(), sender: 'user', text: 'Okay, I have an N4 certificate from college. Will that work?', timestamp: ts(120) },
      ],
    },
    {
      employeeId: 'EMP-9921456',
      employeeName: 'Thabo Ndlovu',
      employeeEmail: 'thabo.ndlovu@live.co.za',
      department: 'Engineering',
      stage: 'DOCUMENTS',
      escalated: false,
      lastActivity: ts(180),
      status: 'active',
      priority: 'low',
      unreadCount: 0,
      messages: [
        { id: generateId(), sender: 'system', text: 'Hi Thabo! 👋 I\'m the Naleko Onboarding Assistant.', timestamp: ts(200) },
        { id: generateId(), sender: 'user', text: 'How does the verification process work?', timestamp: ts(195) },
        { id: generateId(), sender: 'ai', text: 'Each document goes through **automated OCR verification** after upload.\n\n• **Processing** — 30 seconds\n• **Passed** — Verified ✅\n• **Manual Review** — HR review within 1 business day\n• **Failed** — Re-upload needed', timestamp: ts(195), intent: 'ocr_verification' },
        { id: generateId(), sender: 'user', text: 'Thanks!', timestamp: ts(180) },
        { id: generateId(), sender: 'ai', text: 'You\'re welcome! 😊 Let me know if there\'s anything else I can help with.', timestamp: ts(180), intent: 'thanks' },
      ],
    },
  ];
}

@Injectable()
export class LocalHrChatBackend extends HrChatBackend {
  async getConversations(hrStaffId: string): Promise<ChatConversation[]> {
    return buildMockConversations(hrStaffId);
  }

  async sendReply(
    employeeId: string,
    text: string,
    _hrStaffId: string,
  ): Promise<ChatMessage> {
    return {
      id: generateId(),
      sender: 'hr' as MessageSender,
      text: text.trim(),
      timestamp: Date.now(),
    };
  }

  async updateStatus(
    _employeeId: string,
    _status: ConversationStatus,
  ): Promise<void> {
    // Local backend: no-op — service handles in-memory state.
    // API backend would PATCH /api/conversations/:employeeId
  }

  onNewMessage$(_hrStaffId: string): Observable<{
    employeeId: string;
    message: ChatMessage;
  }> {
    // No real-time in local mode.
    // API backend would return a WebSocket observable.
    return EMPTY;
  }
}
