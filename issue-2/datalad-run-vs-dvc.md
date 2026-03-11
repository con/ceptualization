# DataLad run vs DVC: What to Use When

## The Correction

**Initial recommendation:** Use DVC for ETL pipelines
**Revised recommendation:** Use `datalad run` (+ `duct`) for provenance, DVC only if you need its specific features

## Why DataLad run is Better for Your Use Case

### You Already Have It
- ✅ Part of DataLad (already installed)
- ✅ Team already familiar with it
- ✅ Integrated with git-annex
- ✅ Your CLAUDE.md even mentions using `datalad run`!

From your `.claude/CLAUDE.md`:
> If there is a script (created by you or not) which would introduce some changes, then use `datalad run` command (with -m "COMMIT MESSAGE" option) to run that command.

### DataLad run Features

```bash
# Run command with full provenance
datalad run -m "Collect Slack data" \
  --input config/slack.yaml \
  --output teams/engineering/slack/messages.json \
  python collectors/slack_collector.py
```

**Records:**
- Command executed
- Input files (with checksums)
- Output files (with checksums)
- Timestamp and author
- Exit code

**Benefits:**
- Reproducible: `datalad rerun <commit-hash>`
- Integrated with git-annex large files
- No separate tool needed
- Clean provenance in git history

### Adding con/duct

