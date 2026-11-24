#!/usr/bin/env python3
"""Cut a SlideForge release: bump the version, commit "SlideForge X.Y.Z" and tag it vX.Y.Z.

    python tools/release.py patch            # 0.8.3 -> 0.8.4 (also: minor, major, or an exact 0.9.0)
    python tools/release.py patch --push     # and push the branch and the tag
    python tools/release.py patch --dry-run  # say what would happen, change nothing

Every release has notes in docs/releases/vX.Y.Z.md and a "## New in X.Y.Z" section in README.md. When either is
missing the script writes a stub, stops, and asks you to fill it in; run the same command again to commit and tag.
The version lives in one place, backend/slideforge/__init__.py (pyproject reads it from there).
"""

import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "backend" / "slideforge" / "__init__.py"
README = ROOT / "README.md"
NOTES_DIR = ROOT / "docs" / "releases"
VERSION_RE = re.compile(r'^__version__ = "(\d+)\.(\d+)\.(\d+)"$', re.M)
STUB_MARK = "TODO: release notes"


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=ROOT, check=check, capture_output=True, text=True).stdout.strip()


def fail(message):
    sys.exit(f"release: {message}")


def next_version(current, bump):
    major, minor, patch = current
    if bump == "major":
        return (major + 1, 0, 0)
    if bump == "minor":
        return (major, minor + 1, 0)
    if bump == "patch":
        return (major, minor, patch + 1)
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", bump)
    if not match:
        fail(f"expected patch, minor, major or X.Y.Z, got {bump!r}")
    wanted = tuple(int(part) for part in match.groups())
    if wanted <= current:
        fail(f"{'.'.join(map(str, wanted))} is not newer than {'.'.join(map(str, current))}")
    return wanted


def ensure_notes(version, dry_run):
    """Write stubs for missing release notes / README section; return the paths that still need writing."""
    notes = NOTES_DIR / f"v{version}.md"
    pending = []
    if not notes.exists():
        if not dry_run:
            today = datetime.date.today()
            notes.write_text(
                f"# SlideForge {version}\n\nReleased {today.day} {today:%B %Y}.\n\n{STUB_MARK}\n", encoding="utf-8"
            )
        pending.append(notes)
    elif STUB_MARK in notes.read_text(encoding="utf-8"):
        pending.append(notes)

    readme = README.read_text(encoding="utf-8")
    heading = f"## New in {version}\n"
    if heading not in readme:
        anchor = re.search(r"^## New in ", readme, re.M)
        if not anchor:
            fail("README.md has no '## New in' section to put the new one above")
        section = f"{heading}\n- {STUB_MARK}\n\nSee the [{version} release notes](docs/releases/v{version}.md).\n\n"
        if not dry_run:
            README.write_text(readme[: anchor.start()] + section + readme[anchor.start() :], encoding="utf-8")
        pending.append(README)
    elif STUB_MARK in readme.split(heading, 1)[1].split("\n## ", 1)[0]:
        pending.append(README)
    return pending


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("bump", help="patch, minor, major, or an exact version such as 0.9.0")
    parser.add_argument("--push", action="store_true", help="push the branch and the tag to origin")
    parser.add_argument("--dry-run", action="store_true", help="print the plan without changing anything")
    args = parser.parse_args()

    text = VERSION_FILE.read_text(encoding="utf-8")
    match = VERSION_RE.search(text)
    if not match:
        fail(f"no __version__ line in {VERSION_FILE.relative_to(ROOT)}")
    current = tuple(int(part) for part in match.groups())
    version = ".".join(map(str, next_version(current, args.bump)))
    tag = f"v{version}"
    branch = git("rev-parse", "--abbrev-ref", "HEAD")

    if git("tag", "--list", tag):
        fail(f"tag {tag} already exists")
    # Only the release's own files may be changed; untracked files are left alone and not committed.
    release_files = {"README.md", f"docs/releases/{tag}.md", str(VERSION_FILE.relative_to(ROOT))}
    dirty = git("diff", "--name-only", "HEAD").splitlines()
    stray = [path for path in dirty if path not in release_files]
    if stray:
        fail("commit or stash these first: " + ", ".join(stray))
    if branch != "main":
        print(f"release: note: releasing from {branch!r}, not main")

    pending = ensure_notes(version, args.dry_run)
    if pending:
        names = ", ".join(str(path.relative_to(ROOT)) for path in pending)
        verb = "would need" if args.dry_run else "fill in"
        print(f"release: {verb} the {version} notes ({names}), replacing '{STUB_MARK}', then run this again")
        sys.exit(0 if args.dry_run else 1)

    print(f"release: {'.'.join(map(str, current))} -> {version}, commit 'SlideForge {version}', tag {tag} on {branch}")
    if args.dry_run:
        return

    VERSION_FILE.write_text(VERSION_RE.sub(f'__version__ = "{version}"', text, count=1), encoding="utf-8")
    git("add", "--", *sorted(release_files))
    git("commit", "-m", f"SlideForge {version}")
    git("tag", "-a", tag, "-m", f"SlideForge {version}")
    if args.push:
        git("push", "origin", branch)
        git("push", "origin", tag)
        print(f"release: pushed {branch} and {tag}")
    else:
        print(f"release: done. Publish with: git push origin {branch} {tag}")


if __name__ == "__main__":
    main()
