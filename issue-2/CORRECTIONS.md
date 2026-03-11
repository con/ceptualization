# Important Corrections Based on User Feedback

## Date: February 5, 2026

## Key Corrections

### 1. ❌ DVC is NOT in the core stack
### 2. ✅ DataLad run + duct are the primary tools (already using)
### 3. ✅ git-bug should be considered for GitHub issues archival

## Corrected Core Stack

**BEFORE (incorrect):**
```
✅ Forgejo-aneksajo
✅ git-annex
✅ DataLad
✅ DVC                 ← REMOVE from core
✅ slackdump
...
```

**AFTER (correct):**
```
✅ Forgejo-aneksajo    - Web UI + git hosting + CI/CD
✅ git-annex           - Storage (already have)
✅ DataLad             - Dataset management (already have)
✅ DataLad run         - Provenance tracking (already use per CLAUDE.md)
✅ duct                - Output logging (already have via con/duct)
✅ slackdump           - Slack archival
✅ Telethon            - Telegram archival
✅ yt-dlp              - YouTube (already using in annextube)
✅ con/tinuous         - CI logs (already have)
✅ annextube           - YouTube + captions (already have)
✅ git-bug             - GitHub issues archival (optional but valuable)
```

**Optional (add if needed):**
```
⚪ DVC                 - Only if complex multi-stage pipelines emerge
⚪ MinIO               - S3-compatible special remote
⚪ Apache Iceberg      - If SQL analytics needed
⚪ Trino               - If analytical queries needed
⚪ Prefect/Airflow     - If Forgejo Actions insufficient
```

## Why This Correction Matters

### User's Point #1: DataLad run > DVC
**User said:** "I think where needed provenance on running, should use 'datalad run' may be with 'duct'"

**Why they're right:**
1. ✅ Already using `datalad run` (per CLAUDE.md instructions)
2. ✅ Already using `duct` for output capture (con/duct)
3. ✅ Provides rich provenance (inputs, outputs, command, checksums)
4. ✅ Reproducible with `datalad rerun`
5. ✅ No new tool to learn
6. ✅ Native git-annex integration

**DVC adds value only when:**
- Need complex DAG visualization
- 5+ interdependent pipeline stages
- Want explicit YAML pipeline definitions
- ML experiment tracking

**For con/flux:** Start without DVC, add only if pipelines become complex

### User's Point #2: git-bug for GitHub
**User said:** "For backup/migration from github -- git-bug should also be considered I guess"

**Why they're right:**
- ✅ Distributed, git-native issue tracker
- ✅ Can import/export GitHub issues
- ✅ Stores issues as git objects (not files)
- ✅ Offline-first, travels with repository
- ✅ Perfect for archiving project discussions

**Use cases for con/flux:**
1. Archive GitHub issues alongside code
2. Preserve project discussions before repo deletion
3. Version control for bugs/features
4. Backup of project management data

## Updated Architecture Diagram

```
┌────────────────────────────────────────────────┐
│  Data Sources                                   │
│  Slack, GitHub (code+issues), Zoom, YouTube    │
└──────────────────┬─────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────┐
│  Collection (with provenance)                   │
│  - DataLad run (command execution)             │
│  - duct (stdout/stderr capture)                │
│  - git-bug (GitHub issues)                     │
└──────────────────┬─────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────┐
│  Storage: git-annex Repositories                │
│  - Everything version controlled                │
│  - Full command provenance                      │
│  - Reproducible with datalad rerun             │
└──────────────────┬─────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────┐
│  Management: Forgejo-aneksajo                   │
│  - Browse datasets via web UI                   │
│  - Issues, PRs, CI/CD                           │
└────────────────────────────────────────────────┘
```

## Correct Workflow Examples

### Example 1: Slack Collection
```bash
# Collect with full provenance (no DVC needed)
duct --output-directory logs/slack/$(date -I) \
  datalad run \
    -m "Daily Slack collection $(date -I)" \
    --input config/slack.yaml \
    --output teams/engineering/slack/$(date -I).json \
    --output logs/slack/$(date -I) \
    python collectors/slack_collector.py

# Result:
# - Data: teams/engineering/slack/2026-02-05.json
# - Logs: logs/slack/2026-02-05/protocol.txt (stdout/stderr)
# - Provenance: Full command, inputs, outputs in git history
# - Reproducible: datalad rerun <commit>
```