**[con/duct](https://github.com/con/duct)** - Standard output archival

```bash
# Capture stdout/stderr alongside data
duct --output-directory teams/engineering/slack/logs \
  datalad run -m "Daily Slack collection" \
    python collectors/slack_collector.py
```

**Captures:**
- stdout → protocol.txt
- stderr → protocol.txt (marked)
- Command output → result files
- All committed together

**Perfect for debugging:**
- See what collector printed
- Trace errors
- Audit trail

## When DVC Would Add Value

DVC is useful when you need:

### 1. Complex DAG Visualization
```yaml
# dvc.yaml - explicit dependency graph
stages:
  collect:
    deps: [collectors/slack.py]
    outs: [bronze/slack/]

  normalize:
    deps: [transform/normalize.py, bronze/slack/]
    outs: [silver/messages/]

  aggregate:
    deps: [aggregate/summarize.py, silver/messages/]
    outs: [gold/summaries/]
```

**DVC provides:**
- Visual pipeline graph
- Automatic change detection
- Selective stage re-execution

**DataLad run equivalent:**
```bash
# Run each stage separately
datalad run -m "Collect" --output bronze/slack/ python collectors/slack.py
datalad run -m "Normalize" --input bronze/slack/ --output silver/messages/ python transform/normalize.py
datalad run -m "Aggregate" --input silver/messages/ --output gold/summaries/ python aggregate/summarize.py
```

**Trade-off:**
- DataLad: More explicit provenance per step
- DVC: Better visualization of dependencies

### 2. ML Experiment Tracking
If you're doing machine learning:
- Track parameters (learning rate, batch size)
- Compare metrics across runs
- Manage model versions

**For con/flux:** Probably not needed initially

### 3. External Dependency Management
DVC can track external data sources (URLs, databases)

**For con/flux:** You're archiving everything locally, so not needed

## Recommended Approach for con/flux

### Simple Collections: DataLad run
```bash
# Single-step collection with provenance
datalad run -m "Daily Slack export $(date -I)" \
  --input config/slack.yaml \
  --output teams/engineering/slack/$(date -I).json \
  python collectors/slack_collector.py
```

### Collections with Output Logging: duct + DataLad run
```bash
# Capture stdout/stderr alongside data
duct --output-directory teams/engineering/slack/logs/$(date -I) \
  datalad run -m "Daily Slack export $(date -I)" \
    --input config/slack.yaml \
    --output teams/engineering/slack/$(date -I).json \
    python collectors/slack_collector.py
```

### Complex Multi-Stage Pipelines: Consider DVC
Only if you have:
- 5+ stages with complex dependencies
- Need to visualize pipeline DAG
- Want selective re-execution
- Team comfortable with YAML pipeline definitions

**Initial recommendation:** Start with `datalad run`, add DVC only if needed

## Pattern for con/flux Collections

### Collector Script Pattern
```python
#!/usr/bin/env python3
"""Slack daily collector - designed for datalad run"""
import sys
import json
from datetime import date
import slackdump

def collect():
    """Collect and print to stdout (captured by duct)"""
    print(f"Starting Slack collection: {date.today()}")

    try:
        export = slackdump.export_all()

        output_file = f'teams/engineering/slack/{date.today()}.json'
        with open(output_file, 'w') as f:
            json.dump(export, f)

        print(f"✓ Collected {len(export)} messages")
        print(f"✓ Written to {output_file}")
        return 0

    except Exception as e:
        print(f"✗ Error: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(collect())
```

### Execution with Full Provenance
```bash
# Complete provenance capture
duct --output-directory logs/slack/$(date -I) \
  datalad run \
    -m "Daily Slack collection $(date -I)" \
    --input config/slack.yaml \
    --output 'teams/engineering/slack/*.json' \
    --output 'logs/slack/$(date -I)' \
    python collectors/slack_collector.py
```

**Result in git:**
- Commit message: "Daily Slack collection 2026-02-05"
- Provenance: Command, inputs, outputs, checksums
- Logs: stdout/stderr in logs/slack/2026-02-05/
- Data: teams/engineering/slack/2026-02-05.json

### Query Provenance Later
```bash
# See how data was collected
git log --all -p teams/engineering/slack/2026-02-05.json

# Re-run if needed
datalad rerun <commit-hash>
```

## Comparison Table

| Feature | DataLad run | DVC | DataLad run + duct |
|---------|-------------|-----|-------------------|
| **Provenance** | ✅ Rich | ⚠️ Basic | ✅ Very Rich |
| **Stdout capture** | ❌ No | ❌ No | ✅ Yes |
| **Reproducibility** | ✅ `rerun` | ✅ `repro` | ✅ `rerun` |
| **DAG visualization** | ❌ No | ✅ Yes | ❌ No |
| **Learning curve** | Low | Medium | Low |
| **git-annex integration** | ✅ Native | ⚠️ Works | ✅ Native |
| **Already using** | ✅ Yes | ❌ No | ✅ Yes (duct) |

## Forgejo Actions Integration

With Forgejo Actions, you can automate `datalad run`:

```yaml
# .forgejo/workflows/daily-slack.yml
name: Daily Slack Collection
on:
  schedule:
    - cron: '0 2 * * *'

jobs:
  collect:
    runs-on: forgejo-runner
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Install dependencies
        run: |
          pip install datalad slackdump
          pip install git+https://github.com/con/duct

      - name: Collect with provenance
        env:
          SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
        run: |
          DATE=$(date -I)
          duct --output-directory logs/slack/$DATE \
            datalad run \
              -m "Daily Slack collection $DATE" \
              --input config/slack.yaml \
              --output "teams/engineering/slack/$DATE.json" \
              --output "logs/slack/$DATE" \
              python collectors/slack_collector.py

      - name: Push results
        run: |
          datalad push --to origin
```

## Verdict

### For con/flux
✅ **Use DataLad run** (with duct for output logging)
⚪ **Consider DVC** only if complex multi-stage pipelines emerge

### Why
- You already use `datalad run` (per CLAUDE.md)
- You already use `duct` for output archival
- Rich provenance without new tools
- Native git-annex integration
- Team already familiar
- Simpler stack

### When to Add DVC
- Pipeline grows to 5+ interdependent stages
- Need DAG visualization
- Team wants explicit pipeline definitions
- ML experiment tracking needed

## Real-World Example: con/tinuous

Your existing `con/tinuous` tool likely already follows this pattern:
1. Collect CI logs
2. Save to git-annex repository
3. Commit with provenance

**Can be enhanced:**
```bash
# In con/tinuous collection logic
duct --output-directory logs/ci/$BUILD_ID \
  datalad run \
    -m "Archive CI logs for build $BUILD_ID" \
    --output "teams/engineering/github/ci-logs/$BUILD_ID.log" \
    con/tinuous fetch $BUILD_ID
```

**Benefits:**
- Full command provenance
- Captured stdout/stderr
- Reproducible
- No new tools needed

## Revised Stack Recommendation

### Core (No DVC)
```
✅ git-annex           - Storage
✅ DataLad             - Dataset management + provenance (run)
✅ duct                - Output logging
✅ Forgejo-aneksajo    - Web UI + CI/CD
✅ Forgejo Actions     - Automation
```

### Optional (Add If Needed)
```
⚪ DVC                 - If complex pipelines emerge
⚪ MinIO               - If need S3 special remote
⚪ Prefect             - If Forgejo Actions insufficient
```

## Summary

**Your instinct was correct:**
- `datalad run` for provenance ✅
- `duct` for output capture ✅
- No need for DVC unless pipelines get complex ✅

**Revised recommendation:**
- Remove DVC from initial stack
- Emphasize `datalad run` + `duct` pattern
- Add DVC to "optional, if needed later" category

This keeps the stack simpler and leverages tools you already use!
