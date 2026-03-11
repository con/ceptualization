# git-bug: Archiving GitHub Issues and Discussions

## Overview

**git-bug** is a distributed, offline-first bug tracker embedded in git. It's relevant for con/flux to archive not just code and data, but also **issues, discussions, and project metadata** from GitHub.

## What is git-bug?

### Core Concept
- **Distributed:** Issues stored as git objects
- **Offline-first:** Work without network
- **Embedded in git:** Issues travel with repository
- **Bridges:** Can sync with GitHub, GitLab, Jira

### Repository
- **GitHub:** https://github.com/git-bug/git-bug
- **Stars:** 9,612
- **Status:** Actively maintained (updated Dec 2025)
- **Migration tool:** https://github.com/git-bug/git-bug-migration

### Important 2026 Notice
⚠️ Master branch removed Jan 31, 2026 (announced Aug 2025)
- Use main branch or recent releases

## Why Relevant for con/flux

### GitHub Archival Beyond Code
Currently, if you want to preserve GitHub project history, you get:
- ✅ Code (git clone)
- ✅ CI logs (con/tinuous)
- ❌ Issues
- ❌ Pull request discussions
- ❌ Project boards
- ❌ Wiki content
- ❌ Release notes

**git-bug can help with issues/discussions**

### Use Cases for con/flux

1. **Archive project issues** from GitHub repositories
2. **Preserve discussions** before repository deletion
3. **Offline access** to issue history
4. **Version control for bugs** alongside code
5. **Backup** of project management data

## How git-bug Works

### Storage Model
```
.git/
├── bugs/               # git-bug data as git objects
│   ├── identities/
│   ├── bugs/
│   └── ops/
└── objects/            # Standard git objects
```

**Not stored as files** - stored as git objects (like commits)
- Benefits: Efficient, mergeable, git-native
- Trade-off: Need git-bug tool to read

### Basic Commands

```bash
# Initialize in a git repository
git bug init

# Create bug
git bug add

# List bugs
git bug ls

# Show bug details
git bug show <bug-id>

# Comment on bug
git bug comment <bug-id>

# Close bug
git bug close <bug-id>
```

### Bridging to GitHub

```bash
# Configure GitHub bridge
git bug bridge configure github

# Import issues from GitHub
git bug bridge pull github

# Export local bugs to GitHub
git bug bridge push github
```

## Integration with con/flux

### Scenario: Archive GitHub Issues

```bash
# For each GitHub repository you want to archive
cd archives/github/repos/myproject

# Initialize git-bug
git bug init

# Configure GitHub bridge
git bug bridge configure github \
  --token $GITHUB_TOKEN \
  --project owner/repo

# Import all issues
git bug bridge pull github

# Commit to DataLad dataset
datalad save -m "Archive GitHub issues for myproject"
```

### Automated Archival

```python
#!/usr/bin/env python3
"""Archive GitHub issues to git-bug"""
import subprocess
from pathlib import Path

def archive_github_issues(repo_owner, repo_name, dataset_path):
    """Archive GitHub issues using git-bug"""

    repo_path = Path(dataset_path) / 'github' / 'repos' / repo_name
    repo_path.mkdir(parents=True, exist_ok=True)

    # Clone if not exists
    if not (repo_path / '.git').exists():
        subprocess.run([
            'git', 'clone',
            f'https://github.com/{repo_owner}/{repo_name}',
            str(repo_path)
        ])

    # Initialize git-bug
    subprocess.run(['git', 'bug', 'init'], cwd=repo_path)

    # Configure bridge
    subprocess.run([
        'git', 'bug', 'bridge', 'configure', 'github',
        '--project', f'{repo_owner}/{repo_name}',
        '--token', os.environ['GITHUB_TOKEN']
    ], cwd=repo_path)

    # Pull issues
    result = subprocess.run(
        ['git', 'bug', 'bridge', 'pull', 'github'],
        cwd=repo_path,
        capture_output=True,
        text=True
    )

    print(result.stdout)

    # Commit with DataLad
    subprocess.run([
        'datalad', 'save',
        '-m', f'Archive GitHub issues for {repo_name}',
        str(repo_path)
    ])

if __name__ == '__main__':
    archive_github_issues('con', 'tinuous', 'teams/engineering')
```

