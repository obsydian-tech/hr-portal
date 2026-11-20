#!/usr/bin/env python3
"""Rule-slip check (pipeline step 8).

Iggie's standing rules about how work appears on GitHub, checked on every pull
request instead of by reading each one back by hand:

  1. Every commit is authored AND committed by Ignecious (merge commits too).
     A merge commit that GitHub itself made (the "Update branch" button) may
     show GitHub as committer when Ignecious is the author.
  2. No attribution text in any commit message or in the pull request text:
     no co-author trailer, no "Generated with/by" footer naming the tool, no
     session link, no hidden HTML comment naming the tool, no "Requested by"
     line.
  3. The branch name does not start with the tool's name and a slash.
  4. No commit adds or changes a file named after the tool's notes file.

The words searched for come from process/LESSONS.md, sections "Pull requests",
"Mistakes made and fixes" and "16 Nov, No GitHub comments", and from the
project notes (rule 4). Nothing else is checked.

The tool's own name is built from two halves below so that this file does not
name it in plain text (frozen workflow tests read the repository for that name).

The workflow runs this copy from the TARGET branch (pull_request_target), so a
pull request that edits this file or its word list is judged by the copy
already on develop. It only reads git history and the event file. It never runs
anything from the pull request.

Modes (RULE_SLIPS_MODE or --mode):
  report   writes what it found on the run page and always exits 0 (default).
  enforce  exits 1 when it finds a slip.
A crash exits 0 in report mode, so a bug here never blocks a pull request.

Replay: --replay --head develop --since 2026-11-13 reads history that already
merged. GitHub's own merge-button commits (committer GitHub) are allowed there.

Standard library only.
"""
import argparse
import json
import os
import re
import subprocess
import sys

TOOL = "cl" + "aude"  # the tool's name, never written out in one piece
TOOL_NOTES = (TOOL + ".md").lower()

OK_EMAILS = {
    "iggytanakamush@gmail.com",
    "5166527+ignecious@users.noreply.github.com",
}

SEP = "\x1f"
END = "\x1e"


def git(repo, *args, stdin=None):
    r = subprocess.run(
        ["git", "-C", repo, *args],
        input=stdin, capture_output=True, text=True, errors="replace", timeout=120,
    )
    if r.returncode != 0:
        raise RuntimeError("git " + " ".join(args[:2]) + " failed: " + r.stderr.strip()[:300])
    return r.stdout


def is_ignecious(name, email):
    return name.strip().lower().startswith("ignecious") and email.strip().lower() in OK_EMAILS


def is_github(name, email):
    return name.strip().lower() == "github" and email.strip().lower() == "noreply@github.com"


# ---- the word list (rule 2) -------------------------------------------------

TEXT_RULES = [
    ("a co-author line", re.compile(r"^[ \t>*-]*co-authored-by[ \t]*:", re.I | re.M)),
    ("a \"Generated with/by\" footer naming the tool",
     re.compile(r"^.*\bgenerated\s+(?:with|by)\b.*(?:%s|%s).*$" % (TOOL, "anth" + "ropic"), re.I | re.M)),
    ("a session link",
     re.compile(r"%s\.ai/code\b|%s\.com/%s-code|\bsession_01[0-9A-Za-z]{14,}" % (TOOL, TOOL, TOOL), re.I)),
    ("a \"Requested-by\" trailer", re.compile(r"^[ \t>*-]*requested-by[ \t]*:", re.I | re.M)),
    # The attribution line is "Requested by **Name** ..." with a bold name or a link; a sentence such as
    # "Requested by the security review." is ordinary prose and is not flagged.
    ("a \"Requested by\" line", re.compile(r"^[ \t_*>]*requested\s+by\b(?=[^\n]*(?:\*\*|\]\(|project thread))", re.I | re.M)),
]
HIDDEN_COMMENT = re.compile(r"<!--(.*?)(?:-->|\Z)", re.S)  # an unclosed comment hides text too
TOOL_NAMES = re.compile("%s|%s" % (TOOL, "anth" + "ropic"), re.I)


