import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/**
 * TEN-08: runs the old portal's own TypeScript (hr-portal/src) in Node, with small
 * stand-ins for Angular, PrimeNG and the Cognito library, so a test can call the real
 * AuthService.login() and LoginComponent.onLogin() without the old app's packages or
 * a browser.
 *
 * Files under hr-portal/src are loaded as they are (transpiled with pepla-web's
 * TypeScript). Packages are stand-ins, except rxjs, which is the real one from
 * pepla-web. A package with no stand-in stops the test and names it.
 *
 * The stand-in Cognito records every user it is asked to sign in and answers the way
 * the test says. Every HTTP call (Angular HttpClient, fetch, XMLHttpRequest) is
 * recorded and fails, so a test can prove nothing went over the network.
 * Nothing here reaches AWS or any AI service.
 */

export const OLD_APP = resolve(__dirname, '..', '..', '..', '..', '..', 'hr-portal');
export const OLD_SRC = join(OLD_APP, 'src');
const pwRequire = createRequire(resolve(__dirname, '..', '..', '..', '..', 'package.json'));
const ts = pwRequire('typescript') as typeof import('typescript');
const rxjs = pwRequire('rxjs');

export type CognitoAnswer =
  | { kind: 'success'; payload: Record<string, unknown> }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'newPasswordRequired' };

export type SignInAttempt = { userUsername: string; detailsUsername: string; password: string };
export type HttpCall = { via: string; method: string; url: string };

export class OldApp {
  readonly signIns: SignInAttempt[] = [];
  readonly http: HttpCall[] = [];
  readonly navigations: unknown[] = [];
  readonly loaded = new Set<string>();
  /** What the stand-in Cognito answers to every sign-in. */
  answer: CognitoAnswer = { kind: 'error', code: 'NotAuthorizedException', message: 'Incorrect username or password.' };

  private readonly cache = new Map<string, { exports: Record<string, unknown> }>();
  private readonly instances = new Map<unknown, unknown>();
  private readonly packages: Record<string, unknown>;

  constructor() {
    this.packages = this.standIns();
  }

  /** A fresh instance of an old-app class, with `inject()` answered from this app. */
  create<T>(file: string, exportName: string): T {
    const cls = this.load(join(OLD_SRC, file))[exportName] as new () => T;
    if (typeof cls !== 'function') throw new Error(`${file} exports no ${exportName}`);
    return this.instantiate(cls) as T;
  }

  private instantiate(cls: unknown): unknown {
    if (this.instances.has(cls)) return this.instances.get(cls);
    const made = new (cls as new () => unknown)();
    this.instances.set(cls, made);
    return made;
  }