### Forgejo Actions Integration

```yaml
# .forgejo/workflows/archive-github-issues.yml
name: Archive GitHub Issues
on:
  schedule:
    - cron: '0 3 * * 0'  # Weekly on Sunday 3 AM
  workflow_dispatch:

jobs:
  archive-issues:
    runs-on: forgejo-runner
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Install git-bug
        run: |
          wget https://github.com/git-bug/git-bug/releases/latest/download/git-bug_linux_amd64
          chmod +x git-bug_linux_amd64
          sudo mv git-bug_linux_amd64 /usr/local/bin/git-bug

      - name: Install dependencies
        run: pip install datalad

      - name: Archive issues for all projects
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          python scripts/archive_github_issues.py \
            --repos repos.txt \
            --dataset teams/engineering

      - name: Push results
        run: datalad push --to origin
```

## Alternative: Gitea/Forgejo Native Import

Forgejo (and Gitea) have **built-in issue migration**:

```bash
# Via API or web UI
# Import entire repository including issues
# From: GitHub, GitLab, Gogs, etc.
# To: Forgejo instance
```

### Comparison: git-bug vs Forgejo Import

| Feature | git-bug | Forgejo Import |
|---------|---------|----------------|
| **Storage** | Git objects | Forgejo database |
| **Offline access** | ✅ Yes | ❌ No (need server) |
| **Distributed** | ✅ Yes | ⚠️ Partial |
| **Query/search** | ⚠️ CLI only | ✅ Web UI |
| **Version control** | ✅ Full git | ❌ No versioning |
| **Setup** | Simple | Requires Forgejo |

### Recommendation for con/flux

**Use both, different purposes:**

1. **Forgejo Import** - For active projects
   - Import to Forgejo for web UI browsing
   - Team can continue using issue tracker
   - Good for collaboration

2. **git-bug** - For long-term archival
   - Store issues as git objects
   - Distributed, offline-first
   - Version control for project history
   - Backup/insurance

### Workflow

```
GitHub Project (active)
    ↓
    ├─→ Forgejo Import (web UI, active use)
    │       ↓
    │   Forgejo-aneksajo instance
    │
    └─→ git-bug Archive (long-term, git-native)
            ↓
        DataLad dataset in git-annex
```

## Other GitHub Archival Tools

### gh-archive
```bash
# GitHub CLI extension for archival
gh extension install meiji163/gh-archive

# Archive repository with issues
gh archive owner/repo
```

### git-archive-all
Archives git repository with submodules

### GitHub API + Custom Script
```python
# Fetch issues via API and store as JSON
import requests

def archive_issues(owner, repo):
    response = requests.get(
        f'https://api.github.com/repos/{owner}/{repo}/issues',
        params={'state': 'all', 'per_page': 100}
    )

    issues = response.json()

    # Save as JSON in git-annex
    with open(f'{repo}-issues.json', 'w') as f:
        json.dump(issues, f, indent=2)
```

**Trade-off:**
- Simpler (just JSON)
- But no distributed bug tracker features
- No sync back to GitHub

## Integration with Other con/flux Components

### Repository Structure

```
archives/github/repos/
├── tinuous/
│   ├── .git/               # Git repository
│   ├── .git/bugs/          # git-bug data
│   ├── ci-logs/            # con/tinuous output
│   └── issues-backup/      # JSON backup (redundant)
├── annextube/
│   ├── .git/
│   ├── .git/bugs/
│   └── ...
└── datalad/
    └── ...
```

### DataLad Subdataset Organization

```
con-flux-archives/                  # Root dataset
└── teams/
    └── engineering/
        └── github/
            ├── tinuous/            # Subdataset
            │   ├── code/          # Git clone
            │   ├── ci-logs/       # con/tinuous
            │   └── issues/        # git-bug
            └── annextube/         # Subdataset
                ├── code/
                └── issues/
```

