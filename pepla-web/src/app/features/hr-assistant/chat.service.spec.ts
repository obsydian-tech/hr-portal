import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, type SignedInUser } from '../../core/auth/auth.service';
import { ChatService } from './chat.service';

const person = (sub: string, fullName: string): SignedInUser => ({ sub, email: `${sub}@example.test`, givenName: fullName, familyName: '', fullName, groups: ['hr_staff'] });

describe('ChatService and who is signed in', () => {
  it('shows the next person nothing of the last person’s chat, whichever way the session ended', async () => {
    const user = signal<SignedInUser | null>(person('a', 'Alice'));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user, idToken: async () => 'token' } }],
    });
    const chat = TestBed.inject(ChatService);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();

    const asking = chat.ask('Who is on leave?');
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne((r) => r.url.endsWith('/agent/v1/ai-chat')).flush({ message: 'Nobody.', proposals: [{ actionId: 'x1', title: 'T', draft: 'D', canApprove: true }] });
    await asking;
    chat.waiting.set(1);
    expect(chat.messages().length).toBeGreaterThan(0);

    // The session expires (nobody signed in, no sign-out button pressed), then someone else signs in in the same tab.
    user.set(null);
    TestBed.tick();
    user.set(person('b', 'Bongani'));
    TestBed.tick();

    expect(chat.messages()).toEqual([]);
    expect(chat.waiting()).toBe(0);
    expect(chat.looking()).toBeNull();
    expect(chat.started()).toBe(false);
  });

  it('keeps the chat while the same person stays signed in', () => {
    const user = signal<SignedInUser | null>(person('a', 'Alice'));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user, idToken: async () => 'token' } }],
    });
    const chat = TestBed.inject(ChatService);
    TestBed.tick();
    chat.waiting.set(2);
    user.set(person('a', 'Alice'));
    TestBed.tick();
    expect(chat.waiting()).toBe(2);
  });
  it('forgets which chat to try again when the session ends', async () => {
    const user = signal<SignedInUser | null>(person('a', 'Alice'));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user, idToken: async () => 'token' } }],
    });
    const chat = TestBed.inject(ChatService);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();

    const opening = chat.openChat('chat-a-1', 'Leave');
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne((r) => r.url.endsWith('/v1/chats/chat-a-1')).flush({ title: 'Leave', messages: [] });
    await opening;

    chat.clear();
    chat.reopen();
    await Promise.resolve();
    await Promise.resolve();
    http.expectNone((r) => r.url.includes('/v1/chats/'));
  });
});
