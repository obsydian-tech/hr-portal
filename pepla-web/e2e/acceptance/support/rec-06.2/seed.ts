import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, type Row } from '../onb-18/lambda-harness';

/**
 * REC-06.2 rule 16: runs one function of the real scripts/ci/seed-dev.py (seed_rec06_2) against an in-memory DynamoDB (./fake-boto3, copied from
 * REC-06.1's), with the settings the dev workflow gives it. The world is the JSON file named by REC062_WORLD; put_item and delete_item run
 * (with their ConditionExpression); Scan, batch and transactions are refused. Nothing reaches AWS.
 */
export type Tables = Record<string, Row[]>;
export type SeedCall = { op: string; params: Record<string, any>; error: string | null };
export type SeedRun = { code: number; stdout: string; stderr: string; tables: Tables; calls: SeedCall[] };

export const SEED = join(REPO, 'scripts', 'ci', 'seed-dev.py');

/** Runs `fn(ddb, ...args)` from seed-dev.py. `env` is what the workflow run provides (GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT). */
export function runSeed(tables: Tables, fn: string, args: string[], env: Record<string, string> = {}): SeedRun {
  const dir = mkdtempSync(join(tmpdir(), 'rec-06-2-py-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ tables, allowWrites: true }));
  const outFile = join(dir, 'out.json');
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('python3', [join(__dirname, 'fake-boto3', 'run-script.py'), SEED, ...args], {
      cwd: dir, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env['PATH'] ?? '', REC062_WORLD: worldFile, REC062_OUT: outFile, REC062_CALL: fn, AWS_REGION: 'af-south-1', AWS_DEFAULT_REGION: 'af-south-1',
        AWS_ACCESS_KEY_ID: 'rec062-fake', AWS_SECRET_ACCESS_KEY: 'rec062-fake', PYTHONDONTWRITEBYTECODE: '1', ...env,
      },
    });
  } catch (e: any) {
    code = typeof e.status === 'number' ? e.status : 1;
    stdout = String(e.stdout ?? '');
    stderr = String(e.stderr ?? e.message ?? '');
  }
  let after: { tables: Tables; calls: SeedCall[] } = { tables, calls: [] };
  try { after = JSON.parse(readFileSync(outFile, 'utf8')); } catch { /* the runner wrote nothing: the function was missing or crashed first */ }
  return { code, stdout, stderr, tables: after.tables, calls: after.calls };
}
