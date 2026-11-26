#!/usr/bin/env node
// INT-UI-01 (M-5): fails when a row of the interview words table has null or empty words. Usage: node scripts/ci/check-interview-words.mjs [file]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const file = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pepla-web', 'src', 'app', 'features', 'recruitment', 'interviews', 'interview-words.ts');
const text = readFileSync(file, 'utf8');
const body = text.slice(text.indexOf('INTERVIEW_WORDS'), text.indexOf('};', text.indexOf('INTERVIEW_WORDS')));
const bad = [...body.matchAll(/(\w+):\s*(null|''|""|``)\s*[,}]/g)].map((m) => m[1]);
if (bad.length) { console.error(`interview words with no words: ${bad.join(', ')}`); process.exit(1); }
console.log('interview words table: every row has words');