  private load(file: string): Record<string, unknown> {
    const hit = this.cache.get(file);
    if (hit) return hit.exports;
    const module = { exports: {} as Record<string, unknown> };
    this.cache.set(file, module);
    this.loaded.add(file);
    const out = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        useDefineForClassFields: false,
        esModuleInterop: true,
      },
    }).outputText;
    const req = (spec: string) => this.require(spec, dirname(file));
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('require', 'module', 'exports', 'fetch', 'XMLHttpRequest', out)(
      req,
      module,
      module.exports,
      this.fetchStandIn(),
      this.xhrStandIn(),
    );
    return module.exports;
  }

  private require(spec: string, from: string): unknown {
    if (spec.startsWith('.')) {
      const base = resolve(from, spec);
      for (const f of [`${base}.ts`, join(base, 'index.ts'), base]) {
        if (existsSync(f) && f.endsWith('.ts')) return this.load(f);
      }
      throw new Error(`old-app harness: cannot find ${spec} from ${from}`);
    }
    if (spec === 'rxjs' || spec.startsWith('rxjs/')) return pwRequire(spec);
    if (spec in this.packages) return this.packages[spec];
    if (/^primeng\//.test(spec) || spec.startsWith('@primeng/')) return anyModule();
    throw new Error(`old-app harness: no stand-in for the package "${spec}"`);
  }

  // ---------------------------------------------------------------- stand-ins

  private fetchStandIn() {
    return (url: unknown, init?: { method?: string }) => {
      this.http.push({ via: 'fetch', method: init?.method ?? 'GET', url: String(url) });
      return Promise.reject(new Error('no network in this test'));
    };
  }

  private xhrStandIn() {
    const http = this.http;
    return class {
      private method = 'GET';
      private url = '';
      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader() {}
      send() {
        http.push({ via: 'XMLHttpRequest', method: this.method, url: this.url });
        throw new Error('no network in this test');
      }
    };
  }

  private standIns(): Record<string, unknown> {
    const app = this;
    const decorator = () => (target: unknown) => target;

    function signal<T>(initial: T) {
      let value = initial;
      const read = () => value;
      return Object.assign(read, {
        set: (v: T) => {
          value = v;
        },
        update: (fn: (v: T) => T) => {
          value = fn(value);
        },
        asReadonly: () => read,
      });
    }

    class Router {
      navigate(commands: unknown, extras?: unknown) {
        app.navigations.push(commands);
        void extras;
        return Promise.resolve(true);
      }
      navigateByUrl(url: unknown) {
        app.navigations.push(url);
        return Promise.resolve(true);
      }
    }

    class HttpClient {}
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request', 'jsonp']) {
      (HttpClient.prototype as unknown as Record<string, unknown>)[method] = (a: unknown, b: unknown) => {
        const url = method === 'request' ? String(b) : String(a);
        app.http.push({ via: 'HttpClient', method: method.toUpperCase(), url });
        return rxjs.throwError(() => Object.assign(new Error('no network in this test'), { status: 0 }));
      };
    }

    class CognitoUserPool {
      constructor(readonly config: unknown) {}
      getCurrentUser() {
        return null;
      }
    }
    class AuthenticationDetails {
      readonly username: string;
      readonly password: string;
      constructor(data: { Username: string; Password: string }) {
        this.username = data.Username;
        this.password = data.Password;
      }
      getUsername() {
        return this.username;
      }
      getPassword() {
        return this.password;
      }
    }
    class CognitoUser {
      readonly username: string;
      constructor(data: { Username: string; Pool: unknown }) {
        this.username = data.Username;
      }
      getUsername() {
        return this.username;
      }
      authenticateUser(details: AuthenticationDetails, callbacks: Record<string, (...args: unknown[]) => void>) {
        app.signIns.push({ userUsername: this.username, detailsUsername: details.username, password: details.password });
        const answer = app.answer;
        setTimeout(() => {
          if (answer.kind === 'success') {
            const payload = answer.payload;
            callbacks['onSuccess']({
              isValid: () => true,
              getIdToken: () => ({ getJwtToken: () => 'fake.id.token', decodePayload: () => payload }),
              getAccessToken: () => ({ getJwtToken: () => 'fake.access.token', decodePayload: () => payload }),
              getRefreshToken: () => ({ getToken: () => 'fake.refresh.token' }),
            });
          } else if (answer.kind === 'newPasswordRequired') {
            callbacks['newPasswordRequired']({}, []);
          } else {
            const err = Object.assign(new Error(answer.message), { code: answer.code, name: answer.code });
            callbacks['onFailure'](err);
          }
        }, 0);
      }
      completeNewPasswordChallenge() {
        throw new Error('not used by TEN-08 tests');
      }
      signOut() {}
      getSession(cb: (err: unknown, s: unknown) => void) {
        cb(new Error('no session'), null);
      }
    }

    class InjectionToken {
      constructor(readonly desc: string) {}
    }

    return {
      '@angular/core': {
        Injectable: decorator,
        Component: decorator,
        Directive: decorator,
        Pipe: decorator,
        NgModule: decorator,
        Input: decorator,
        Output: decorator,
        HostListener: decorator,
        ViewChild: decorator,
        ChangeDetectionStrategy: { OnPush: 0, Default: 1 },
        InjectionToken,
        signal,
        computed: (fn: () => unknown) => () => fn(),
        effect: () => ({ destroy() {} }),
        input: () => signal(undefined),
        output: () => ({ emit() {} }),
        inject: (token: unknown) => {
          if (token === Router || token === HttpClient) return app.instantiate(token);
          if (typeof token === 'function') return app.instantiate(token);
          throw new Error('old-app harness: inject() of a token it does not know');
        },
      },
      '@angular/router': { Router, RouterLink: class {}, RouterOutlet: class {}, ActivatedRoute: class {} },
      '@angular/common/http': {
        HttpClient,
        HttpParams: class {
          constructor(readonly opts?: unknown) {}
        },
        HttpHeaders: class {
          constructor(readonly opts?: unknown) {}
        },
        HttpErrorResponse: class extends Error {},
      },
      '@angular/common': anyModule(),
      '@angular/forms': anyModule(),
      'amazon-cognito-identity-js': { CognitoUserPool, CognitoUser, AuthenticationDetails },
    };
  }
}

/** A module whose every export is an empty class (PrimeNG modules, FormsModule, ...). */
function anyModule(): Record<string, unknown> {
  return new Proxy({}, { get: (_t, key) => (key === '__esModule' ? true : class {}) });
}

/** Reads a file of the old app as text. */
export function oldAppText(file: string): string {
  return readFileSync(join(OLD_SRC, file), 'utf8');
}