def text_slips(text):
    """Yield (line_number, what) for each attribution text found in `text`."""
    out = []
    for what, rx in TEXT_RULES:
        for m in rx.finditer(text):
            out.append((text.count("\n", 0, m.start()) + 1, what))
    for m in HIDDEN_COMMENT.finditer(text):
        if TOOL_NAMES.search(m.group(1)):
            out.append((text.count("\n", 0, m.start()) + 1, "a hidden comment naming the tool"))
    return sorted(set(out))


# ---- reading git ------------------------------------------------------------

def list_commits(repo, head, excludes, since=None):
    args = ["rev-list", head]
    args += ["^" + e for e in excludes]
    if since:
        args += ["--since=" + since]
    return [c for c in git(repo, *args).split() if c]


def commit_info(repo, shas):
    if not shas:
        return []
    fmt = SEP.join(["%H", "%an", "%ae", "%cn", "%ce", "%P", "%B"]) + END
    raw = git(repo, "log", "--no-walk=unsorted", "--stdin", "--format=" + fmt, stdin="\n".join(shas) + "\n")
    info = []
    for rec in raw.split(END):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, an, ae, cn, ce, parents, msg = rec.split(SEP, 6)
        info.append({"sha": sha, "an": an, "ae": ae, "cn": cn, "ce": ce,
                     "parents": parents.split(), "msg": msg})
    return info


