import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Geometry, ShellSnapshot } from './shell-snapshot';

/** What develop 06201c3 drew, and its package lists. Read from baseline.json next to this file. */
export type Baseline = {
  dependencies: string[];
  devDependencies: string[];
  projects: Record<string, {
    hr: { snap: ShellSnapshot; geo: Geometry };
    employee: { snap: ShellSnapshot; geo: Geometry };
    redirects: Record<string, string>;
  }>;
};

export const BASELINE: Baseline = JSON.parse(readFileSync(join(__dirname, 'baseline.json'), 'utf8'));
