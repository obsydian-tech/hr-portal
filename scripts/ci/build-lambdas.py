#!/usr/bin/env python3
"""Build one deterministic zip per Lambda folder (build once, deploy many).

For every lambda/<name>/ that has index.js or index.mjs:
  * copy the folder, leaving out tests, coverage, docs, node_modules and old zips
  * if the code imports ../shared/..., bundle lambda/shared/ as ./shared/ and
    rewrite the import (same as scripts/deploy-talentflow-lambdas.sh did by hand)
  * npm ci --omit=dev when the folder has a package-lock.json
  * zip with fixed timestamps and sorted entries, so the same source always
    gives the same bytes and the same CodeSha256 in Lambda

Writes dist/lambdas/<name>.zip and dist/lambdas/manifest.json
({name: base64 sha256}). Usage: build-lambdas.py [name ...]
"""
import base64, hashlib, json, os, re, shutil, subprocess, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "lambda"
OUT = ROOT / "dist" / "lambdas"
WORK = ROOT / "dist" / "build"

SKIP_DIRS = {"node_modules", "coverage", "__tests__", ".git"}
SKIP_FILE = re.compile(r"(\.test\.|\.spec\.|\.md$|\.zip$|^jest\.config\.|^\.)")
SHARED_IMPORT = re.compile(r"""(['"])\.\./shared/""")
EPOCH = (1980, 1, 1, 0, 0, 0)

# Files a Lambda reads at runtime that live elsewhere in the repo.
EXTRA_FILES = {
    "serveAgentManifest": [("api/agent-tools.json", "tools.json")],
}


def copy_tree(src: Path, dst: Path) -> None:
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        rel = Path(dirpath).relative_to(src)
        for f in filenames:
            if SKIP_FILE.search(f):
                continue
            (dst / rel).mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(dirpath) / f, dst / rel / f)


def uses_shared(d: Path) -> bool:
    for p in d.rglob("*"):
        if p.suffix in (".js", ".mjs", ".cjs") and p.is_file():
            if SHARED_IMPORT.search(p.read_text(encoding="utf-8", errors="ignore")):
                return True
    return False


def bundle_shared(d: Path) -> None:
    copy_tree(SRC / "shared", d / "shared")
    for f in ("package.json", "package-lock.json"):  # shared has dev deps only
        (d / "shared" / f).unlink(missing_ok=True)
    for p in d.rglob("*"):
        if p.suffix in (".js", ".mjs", ".cjs") and p.is_file() and "shared" not in p.relative_to(d).parts[:1]:
            text = p.read_text(encoding="utf-8")
            new = SHARED_IMPORT.sub(r"\1./shared/", text)
            if new != text:
                p.write_text(new, encoding="utf-8")


def deterministic_zip(src: Path, dest: Path) -> str:
    files = sorted(p for p in src.rglob("*") if p.is_file())
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            info = zipfile.ZipInfo(str(p.relative_to(src)).replace(os.sep, "/"), EPOCH)
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    return base64.b64encode(hashlib.sha256(dest.read_bytes()).digest()).decode()


def main() -> int:
    wanted = set(sys.argv[1:])
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.rmtree(WORK, ignore_errors=True)
    OUT.mkdir(parents=True)
    manifest, failed = {}, []
    for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
        name = d.name
        if name == "shared" or (wanted and name not in wanted):
            continue
        if not ((d / "index.js").exists() or (d / "index.mjs").exists()):
            continue
        build = WORK / name
        copy_tree(d, build)
        if uses_shared(build):
            bundle_shared(build)
        for src_rel, dest_rel in EXTRA_FILES.get(name, []):
            shutil.copy2(ROOT / src_rel, build / dest_rel)
        if (build / "package-lock.json").exists():
            r = subprocess.run(["npm", "ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"],
                               cwd=build, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"FAIL {name}: npm ci\n{r.stderr[-2000:]}")
                failed.append(name)
                continue
            shutil.rmtree(build / "node_modules" / ".bin", ignore_errors=True)
            (build / "node_modules" / ".package-lock.json").unlink(missing_ok=True)
        manifest[name] = deterministic_zip(build, OUT / f"{name}.zip")
        print(f"built {name}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"\n{len(manifest)} built, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