### Example 2: GitHub Issues Archival
```bash
# Archive GitHub issues with git-bug
cd archives/github/repos/tinuous

# Initialize git-bug (first time)
git bug init

# Configure GitHub bridge
git bug bridge configure github \
  --project con/tinuous \
  --token $GITHUB_TOKEN

# Import issues
git bug bridge pull github

# Commit with DataLad provenance
datalad save -m "Archive GitHub issues for con/tinuous"

# Result:
# - Issues stored as git objects in .git/bugs/
# - Distributed, offline-first
# - Can query: git bug ls, git bug show <id>
# - Can sync back: git bug bridge push github
```

### Example 3: YouTube Collection (via annextube)
```bash
# Use existing annextube with provenance
duct --output-directory logs/youtube/$(date -I) \
  datalad run \
    -m "Archive YouTube video and captions" \
    --input config/youtube-channels.txt \
    --output shared/youtube/ \
    --output logs/youtube/$(date -I) \
    annextube archive https://youtube.com/watch?v=VIDEO_ID

# annextube already uses yt-dlp and git-annex
# Just wrap with datalad run + duct for provenance
```

## Reading Order (Corrected)

1. **datalad-run-vs-dvc.md** ⭐ READ THIS FIRST
   - Explains why DataLad run > DVC for your use case
   - Shows duct integration
   - When/if to consider DVC

2. **git-bug-integration.md** ⭐ READ SECOND
   - How to archive GitHub issues
   - git-bug vs Forgejo import
   - Integration with DataLad

3. **git-native-approach.md** 📘 COMPREHENSIVE GUIDE
   - Full technical details
   - Now correctly emphasizes DataLad run + duct
   - DVC mentioned as optional

4. **REVISED-RECOMMENDATIONS.md**
   - Quick overview (note: still mentions DVC in a few places - see this CORRECTIONS.md for accurate info)

5. Other documents as needed

## Summary of Changes

| Component | Before | After | Rationale |
|-----------|--------|-------|-----------|
| **ETL/Provenance** | DVC + DataLad run | DataLad run + duct | Already using, simpler |
| **DVC** | Core stack | Optional | Only if complex pipelines |
| **duct** | Not mentioned | Core stack | Already using (con/duct) |
| **git-bug** | Not mentioned | Recommended | GitHub issues archival |
| **Output logging** | Not emphasized | Via duct | Existing practice |

## What This Means Practically

### Minimal Stack (Deploy This)
```
1. Forgejo-aneksajo (1 server)
2. Your existing tools:
   - git-annex
   - DataLad (with 'datalad run')
   - duct (con/duct)
   - con/tinuous
   - annextube
3. New collectors:
   - slackdump
   - Telethon
   - git-bug
```

**Infrastructure:** 1 server
**New tools to learn:** 3 (slackdump, Telethon, git-bug)
**Tools to NOT learn:** DVC, Airflow, Spark, Iceberg, Trino

### Collector Pattern
```python
#!/usr/bin/env python3
"""Standard collector pattern for con/flux"""

def collect():
    """
    Collect data, print progress to stdout.
    Will be wrapped with:
      duct (capture output)
      datalad run (track provenance)
    """
    print("Starting collection...")

    # Do the work
    data = fetch_from_source()

    # Save (git-annex handles large files automatically)
    output_path = f'data/{datetime.now().date()}.json'
    with open(output_path, 'w') as f:
        json.dump(data, f)

    print(f"✓ Saved to {output_path}")
    return 0

if __name__ == '__main__':
    sys.exit(collect())
```

**Execute with:**
```bash
duct --output-directory logs/collector/$(date -I) \
  datalad run \
    -m "Collection run" \
    --input config.yaml \
    --output data/ \
    --output logs/collector/$(date -I) \
    python collector.py
```

**Result:**
- ✅ Data versioned in git-annex
- ✅ Full provenance (command, inputs, outputs, checksums)
- ✅ Stdout/stderr captured in logs/
- ✅ Reproducible with `datalad rerun`
- ✅ No DVC needed

## Action Items

1. ✅ Read **datalad-run-vs-dvc.md** to understand the rationale
2. ✅ Read **git-bug-integration.md** for GitHub issues archival
3. ✅ Deploy Forgejo-aneksajo (as originally planned)
4. ✅ Use DataLad run + duct (not DVC) for collections
5. ✅ Consider git-bug for archiving GitHub project metadata
6. ⚪ Add DVC only if pipelines become complex (5+ stages)

## Thank You

User feedback corrected a significant oversight. The initial recommendation included DVC when:
- You already use `datalad run` for provenance
- You already use `duct` for output logging
- Your CLAUDE.md even documents using `datalad run`

The corrected approach is **simpler** (fewer tools), **familiar** (what you already do), and **sufficient** (rich provenance without DVC complexity).

git-bug was also an excellent suggestion - perfectly complements the git-native approach for archiving GitHub project metadata beyond just code.
