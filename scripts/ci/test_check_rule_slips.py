#!/usr/bin/env python3
"""Tests for scripts/ci/check-rule-slips.py (pipeline step 8).

Run: python3 -B scripts/ci/test_check_rule_slips.py   (standard library only)

Every test builds a small throw-away git repository and judges it. Each rule has
a made-up case that must be flagged and a clean case that must pass.
The tool's name is built from halves so this file does not name it in one piece.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CHECK = HERE / "check-rule-slips.py"
WORKFLOW = REPO / ".github" / "workflows" / "rule-slips.yml"
TOOL = "cl" + "aude"
TOOL_NOTES = TOOL.upper() + ".md"
VENDOR = "anth" + "ropic"

IGGIE = ("Ignecious", "iggytanakamush@gmail.com")
IGGIE_NOREPLY = ("Ignecious", "5166527+Ignecious@users.noreply.github.com")
TOOL_ID = (TOOL.capitalize(), "noreply@%s.com" % VENDOR)
GITHUB = ("GitHub", "noreply@github.com")
BOT = ("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com")
FOOTER = "\U0001F916 Generated with [%s Code](https://%s.com/%s-code)" % (TOOL.capitalize(), TOOL, TOOL)
SESSION = "https://%s.ai/code/session_01W7gFzKV4FqY6n7Gz3xiq3x" % TOOL


class Repo:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).mkdir(parents=True)
        self.git("init", "-q", "-b", "develop")
        self.n = 0

    def git(self, *args, who=IGGIE, committer=None, check=True):
        committer = committer or who
        env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
                   GIT_AUTHOR_NAME=who[0], GIT_AUTHOR_EMAIL=who[1],
                   GIT_COMMITTER_NAME=committer[0], GIT_COMMITTER_EMAIL=committer[1])
        r = subprocess.run(["git", "-C", self.path, *args], capture_output=True, text=True, env=env)
        if check and r.returncode != 0:
            raise AssertionError("git %s: %s" % (" ".join(args), r.stderr))
        return r.stdout.strip()

    def commit(self, message="change", files=None, who=IGGIE, committer=None):
        self.n += 1
        for name, text in (files or {"f%d.txt" % self.n: "x%d\n" % self.n}).items():
            p = Path(self.path, name)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message, who=who, committer=committer)
        return self.git("rev-parse", "HEAD")

    def branch(self, name):
        self.git("checkout", "-q", "-b", name)


def run_check(repo, *args, env=None, mode="report", cwd=None):
    e = dict(os.environ, **(env or {}))
    for k in ("GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY", "RULE_SLIPS_MODE"):
        e.pop(k, None)
    e.update(env or {})
    return subprocess.run([sys.executable, "-I", "-B", str(CHECK), "--repo", repo.path, "--mode", mode, *args],
                          capture_output=True, text=True, env=e, cwd=cwd)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Repo(Path(self.tmp.name, "r"))
        self.base = self.repo.commit("start")
        self.repo.branch("feat/thing")

    def judge(self, body="Adds a thing.", branch=None, mode="enforce", extra=()):
        body_file = Path(self.tmp.name, "body.md")
        body_file.write_text(body)
        return run_check(self.repo, "--base", self.base, "--head", "HEAD", "--branch",
                         branch or self.repo.git("rev-parse", "--abbrev-ref", "HEAD"),
                         "--body-file", str(body_file), *extra, mode=mode)

    def assertFlagged(self, r, rule, *words):
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("Rule %d" % rule, r.stdout)
        for w in words:
            self.assertIn(w, r.stdout)

    def assertClean(self, r):
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("No rule slips", r.stdout)


class CleanCases(Base):
    def test_clean_pull_request_passes(self):
        self.repo.commit("feat: a clean change")
        self.repo.commit("fix: another", who=IGGIE_NOREPLY)
        self.assertClean(self.judge())

    def test_clean_merge_commit_by_ignecious_passes(self):
        self.repo.git("checkout", "-q", "develop")
        self.repo.commit("develop moved")
        self.repo.git("checkout", "-q", "feat/thing")
        self.repo.commit("feat: work")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'develop' into feat/thing", "develop")
        self.assertClean(self.judge())

    def test_update_branch_merge_made_by_github_passes(self):
        self.repo.git("checkout", "-q", "develop")
        self.repo.commit("develop moved")
        self.repo.git("checkout", "-q", "feat/thing")
        self.repo.commit("feat: work")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'develop' into feat/thing", "develop",
                      who=IGGIE, committer=GITHUB)
        self.assertClean(self.judge())

    def test_ordinary_words_that_look_like_a_rule_do_not_trip_it(self):
        self.repo.commit("docs: types generated with openapi-typescript\n\nChange requested by the security review.\nThe %s directory is not used." % TOOL)
        r = self.judge(body="Generated with the build script.\nRequested by security review, as agreed.\n<!-- note for reviewers -->\nBranch feat/%s-docs." % TOOL)
        self.assertClean(r)

    def test_branch_that_only_contains_the_name_passes(self):
        self.repo.commit("feat: x")
        self.assertClean(self.judge(branch="feat/%s-docs" % TOOL))


class Rule1AuthorAndCommitter(Base):
    def test_commit_authored_by_the_tool_is_flagged(self):
        sha = self.repo.commit("feat: x", who=TOOL_ID)
        self.assertFlagged(self.judge(), 1, sha[:7], "authored by", "committed by")

    def test_wrong_committer_with_right_author_is_flagged(self):
        sha = self.repo.commit("feat: x", who=IGGIE, committer=TOOL_ID)
        r = self.judge()
        self.assertFlagged(r, 1, sha[:7], "committed by")
        self.assertNotIn("authored by", r.stdout)

    def test_merge_commit_authored_by_the_tool_is_flagged(self):
        # The #287 case: a merge commit authored as the tool.
        self.repo.git("checkout", "-q", "develop")
        self.repo.commit("develop moved")
        self.repo.git("checkout", "-q", "feat/thing")
        self.repo.commit("feat: work")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'develop' into feat/thing", "develop", who=TOOL_ID)
        self.assertFlagged(self.judge(), 1, "authored by", "Merge branch")

    def test_github_committer_on_an_ordinary_commit_is_flagged_on_a_pull_request(self):
        self.repo.commit("feat: edited on the web", who=IGGIE, committer=GITHUB)
        self.assertFlagged(self.judge(), 1, "committed by GitHub")

    def test_github_as_author_is_flagged_even_on_a_merge(self):
        self.repo.git("checkout", "-q", "develop")
        self.repo.commit("develop moved")
        self.repo.git("checkout", "-q", "feat/thing")
        self.repo.commit("feat: work")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'develop'", "develop", who=TOOL_ID, committer=GITHUB)
        self.assertFlagged(self.judge(), 1, "authored by")

    def test_a_lookalike_name_with_another_email_is_flagged(self):
        self.repo.commit("feat: x", who=("Ignecious", "someone@example.com"))
        self.assertFlagged(self.judge(), 1, "authored by", "someone@example.com")

    def test_commits_already_on_the_target_branch_are_not_judged(self):
        # develop moved on with a commit the PR merged in; the PR is judged only by its own commits.
        self.repo.git("checkout", "-q", "develop")
        old = self.repo.commit("old slip on develop", who=TOOL_ID)
        self.repo.git("checkout", "-q", "feat/thing")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'develop'", "develop")
        self.repo.commit("feat: work")
        r = self.judge(extra=("--exclude", "develop"))
        self.assertClean(r)
        self.assertNotIn(old[:7], r.stdout)


class Rule2AttributionText(Base):
    def test_co_author_trailer_in_a_commit_is_flagged(self):
        sha = self.repo.commit("feat: x\n\nCo-Authored-By: Someone <a@example.com>")
        self.assertFlagged(self.judge(), 2, sha[:7], "co-author line", "message line 3")

    def test_generated_with_footer_in_a_commit_is_flagged(self):
        self.repo.commit("feat: x\n\n" + FOOTER)
        self.assertFlagged(self.judge(), 2, "Generated with/by")

    def test_generated_by_footer_in_the_description_is_flagged(self):
        self.repo.commit("feat: x")
        r = self.judge(body="Adds a thing.\n\nGenerated by [%s Code](https://%s.ai/code)" % (TOOL.capitalize(), TOOL))
        self.assertFlagged(r, 2, "pull request description, line 3", "Generated with/by")

    def test_session_link_in_a_commit_is_flagged(self):
        self.repo.commit("feat: x\n\n%s-Session: %s" % (TOOL.capitalize(), SESSION))
        self.assertFlagged(self.judge(), 2, "session link")

    def test_session_link_in_the_description_is_flagged(self):
        self.repo.commit("feat: x")
        self.assertFlagged(self.judge(body="Adds a thing.\n\n" + SESSION), 2, "pull request description", "session link")

    def test_hidden_comment_naming_the_tool_is_flagged(self):
        self.repo.commit("feat: x")
        body = '<!-- %s-projects-attribution: {"github_login":"Ignecious"} -->\nAdds a thing.' % TOOL
        self.assertFlagged(self.judge(body=body), 2, "description, line 1", "hidden comment")

    def test_requested_by_line_is_flagged(self):
        self.repo.commit("feat: x")
        body = "_Requested by **Iggie** · [project thread](https://example.com/t)_\nAdds a thing."
        self.assertFlagged(self.judge(body=body), 2, "\"Requested by\" line")
        self.assertFlagged(self.judge(body="Adds a thing.\nRequested by **Iggie**"), 2, "\"Requested by\" line")

    def test_each_text_rule_is_read_from_every_commit_in_the_pull_request(self):
        self.repo.commit("feat: first")
        sha = self.repo.commit("feat: second\n\nCo-authored-by: X <x@example.com>")
        self.repo.commit("feat: third")
        r = self.judge()
        self.assertFlagged(r, 2, sha[:7])
        self.assertEqual(r.stdout.count("Rule 2"), 1)


class Rule3BranchName(Base):
    def test_banned_branch_name_is_flagged(self):
        self.repo.commit("feat: x")
        self.assertFlagged(self.judge(branch="%s/some-task" % TOOL), 3, "starts with")

    def test_banned_branch_name_in_other_case_is_flagged(self):
        self.repo.commit("feat: x")
        self.assertFlagged(self.judge(branch="%s/Some-Task" % TOOL.capitalize()), 3)


class Rule4NotesFile(Base):
    def test_adding_the_notes_file_is_flagged(self):
        sha = self.repo.commit("docs: notes", files={TOOL_NOTES: "# notes\n"})
        self.assertFlagged(self.judge(), 4, sha[:7], TOOL_NOTES)

    def test_changing_a_nested_notes_file_is_flagged(self):
        self.repo.commit("docs: add", files={"pepla-web/" + TOOL_NOTES: "a\n"})
        self.base = self.repo.git("rev-parse", "HEAD")
        sha = self.repo.commit("docs: change", files={"pepla-web/" + TOOL_NOTES: "b\n"})
        self.assertFlagged(self.judge(), 4, sha[:7], "pepla-web/" + TOOL_NOTES)

    def test_a_similar_file_name_is_not_flagged(self):
        self.repo.commit("docs: x", files={"docs/" + TOOL_NOTES + ".txt": "a\n", "docs/not-" + TOOL_NOTES: "b\n"})
        self.assertClean(self.judge())

    def test_deleting_the_file_is_not_flagged(self):
        self.repo.commit("docs: add", files={TOOL_NOTES: "a\n"})
        self.base = self.repo.git("rev-parse", "HEAD")
        self.repo.git("rm", "-q", TOOL_NOTES)
        self.repo.git("commit", "-q", "-m", "docs: remove")
        self.assertClean(self.judge())


class Modes(Base):
    def test_report_mode_never_fails(self):
        self.repo.commit("feat: x", who=TOOL_ID)
        r = self.judge(mode="report")
        self.assertEqual(r.returncode, 0)
        self.assertIn("Rule 1", r.stdout)
        self.assertIn("Report-only mode", r.stdout)

    def test_enforce_mode_fails_on_a_slip(self):
        self.repo.commit("feat: x", who=TOOL_ID)
        self.assertEqual(self.judge(mode="enforce").returncode, 1)

    def test_mode_can_come_from_the_environment(self):
        self.repo.commit("feat: x", who=TOOL_ID)
        body = Path(self.tmp.name, "b.md")
        body.write_text("x")
        r = subprocess.run([sys.executable, "-I", "-B", str(CHECK), "--repo", self.repo.path, "--base", self.base,
                            "--head", "HEAD", "--body-file", str(body)],
                           capture_output=True, text=True, env=dict(os.environ, RULE_SLIPS_MODE="enforce"))
        self.assertEqual(r.returncode, 1)

    def test_a_crash_never_blocks_in_report_mode(self):
        r = run_check(Repo(Path(self.tmp.name, "other")), "--base", "0" * 40, "--head", "nosuchref", mode="report")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("could not run", r.stdout)

    def test_a_crash_fails_in_enforce_mode(self):
        r = run_check(Repo(Path(self.tmp.name, "other")), "--base", "0" * 40, "--head", "nosuchref", mode="enforce")
        self.assertEqual(r.returncode, 2)
        self.assertIn("could not run", r.stdout)

    def test_findings_become_warnings_and_a_summary_on_github(self):
        self.repo.commit("feat: x", who=TOOL_ID)
        summary = Path(self.tmp.name, "summary.md")
        r = run_check(
            self.repo, "--base", self.base, "--head", "HEAD", "--branch", "feat/thing",
            env={"GITHUB_ACTIONS": "true", "GITHUB_STEP_SUMMARY": str(summary)}, mode="report")
        self.assertIn("::warning title=Rule slip::Rule 1", r.stdout)
        self.assertIn("| 1, author and committer must be Ignecious |", summary.read_text())
        r2 = run_check(self.repo, "--base", self.base, "--head", "HEAD", "--branch", "feat/thing",
                       env={"GITHUB_ACTIONS": "true"}, mode="enforce")
        self.assertIn("::error title=Rule slip::Rule 1", r2.stdout)


class Event(Base):
    def test_reads_branch_body_base_and_head_from_the_event_file(self):
        self.repo.git("checkout", "-q", "-b", "%s/from-event" % TOOL)
        self.repo.commit("feat: x")
        event = Path(self.tmp.name, "event.json")
        event.write_text(json.dumps({"pull_request": {
            "body": "Adds a thing.\n" + SESSION, "head": {"ref": "%s/from-event" % TOOL, "sha": self.repo.git("rev-parse", "HEAD")},
            "base": {"ref": "develop", "sha": self.base}}}))
        r = run_check(self.repo, "--event", str(event), mode="enforce")
        self.assertFlagged(r, 3, "starts with")
        self.assertIn("Rule 2", r.stdout)

    def test_an_empty_description_is_fine(self):
        self.repo.commit("feat: x")
        event = Path(self.tmp.name, "event.json")
        event.write_text(json.dumps({"pull_request": {
            "body": None, "head": {"ref": "feat/thing", "sha": self.repo.git("rev-parse", "HEAD")},
            "base": {"ref": "develop", "sha": self.base}}}))
        self.assertClean(run_check(self.repo, "--event", str(event), mode="enforce"))


class RulesComeFromTheTargetBranch(Base):
    def test_a_pull_request_that_rewrites_the_script_is_still_judged_by_the_copy_on_develop(self):
        # The PR replaces its own copy of the script with one that says "all clear".
        self.repo.commit("feat: change the rules", files={"scripts/ci/check-rule-slips.py": "import sys\nprint('No rule slips')\nsys.exit(0)\n"})
        self.repo.commit("feat: x", who=TOOL_ID)
        r = self.judge(mode="enforce")  # runs CHECK (the copy outside the PR's repo)
        self.assertFlagged(r, 1, "authored by")

    def test_the_workflow_reads_the_script_from_the_target_branch_and_the_history_from_the_pr(self):
        text = WORKFLOW.read_text()
        self.assertIn("pull_request_target:", text)
        self.assertNotRegex(text, r"(?m)^\s{2}pull_request:")
        self.assertIn("path: rules", text)
        self.assertIn("path: pr", text)
        self.assertIn("ref: ${{ github.event.pull_request.head.sha }}", text)
        self.assertIn("python3 -I -B rules/scripts/ci/check-rule-slips.py --repo pr", text)
        self.assertNotIn("pr/scripts", text)

    def test_the_workflow_is_report_only_and_reads_no_secret(self):
        text = WORKFLOW.read_text()
        self.assertIn("RULE_SLIPS_MODE: report", text)
        self.assertNotIn("secrets.", text)
        self.assertIn("contents: read", text)
        self.assertNotRegex(text, r":\s*write\b")  # no write permission anywhere


class Replay(Base):
    def test_bot_commits_are_flagged_and_github_merge_button_commits_are_not(self):
        self.repo.git("checkout", "-q", "develop")
        self.repo.commit("feat: squashed (#1)", who=IGGIE, committer=GITHUB)
        bot = self.repo.commit("Help pictures: retake", who=BOT)
        r = run_check(self.repo, "--replay", "--head", "develop", mode="report")
        self.assertIn(bot[:7], r.stdout)
        self.assertNotIn("squashed", r.stdout)

    def test_merge_of_a_banned_branch_is_flagged_in_replay(self):
        self.repo.commit("feat: work")
        self.repo.git("checkout", "-q", "develop")
        self.repo.git("merge", "-q", "--no-ff", "-m", "Merge pull request #9 from obsydian-tech/%s/some-task" % TOOL, "feat/thing",
                      committer=GITHUB)
        r = run_check(self.repo, "--replay", "--head", "develop", mode="report")
        self.assertIn("Rule 3", r.stdout)
        self.assertIn("%s/some-task" % TOOL, r.stdout)

    def test_replay_can_start_from_a_date(self):
        self.repo.git("checkout", "-q", "develop")
        # A commit dated 2020 is left out by --since 2025; without --since it is judged.
        import subprocess as sp
        env = dict(os.environ, GIT_COMMITTER_DATE="2020-01-01T00:00:00", GIT_AUTHOR_DATE="2020-01-01T00:00:00",
                   GIT_AUTHOR_NAME=TOOL_ID[0], GIT_AUTHOR_EMAIL=TOOL_ID[1], GIT_COMMITTER_NAME=TOOL_ID[0], GIT_COMMITTER_EMAIL=TOOL_ID[1])
        sha = sp.run(["git", "-C", self.repo.path, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "old slip"],
                     capture_output=True, text=True, env=env).stdout.strip()
        self.repo.git("update-ref", "refs/heads/old", sha)
        self.assertIn("Rule 1", run_check(self.repo, "--replay", "--head", "old").stdout)
        r = run_check(self.repo, "--replay", "--head", "old", "--since", "2025-01-01")
        self.assertNotIn(sha[:7], r.stdout)
        self.assertNotIn("Rule 1", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
