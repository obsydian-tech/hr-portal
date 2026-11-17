import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../fixtures';
import { REPO } from './lambda-harness';

/** TEN-02: the pepla-dev API and Cognito client, read from the app's environment file (as TEN-01 AC-8 does). */
export function devEnv(): { api: string; clientId: string; region: string } {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const src = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const pick = (name: string) => new RegExp(`${name}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(src)?.[1] ?? '';
  const api = pick('employeesApiUrl');
  expect(api, 'employeesApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b|^$/);
  const clientId = pick('clientId');
  expect(clientId, 'the Cognito app client id is set for pepla-dev').not.toMatch(/^not-configured$|^$/);
  return { api: api.replace(/\/+$/, ''), clientId, region: pick('region') || 'af-south-1' };
}
