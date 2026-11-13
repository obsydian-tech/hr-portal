#!/usr/bin/env python3
"""
Decide what a help-mode retake really changed, for the help retake workflow.

Run after `npm run e2e:help` has rewritten pepla-web/help/media (the workflow
deletes the old media first, so a picture no journey takes any more shows up
as deleted).

- A picture that looks the same, pixel for pixel, is put back as it was, so
  re-encoding noise never opens a PR.
- Videos are re-encoded on every run and never match byte for byte, so a
  changed video is kept only when a picture in the same folder changed too.
  New and deleted videos are always kept.

Usage:
  help-retake.py filter        # prints changed=true/false for GITHUB_OUTPUT
  help-retake.py body --repo OWNER/NAME --base SHA --head SHA --out FILE [--previews SHA]
                               # PR body: before and after for each picture
"""
import argparse
import os
import subprocess
import sys

MEDIA = "pepla-web/help/media"


def git(*args: str, check: bool = True) -> str:
    return subprocess.run(["git", *args], check=check, capture_output=True, text=True).stdout


def changes() -> dict[str, str]:
    """path -> A (added), M (modified) or D (deleted), relative to HEAD."""
    git("add", "-A", "--", MEDIA)
    out = git("diff", "--cached", "--name-status", "--no-renames", "HEAD", "--", MEDIA)
    git("reset", "-q", "--", MEDIA)
    return {line.split("\t", 1)[1]: line[0] for line in out.splitlines() if line}


def same_pixels(path: str) -> bool:
    """True when the new picture matches the committed one, give or take font smoothing.

    Pixels that differ by less than 2% in colour are ignored, and a picture where at most 0.1% of the
    pixels still differ counts as unchanged, so anti-aliasing noise does not open a retake pull request.
    """
    old = subprocess.run(["git", "show", f"HEAD:{path}"], check=True, capture_output=True).stdout
    tmp = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "help-before.png")
    with open(tmp, "wb") as f:
        f.write(old)
    # ImageMagick compare: prints the count of differing pixels on stderr.
    r = subprocess.run(["compare", "-fuzz", "2%", "-metric", "AE", tmp, path, "null:"], capture_output=True, text=True)
    size = subprocess.run(["identify", "-format", "%w %h", path], capture_output=True, text=True)
    try:
        differing = float(r.stderr.split()[0])
        width, height = (int(n) for n in size.stdout.split())
        return differing <= width * height * 0.001
    except (IndexError, ValueError):
        return False  # different sizes or unreadable: treat as changed


def restore(path: str) -> None:
    git("checkout", "-q", "HEAD", "--", path)


def folder(path: str) -> str:
    """'pepla-web/help/media/phone/onboard/x.png' -> 'phone/onboard'."""
    return os.path.dirname(os.path.relpath(path, MEDIA))


def keep_real_changes() -> None:
    found = changes()
    for path, kind in found.items():
        if kind == "M" and path.endswith(".png") and same_pixels(path):
            restore(path)
    found = changes()
    picture_folders = {folder(p) for p in found if p.endswith(".png")}
    for path, kind in found.items():
        if path.endswith(".webm") and kind == "M" and folder(path) not in picture_folders:
            restore(path)
    left = [p for p in changes() if not p.endswith(".gitkeep")]
    print(f"changed={'true' if left else 'false'}")
    print(f"{len(left)} help file(s) changed.", file=sys.stderr)


def write_body(repo: str, base: str, head: str, out: str, previews: str | None = None) -> None:
    diff = git("diff", "--name-status", "--no-renames", base, head, "--", MEDIA)
    found = {line.split("\t", 1)[1]: line[0] for line in diff.splitlines() if line}
    raw = f"https://raw.githubusercontent.com/{repo}"
    word = {"A": "new", "M": "changed", "D": "removed"}
    lines = [
        "Help pictures and videos retaken by the journey tests after the latest merge into develop.",
        "Only the fake help company appears. Check that each picture still shows the right thing, then merge.",
        "",
        "| Picture | Before | After |",
        "| --- | --- | --- |",
    ]
    for path, kind in sorted(found.items()):
        if not path.endswith(".png"):
            continue
        name = os.path.relpath(path, MEDIA)
        before = f"![before]({raw}/{base}/{path})" if kind != "A" else "(new)"
        after = f"![after]({raw}/{head}/{path})" if kind != "D" else "(removed)"
        lines.append(f"| `{name}` | {before} | {after} |")
    videos = sorted(p for p in found if p.endswith(".webm"))
    if videos:
        # GitHub does not play videos linked from the repo, so each one gets an
        # animated GIF preview (kept on the help/previews branch, never merged).
        lines += ["", "**Videos** (preview; tap the name for the real video)", ""]
        for path in videos:
            name = os.path.relpath(path, MEDIA)
            if found[path] == "D":
                lines.append(f"- `{name}` (removed)")
                continue
            lines.append(f"- [{name}]({raw}/{head}/{path}) ({word[found[path]]})")
            if previews:
                gif = name[: -len(".webm")] + ".gif"
                lines += ["", f"  ![{name} preview]({raw}/{previews}/{gif})", ""]
    lines += ["", "Made by the Help pictures retake workflow. No AI was used."]
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("filter")
    b = sub.add_parser("body")
    b.add_argument("--repo", required=True)
    b.add_argument("--base", required=True)
    b.add_argument("--head", required=True)
    b.add_argument("--out", required=True)
    b.add_argument("--previews", help="commit SHA on help/previews holding GIF previews")
    a = ap.parse_args()
    if a.cmd == "filter":
        keep_real_changes()
    else:
        write_body(a.repo, a.base, a.head, a.out, a.previews)


if __name__ == "__main__":
    main()