def files_added_or_changed(repo, sha):
    out = git(repo, "diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "--no-renames", sha)
    files = []
    for line in out.splitlines():
        status, _, path = line.partition("\t")
        if status and status[0] != "D":
            files.append(path)
    return files


def short(c):
    subject = (c["msg"].strip().splitlines() or [""])[0]
    if len(subject) > 70:
        subject = subject[:67] + "..."
    return '%s "%s"' % (c["sha"][:7], subject)


# ---- the rules --------------------------------------------------------------

def check_commits(repo, commits, replay):
    # `replay` also covers a release pull request (develop into main): its commits are
    # the merge-button commits already on develop, so GitHub as committer is allowed.
    findings = []
    for c in commits:
        who = short(c)
        merge = len(c["parents"]) > 1
        if not is_ignecious(c["an"], c["ae"]):
            findings.append((1, "commit " + who, "authored by %s <%s>, not Ignecious" % (c["an"], c["ae"])))
        if not is_ignecious(c["cn"], c["ce"]):
            github_ok = is_github(c["cn"], c["ce"]) and (replay or merge) and is_ignecious(c["an"], c["ae"])
            if not github_ok:
                findings.append((1, "commit " + who, "committed by %s <%s>, not Ignecious" % (c["cn"], c["ce"])))
        for line, what in text_slips(c["msg"]):
            findings.append((2, "commit %s, message line %d" % (who, line), "has " + what))
        if not merge:
            for f in files_added_or_changed(repo, c["sha"]):
                if os.path.basename(f).lower() == TOOL_NOTES:
                    findings.append((4, "commit " + who, "adds or changes the file " + f))
        if replay and merge:
            m = re.match(r"^Merge (?:pull request #\d+ from [^/\s]+/|branch '|remote-tracking branch '(?:origin/)?)(\S+?)'?(?:\s|$)",
                         c["msg"].strip().splitlines()[0] if c["msg"].strip() else "")
            if m and m.group(1).lower().startswith(TOOL + "/"):
                findings.append((3, "commit " + who, "merges a branch named " + m.group(1)))
    return findings


def check_overall_change(repo, base, head, commits):
    """Rule 4 on the pull request's whole change, so a file brought in inside a merge commit is seen."""
    seen = set()
    for c in commits:
        if len(c["parents"]) <= 1:
            seen.update(files_added_or_changed(repo, c["sha"]))
    out = git(repo, "diff", "--name-status", "--no-renames", git(repo, "merge-base", base, head).strip(), head)
    findings = []
    for line in out.splitlines():
        status, _, path = line.partition("\t")
        if status and status[0] != "D" and path not in seen and os.path.basename(path).lower() == TOOL_NOTES:
            findings.append((4, "the pull request's overall change", "adds or changes the file " + path))
    return findings


def check_pr_text(branch, body):
    findings = []
    if branch and branch.lower().startswith(TOOL + "/"):
        findings.append((3, "branch " + branch, "the branch name starts with \"%s/\"" % TOOL))
    for line, what in text_slips(body or ""):
        findings.append((2, "pull request description, line %d" % line, "has " + what))
    return findings


RULE_WORDS = {
    1: "author and committer must be Ignecious",
    2: "no attribution text",
    3: "no banned branch name",
    4: "no notes file for the tool",
}


def write_outputs(findings, mode, examined, summary_path):
    in_actions = os.environ.get("GITHUB_ACTIONS") == "true"
    level = "error" if mode == "enforce" else "warning"
    for rule, where, what in findings:
        line = "Rule %d (%s): %s: %s." % (rule, RULE_WORDS[rule], where, what)
        print(("::%s title=Rule slip::%s" % (level, line)) if in_actions else line)
    print()
    if findings:
        print("%d rule slip(s) in %s." % (len(findings), examined) +
              (" Enforce mode: this check fails." if mode == "enforce" else " Report-only mode: this check does not fail."))
    else:
        print("No rule slips in %s." % examined)
    if summary_path:
        try:
            with open(summary_path, "a", encoding="utf-8") as fh:
                fh.write("### Rule slips (%s mode)\n\n" % mode)
                if findings:
                    fh.write("| Rule | Where | What |\n|---|---|---|\n")
                    for rule, where, what in findings:
                        cell = lambda s: s.replace("|", "\\|")
                        fh.write("| %d, %s | %s | %s |\n" % (rule, RULE_WORDS[rule], cell(where), cell(what)))
                else:
                    fh.write("No rule slips in %s.\n" % examined)
        except OSError:
            pass


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default=".")
    ap.add_argument("--event", help="GitHub event file (pull_request payload)")
    ap.add_argument("--base", help="base commit of the pull request")
    ap.add_argument("--head", help="head commit (or ref) to check")
    ap.add_argument("--exclude", action="append", default=[], help="extra ref whose history is not judged")
    ap.add_argument("--branch", help="the pull request's branch name")
    ap.add_argument("--body-file", help="file holding the pull request description")
    ap.add_argument("--since", help="replay: only commits since this date")
    ap.add_argument("--replay", action="store_true", help="judge history that already merged")
    ap.add_argument("--mode", default=os.environ.get("RULE_SLIPS_MODE", "report"), choices=["report", "enforce"])
    a = ap.parse_args(argv)

    branch, body, base, head = a.branch, None, a.base, a.head
    excludes = list(a.exclude)
    if a.event:
        with open(a.event, encoding="utf-8") as fh:
            pr = json.load(fh)["pull_request"]
        branch = branch or pr["head"]["ref"]
        body = pr.get("body") or ""
        base = base or pr["base"]["sha"]
        head = head or pr["head"]["sha"]
        tip = "refs/remotes/origin/" + pr["base"]["ref"]
        if subprocess.run(["git", "-C", a.repo, "rev-parse", "-q", "--verify", tip], capture_output=True).returncode == 0:
            excludes.append(tip)
    if a.body_file:
        with open(a.body_file, encoding="utf-8", errors="replace") as fh:
            body = fh.read()
    if not head:
        ap.error("--head (or --event) is required")
    if base:
        excludes.append(base)

    release = bool(a.event) and not a.replay and (branch or "").lower() == "develop"
    commits = commit_info(a.repo, list_commits(a.repo, head, excludes, a.since))
    findings = check_commits(a.repo, commits, a.replay or release)
    if not a.replay:
        findings += check_pr_text(branch, body)
        if base:
            findings += check_overall_change(a.repo, base, head, commits)
    examined = "%d commit(s)%s" % (len(commits), "" if a.replay else " and the pull request text")
    write_outputs(findings, a.mode, examined, os.environ.get("GITHUB_STEP_SUMMARY"))
    return 1 if (findings and a.mode == "enforce") else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as exc:  # a bug here must not block a pull request in report mode
        mode = os.environ.get("RULE_SLIPS_MODE", "report")
        for i, x in enumerate(sys.argv):
            if x == "--mode" and i + 1 < len(sys.argv):
                mode = sys.argv[i + 1]
        print("Rule-slip check could not run: %s" % exc)
        sys.exit(2 if mode == "enforce" else 0)
