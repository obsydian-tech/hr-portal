import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService, AuthUser } from './auth.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockSession(payload: Record<string, any>) {
  return {
    isValid: () => true,
    getIdToken: () => ({
      getJwtToken: () => 'test-jwt-token',
      decodePayload: () => payload,
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HR_PAYLOAD: Record<string, any> = {
  email: 'thabo@naleko.co.za', given_name: 'Thabo', family_name: 'Molefe',
  'custom:staff_id': 'AS00001', 'custom:employee_id': '',
  'custom:role': 'hr_staff', 'cognito:groups': ['hr_staff'],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMP_PAYLOAD: Record<string, any> = {
  email: 'sarah@example.com', given_name: 'Sarah', family_name: 'Dlamini',
  'custom:staff_id': '', 'custom:employee_id': 'EMP-0000014',
  'custom:role': 'employee', 'cognito:groups': ['employee'],
};

describe('AuthService', () => {
  let svc: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    svc = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => expect(svc).toBeTruthy());
  it('isAuthenticated defaults to false', () => expect(svc.isAuthenticated()).toBeFalse());
  it('currentUser defaults to null', () => expect(svc.currentUser()).toBeNull());
  it('isLoading defaults to true', () => expect(svc.isLoading()).toBeTrue());
  it('isHrStaff computed is false initially', () => expect(svc.isHrStaff()).toBeFalse());
  it('isEmployee computed is false initially', () => expect(svc.isEmployee()).toBeFalse());
  it('staffId computed is empty initially', () => expect(svc.staffId()).toBe(''));
  it('employeeId computed is empty initially', () => expect(svc.employeeId()).toBe(''));
  it('displayName computed is empty initially', () => expect(svc.displayName()).toBe(''));

  it('isHrStaff is true when role is hr_staff', () => {
    svc.currentUser.set({ email: 'a@b.com', givenName: 'A', familyName: 'B', fullName: 'A B', staffId: 'AS00001', employeeId: '', role: 'hr_staff', groups: [] });
    expect(svc.isHrStaff()).toBeTrue();
    expect(svc.isEmployee()).toBeFalse();
  });

  it('isEmployee is true when role is employee', () => {
    svc.currentUser.set({ email: 'a@b.com', givenName: 'A', familyName: 'B', fullName: 'A B', staffId: '', employeeId: 'EMP-001', role: 'employee', groups: [] });
    expect(svc.isEmployee()).toBeTrue();
    expect(svc.isHrStaff()).toBeFalse();
  });

  it('displayName reflects currentUser fullName', () => {
    svc.currentUser.set({ email: 'a@b.com', givenName: 'Thabo', familyName: 'Molefe', fullName: 'Thabo Molefe', staffId: 'AS00001', employeeId: '', role: 'hr_staff', groups: [] });
    expect(svc.displayName()).toBe('Thabo Molefe');
  });

  it('staffId reflects currentUser staffId', () => {
    svc.currentUser.set({ email: 'a@b.com', givenName: 'A', familyName: 'B', fullName: 'A B', staffId: 'AS00042', employeeId: '', role: 'hr_staff', groups: [] });
    expect(svc.staffId()).toBe('AS00042');
  });

  it('logout clears isAuthenticated and currentUser', () => {
    svc.isAuthenticated.set(true);
    svc.currentUser.set({ email: 'a@b.com', givenName: 'A', familyName: 'B', fullName: 'A B', staffId: 'AS00001', employeeId: '', role: 'hr_staff', groups: [] });
    const signOutSpy = jasmine.createSpy('signOut');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => ({ signOut: signOutSpy }) };
    const navSpy = spyOn(router, 'navigate');
    svc.logout();
    expect(svc.isAuthenticated()).toBeFalse();
    expect(svc.currentUser()).toBeNull();
    expect(signOutSpy).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/login']);
  });

  it('logout with no pool user does not throw', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => null };
    const navSpy = spyOn(router, 'navigate');
    expect(() => svc.logout()).not.toThrow();
    expect(navSpy).toHaveBeenCalledWith(['/login']);
  });

  it('logout navigates to /login', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => null };
    const navSpy = spyOn(router, 'navigate');
    svc.logout();
    expect(navSpy).toHaveBeenCalledWith(['/login']);
  });

  it('getIdToken returns null when no pool user', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => null };
    expect(await svc.getIdToken()).toBeNull();
  });

  it('getIdToken returns null when session is invalid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => ({ getSession: (cb: any) => cb(null, { isValid: () => false }) }) };
    expect(await svc.getIdToken()).toBeNull();
  });

  it('getIdToken returns JWT when session is valid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => ({ getSession: (cb: any) => cb(null, mockSession(HR_PAYLOAD)) }) };
    expect(await svc.getIdToken()).toBe('test-jwt-token');
  });

  it('getIdToken returns null when getSession errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => ({ getSession: (cb: any) => cb(new Error('fail'), null) }) };
    expect(await svc.getIdToken()).toBeNull();
  });

  it('checkSession with no user sets isLoading false and unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => null };
    await svc.checkSession();
    expect(svc.isLoading()).toBeFalse();
    expect(svc.isAuthenticated()).toBeFalse();
  });

  it('checkSession with valid HR session sets authenticated and maps user', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => ({ getSession: (cb: any) => cb(null, mockSession(HR_PAYLOAD)) }) };
    await svc.checkSession();
    expect(svc.isAuthenticated()).toBeTrue();
    const user = svc.currentUser() as AuthUser;
    expect(user.email).toBe('thabo@naleko.co.za');
    expect(user.role).toBe('hr_staff');
    expect(user.fullName).toBe('Thabo Molefe');
    expect(svc.isLoading()).toBeFalse();
  });

  it('checkSession with valid employee session maps role and employeeId', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => ({ getSession: (cb: any) => cb(null, mockSession(EMP_PAYLOAD)) }) };
    await svc.checkSession();
    const user = svc.currentUser() as AuthUser;
    expect(user.role).toBe('employee');
    expect(user.employeeId).toBe('EMP-0000014');
  });

  it('checkSession on error leaves unauthenticated and sets isLoading false', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).userPool = { getCurrentUser: () => ({ getSession: (cb: any) => cb(new Error('fail'), null) }) };
    await svc.checkSession();
    expect(svc.isAuthenticated()).toBeFalse();
    expect(svc.isLoading()).toBeFalse();
  });

  it('completeNewPassword returns ERROR when no pending cognitoUser', async () => {
    const result = await svc.completeNewPassword('NewPass!99');
    expect(result.status).toBe('ERROR');
    expect((result as { status: string; message: string }).message).toContain('No pending');
  });

  it('login with unknown AS ID returns ERROR without HTTP call', async () => {
    const result = await svc.login('AS99999', 'pass');
    expect(result.status).toBe('ERROR');
    httpMock.expectNone(() => true);
  });

  it('login with EMP- ID that returns 404 returns ERROR', async () => {
    const p = svc.login('EMP-9999999', 'pass');
    httpMock.expectOne((r) => r.url.includes('/employee/lookup'))
      .flush({}, { status: 404, statusText: 'Not Found' });
    const result = await p;
    expect(result.status).toBe('ERROR');
  });
});
