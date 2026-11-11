#!/usr/bin/env python3
"""Fail the build if anything could call a paid AI service without the guard.

Iggie's hard rule (2026-11-11): nothing automated may call Bedrock, Textract
or any other paid AI service. This check enforces the code side of it:

  1. Every AI client created under lambda/ is wrapped in guardAi(...), so it
     refuses to send unless AI_CALLS_ENABLED is exactly "true".
  2. Every Playwright spec imports `test` from e2e/fixtures/no-ai, which
     answers AI routes in the browser with a stand-in.
  3. The guard's own unit tests pass.
Prints file names only.
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AI_CLIENT = re.compile(r"new\s+(\w*(?:Bedrock|Textract|Comprehend|Rekognition|SageMaker|Polly|Transcribe|Translate|Kendra|Lex)\w*Client)\s*\(")
SKIP = {"node_modules", "tests", "__tests__", "coverage"}

problems = []
for p in sorted((ROOT / "lambda").rglob("*")):
    if p.suffix not in (".js", ".mjs", ".cjs") or SKIP & set(p.relative_to(ROOT).parts):
        continue
    if re.search(r"\.(test|spec)\.", p.name):
        continue
    text = p.read_text(encoding="utf-8", errors="ignore")
    for m in AI_CLIENT.finditer(text):
        before = text[max(0, m.start() - 12):m.start()]
        if not before.rstrip().endswith("guardAi("):
            line = text.count("\n", 0, m.start()) + 1
            problems.append(f"{p.relative_to(ROOT)}:{line}: {m.group(1)} is not wrapped in guardAi()")

for spec in sorted((ROOT / "hr-portal" / "e2e" / "tests").rglob("*.spec.ts")):
    text = spec.read_text(encoding="utf-8")
    if "@playwright/test" in text or "fixtures/no-ai" not in text:
        problems.append(f"{spec.relative_to(ROOT)}: must import test from ../fixtures/no-ai, not @playwright/test")

r = subprocess.run(["node", "--test", str(ROOT / "lambda/shared/ai-guard.test.mjs")],
                   capture_output=True, text=True)
if r.returncode != 0:
    problems.append("lambda/shared/ai-guard.test.mjs failed:\n" + r.stdout[-2000:] + r.stderr[-1000:])

if problems:
    print("::error::AI cost guardrail check failed")
    print("\n".join(problems))
    sys.exit(1)
print("AI cost guardrail check passed")
