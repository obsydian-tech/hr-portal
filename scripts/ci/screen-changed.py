#!/usr/bin/env python3
"""Did a pull request change a file the screen build or the journeys read? Prints `screen=true` or `screen=false`.

Used by the "Did a screen file change?" job of pepla-web.yml. Unsure means true: any error, a missing base
commit, or an empty answer builds the screen. Both the old and the new path of a moved file count
(--no-renames), so moving screen code out of pepla-web/ still builds it.

Run: BASE_SHA=<base commit> python3 scripts/ci/screen-changed.py
"""
import os
import re
import subprocess
import sys

# The build reads pepla-web/ and api/openapi.yaml (generated API types); this file's workflow defines the jobs.
SCREEN_RE = re.compile(r"^(pepla-web/|api/openapi\.yaml$|\.github/workflows/pepla-web\.yml$)")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def decide(files: list[str]) -> bool:
    return any(SCREEN_RE.match(f) for f in files)


def changed_files(base: str) -> list[str]:
    # A merge commit of a pull request: its first parent is the target branch, as the spec picker reads it.
    parents = git("rev-list", "--parents", "-n", "1", "HEAD").split()
    start = "HEAD^1" if len(parents) == 3 else base
    return git("diff", "--name-only", "--no-renames", start, "HEAD").splitlines()


def main() -> int:
    try:
        screen = decide(changed_files(os.environ["BASE_SHA"]))
    except Exception as e:  # unsure builds
        print(f"Could not list the changed files ({type(e).__name__}); building the screen to be safe.", file=sys.stderr)
        screen = True
    print(f"screen={'true' if screen else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
