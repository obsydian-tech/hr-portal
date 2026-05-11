/**
 * NH-58: Unit tests for AiModeService
 *
 * Coverage:
 *  - runTemplate()      — happy path, HITL PENDING_APPROVAL branch, error branch
 *  - confirmHitlAction() — success + auto–risk-assessment, no-id guard, error branch
 *  - cancelHitlAction()
 *  - getScreenContext()  — EMPLOYEE_DETAIL, VERIFICATIONS_LIST, HR_DASHBOARD
 *  - resetToGallery() / selectTemplate()
 */

import { TestBed } from '@angular/core/testing';
import {
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';

import { AiModeService } from './ai-mode.service';
import { AI_TEMPLATES, AiChatResponse } from '../models/ai-chat.model';

// ─── helpers ─────────────────────────────────────────────────────────────────

const AGENT_URL = 'https://fou21cj8tj.execute-api.af-south-1.amazonaws.com';
const EMPLOYEES_BASE_URL = 'https://ndksa9ec0k.execute-api.af-south-1.amazonaws.com';
const AI_CHAT_URL = `${AGENT_URL}/agent/v1/ai-chat`;
// confirmEndpoint from Lambda is /v1/employees (employees API, Cognito JWT)
const EMPLOYEES_URL = `${EMPLOYEES_BASE_URL}/v1/employees`;

function makeCompleteResponse(overrides: Partial<AiChatResponse> = {}): AiChatResponse {
  return {
    status: 'COMPLETE',
    message: 'Done',
    toolCallsMade: [],
    conversationId: 'c1',
    guardrailAction: 'NONE',
    ...overrides,
  };
}

function makePendingResponse(): AiChatResponse {
  return {
    status: 'PENDING_APPROVAL',
    message: 'Please review the employee draft.',
    toolCallsMade: [],
    conversationId: 'c2',
    guardrailAction: 'NONE',
    pendingAction: {
      type: 'CREATE_EMPLOYEE',
      draft: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', department: 'IT', role: 'Engineer' },
      confirmEndpoint: '/v1/employees',
    },
  };
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('AiModeService', () => {
  let service: AiModeService;
  let httpMock: HttpTestingController;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    routerSpy = jasmine.createSpyObj('Router', [], { url: '/hr/staff-1/dashboard' });

    TestBed.configureTestingModule({
      providers: [
        AiModeService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: Router, useValue: routerSpy },
        // Stub AuthService — auto-attached by authInterceptor; not needed here
        { provide: 'AuthService', useValue: {} },
      ],
    });

    service = TestBed.inject(AiModeService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ── panel control ──────────────────────────────────────────────────────────

  it('should open and close the panel', () => {
    expect(service.panelVisible()).toBeFalse();
    service.openPanel();
    expect(service.panelVisible()).toBeTrue();
    service.closePanel();
    expect(service.panelVisible()).toBeFalse();
  });

  // ── selectTemplate / resetToGallery ───────────────────────────────────────

  it('selectTemplate should reset conversation state', () => {
    const tpl = AI_TEMPLATES[0];
    service.conversationHistory.set([{ role: 'assistant', content: 'hi' }]);
    service.errorMessage.set('error');
    service.selectTemplate(tpl);
    expect(service.activeTemplate()).toBe(tpl);
    expect(service.conversationHistory()).toEqual([]);
    expect(service.errorMessage()).toBeNull();
    expect(service.pendingAction()).toBeNull();
  });

  it('resetToGallery should clear all state', () => {
    service.activeTemplate.set(AI_TEMPLATES[0]);
    service.pendingAction.set({ type: 'CREATE_EMPLOYEE', draft: {}, confirmEndpoint: '/test' });
    service.resetToGallery();
    expect(service.activeTemplate()).toBeNull();
    expect(service.pendingAction()).toBeNull();
  });

  // ── runTemplate — happy path ───────────────────────────────────────────────

  it('runTemplate should POST and set conversationHistory on COMPLETE', () => {
    service.activeTemplate.set(AI_TEMPLATES.find(t => t.id === 'risk_assessment')!);
    service.slotValues.set({ employeeId: 'EMP-001' });

    service.runTemplate();
    expect(service.isLoading()).toBeTrue();

    const req = httpMock.expectOne(AI_CHAT_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.templateId).toBe('risk_assessment');
    req.flush(makeCompleteResponse({ message: 'Risk: LOW' }));

    expect(service.isLoading()).toBeFalse();
    const last = service.conversationHistory().at(-1);
    expect(last?.content).toBe('Risk: LOW');
    expect(service.canFollowUp()).toBeTrue();
    expect(service.pendingAction()).toBeNull();
  });

  it('runTemplate should set pendingAction on PENDING_APPROVAL', () => {
    service.activeTemplate.set(AI_TEMPLATES.find(t => t.id === 'onboard_employee')!);

    service.runTemplate();

    const req = httpMock.expectOne(AI_CHAT_URL);
    req.flush(makePendingResponse());

    expect(service.isLoading()).toBeFalse();
    expect(service.pendingAction()).toBeTruthy();
    expect(service.pendingAction()!.type).toBe('CREATE_EMPLOYEE');
    expect(service.canFollowUp()).toBeFalse();
  });

  it('runTemplate should set errorMessage on HTTP error', () => {
    service.activeTemplate.set(AI_TEMPLATES[0]);

    service.runTemplate();

    const req = httpMock.expectOne(AI_CHAT_URL);
    req.flush({ error: 'bad' }, { status: 500, statusText: 'Server Error' });

    expect(service.isLoading()).toBeFalse();
    expect(service.errorMessage()).toContain('Something went wrong');
  });

  it('runTemplate should do nothing if no activeTemplate', () => {
    service.activeTemplate.set(null);
    service.runTemplate();
    httpMock.expectNone(AI_CHAT_URL);
  });

  // ── confirmHitlAction ─────────────────────────────────────────────────────

  it('confirmHitlAction should POST draft, show success message and set canFollowUp', () => {
    const pending = makePendingResponse().pendingAction!;
    service.pendingAction.set(pending);

    service.confirmHitlAction();
    expect(service.isLoading()).toBeTrue();
    expect(service.pendingAction()).toBeNull();

    const createReq = httpMock.expectOne(EMPLOYEES_URL);
    expect(createReq.request.method).toBe('POST');
    createReq.flush({ employee: { employee_id: 'UUID-123' } });

    expect(service.isLoading()).toBeFalse();
    expect(service.canFollowUp()).toBeTrue();
    // No second HTTP call — risk assessment is not auto-run
    httpMock.expectNone(AI_CHAT_URL);

    const creationMsg = service.conversationHistory().find(t => t.content.includes('UUID-123'));
    expect(creationMsg).toBeTruthy();
  });

  it('confirmHitlAction should handle response without employeeId gracefully', () => {
    service.pendingAction.set({ type: 'CREATE_EMPLOYEE', draft: {}, confirmEndpoint: '/v1/employees' });

    service.confirmHitlAction();

    const req = httpMock.expectOne(EMPLOYEES_URL);
    req.flush({ employee: {} }); // no employee_id

    expect(service.isLoading()).toBeFalse();
    expect(service.canFollowUp()).toBeTrue();
    httpMock.expectNone(AI_CHAT_URL);
  });

  it('confirmHitlAction should set errorMessage on create failure', () => {
    service.pendingAction.set({ type: 'CREATE_EMPLOYEE', draft: {}, confirmEndpoint: '/v1/employees' });

    service.confirmHitlAction();

    const req = httpMock.expectOne(EMPLOYEES_URL);
    req.flush({ error: 'fail' }, { status: 400, statusText: 'Bad Request' });

    expect(service.isLoading()).toBeFalse();
    expect(service.errorMessage()).toContain('Failed to create');
  });

  it('confirmHitlAction should do nothing if no pendingAction', () => {
    service.pendingAction.set(null);
    service.confirmHitlAction();
    httpMock.expectNone(EMPLOYEES_URL);
  });

  // ── cancelHitlAction ──────────────────────────────────────────────────────

  it('cancelHitlAction should clear pendingAction and add cancelled message', () => {
    service.pendingAction.set({ type: 'CREATE_EMPLOYEE', draft: {}, confirmEndpoint: '/test' });
    service.cancelHitlAction();
    expect(service.pendingAction()).toBeNull();
    expect(service.canFollowUp()).toBeTrue();
    const last = service.conversationHistory().at(-1);
    expect(last?.content).toContain('cancelled');
  });

  // ── getScreenContext ───────────────────────────────────────────────────────

  it('getScreenContext returns EMPLOYEE_DETAIL when URL contains /employee/<id>', () => {
    Object.defineProperty(routerSpy, 'url', { get: () => '/hr/staff-1/employee/EMP-007', configurable: true });
    const ctx = service.getScreenContext();
    expect(ctx.view).toBe('EMPLOYEE_DETAIL');
    expect(ctx.employeeId).toBe('EMP-007');
  });

  it('getScreenContext returns VERIFICATIONS_LIST when URL contains /verifications', () => {
    Object.defineProperty(routerSpy, 'url', { get: () => '/hr/staff-1/verifications', configurable: true });
    expect(service.getScreenContext().view).toBe('VERIFICATIONS_LIST');
  });

  it('getScreenContext returns HR_DASHBOARD for other URLs', () => {
    Object.defineProperty(routerSpy, 'url', { get: () => '/hr/staff-1/dashboard', configurable: true });
    expect(service.getScreenContext().view).toBe('HR_DASHBOARD');
  });
});