### Provenance with datalad run

```bash
# Archive with provenance
datalad run \
  -m "Archive GitHub issues for tinuous" \
  --input config/github-repos.txt \
  --output teams/engineering/github/tinuous/issues/ \
  python scripts/archive_issues.py con/tinuous
```

## Complete GitHub Archival Solution

Combining all tools for comprehensive GitHub backup:

```
┌─────────────────────────────────────────┐
│  GitHub Repository                       │
│  - Code                                  │
│  - Issues                                │
│  - Discussions                           │
│  - CI/CD                                 │
│  - Wiki                                  │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┬──────────────┬─────────────┐
        │                 │              │             │
        ▼                 ▼              ▼             ▼
    ┌──────┐      ┌─────────────┐  ┌────────┐   ┌────────┐
    │ Code │      │   Issues    │  │CI Logs │   │  Wiki  │
    │ git  │      │  git-bug    │  │  con/  │   │  git   │
    │clone │      │   bridge    │  │tinuous │   │ clone  │
    └───┬──┘      └──────┬──────┘  └───┬────┘   └───┬────┘
        │                │             │            │
        └────────────────┴─────────────┴────────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │  DataLad Dataset        │
            │  (git-annex storage)    │
            └────────────┬────────────┘
                         │
                         ▼
            ┌─────────────────────────┐
            │  Forgejo-aneksajo       │
            │  (Web UI + Search)      │
            └─────────────────────────┘
```

## Recommended Approach for con/flux

### Minimal (Start Here)
```
✅ git clone (code)
✅ con/tinuous (CI logs)
✅ GitHub API → JSON (issues as simple backup)
```

### Enhanced (Add Later)
```
✅ Everything above, plus:
✅ git-bug (distributed issue tracking)
✅ Forgejo import (web UI for issues)
✅ git clone --mirror (complete including refs)
```

### Complete (Full Archival)
```
✅ Everything above, plus:
✅ Discussions archival (GitHub API)
✅ Project boards (GitHub API)
✅ Wiki archival (git clone wiki)
✅ Release assets (download binaries)
```

## Example: Complete con/tinuous Archival

```bash
#!/bin/bash
# Archive entire con/tinuous project from GitHub

REPO="con/tinuous"
DATASET="teams/engineering/github/tinuous"

# 1. Clone code
git clone https://github.com/$REPO $DATASET/code

# 2. Archive CI logs (already doing this)
# con/tinuous automatic

# 3. Archive issues with git-bug
cd $DATASET/code
git bug init
git bug bridge configure github --project $REPO
git bug bridge pull github

# 4. Backup issues as JSON (redundant but simple)
gh api repos/$REPO/issues --paginate > $DATASET/issues-backup.json

# 5. Clone wiki if exists
git clone https://github.com/$REPO.wiki $DATASET/wiki

# 6. Save with DataLad
datalad save -d $DATASET -m "Complete archive of $REPO"
```

## Sources

- [GitHub - git-bug/git-bug: Distributed, offline-first bug tracker embedded in git](https://github.com/git-bug/git-bug)
- [GitHub - git-bug/git-bug-migration: Migration tool for git-bug](https://github.com/git-bug/git-bug-migration)
- [Git Bug: Distributed, Offline-First Bug Tracker Embedded in Git, with Bridges | Hacker News](https://news.ycombinator.com/item?id=43971620)
- [Show HN: git-bug – Distributed bug tracker embedded in git | Hacker News](https://news.ycombinator.com/item?id=17782121)

## Summary

### For con/flux Issue Archival

**Primary approach:**
1. Simple JSON backup via GitHub API (easy, queryable)
2. Import to Forgejo for web UI browsing
3. git-bug for distributed, git-native archival

**Benefits:**
- Multiple backup formats
- Web UI via Forgejo
- Git-native via git-bug
- Offline access
- Version controlled

**Implementation priority:**
1. **Phase 1:** JSON backup (simple, works now)
2. **Phase 2:** Forgejo import (web UI)
3. **Phase 3:** git-bug (advanced, git-native)
