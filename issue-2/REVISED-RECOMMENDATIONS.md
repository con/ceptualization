# REVISED: Git-Native Recommendations for con/flux

## TL;DR - The Game Changer

**Forgejo-aneksajo** changes everything. It's a Forgejo fork with native git-annex support, providing a GitHub-like interface for DataLad datasets. Combined with your existing git/git-annex/DataLad expertise, this enables a **pure git-native approach** that's simpler, lighter, and more aligned with your workflow than traditional data lakes.

## The Git-Native Stack (RECOMMENDED)

```
Data Sources → Collection → git-annex repos → Forgejo-aneksajo → Access
```

### Core Components

1. **Storage: git-annex repositories** (not MinIO/S3)
   - Your primary data store
   - Everything version controlled
   - Distributed by design

2. **Management: Forgejo-aneksajo** (not custom web app)
   - GitHub-like UI for git-annex
   - Powers DataLad Hub (hub.datalad.org)
   - Handles 4500+ subdatasets, 15M files
   - Issues, PRs, CI/CD built-in

3. **Organization: DataLad hierarchical datasets** (already familiar)
   - Root dataset with subdatasets per team/source
   - Clone only what you need
   - Natural collaboration model

4. **ETL: DVC pipelines + DataLad run** (not Airflow/Spark)
   - DVC: Git-native pipeline orchestration
   - DataLad run: Rich provenance tracking
   - Both lightweight, both git-native

5. **Automation: Forgejo Actions** (GitHub Actions compatible)
   - Built into Forgejo-aneksajo
   - Schedule collections via YAML
   - No separate orchestration platform needed

6. **Existing Tools: con/tinuous, annextube** (keep using)
   - Already git-annex native
   - Just push to Forgejo for web access
   - Perfect fit for this architecture

## Why This Approach is Superior

### For Your Team

✅ **Leverages existing expertise** - You already know git/git-annex/DataLad
✅ **Lighter infrastructure** - Just Forgejo, no Spark/Trino/MinIO
✅ **Familiar workflows** - git clone, git push, git branch
✅ **Better provenance** - DataLad run tracks everything
✅ **Easier collaboration** - PRs and issues for data contributions

### Technical Benefits

✅ **Version control everywhere** - Not just metadata, all data
✅ **Distributed by default** - git's natural model
✅ **Reproducible** - DataLad run, DVC pipelines
✅ **Scalable** - Proven with 15M files on DataLad Hub
✅ **Open source** - No vendor lock-in

### Operational Benefits

✅ **Low maintenance** - Forgejo runs on Raspberry Pi
✅ **Fast deployment** - Hours, not weeks
✅ **No new skills** - Team already knows git
✅ **Self-hosted** - Full control
✅ **Lightweight** - No cluster management

## Comparison: Git-Native vs Traditional Data Lake

| Aspect | Git-Native (✅ Recommended) | Traditional Data Lake (⚠️ Optional) |
|--------|----------------------------|-----------------------------------|
| **Storage** | git-annex | MinIO + Iceberg |
| **Web UI** | Forgejo-aneksajo (free) | Custom + Superset ($$$) |
| **ETL** | DVC + DataLad run (lightweight) | Airflow + Spark (heavy) |
| **Versioning** | Native git | Iceberg snapshots |
| **Provenance** | DataLad run (rich) | Manual tracking |
| **Collaboration** | PRs, Issues | External tools |
| **Learning Curve** | Low (you know git) | High (new concepts) |
| **Infrastructure** | 1 server (Forgejo) | Cluster (Spark, DB, etc.) |
| **Deployment Time** | Hours | Weeks |
| **Maintenance** | Low | High |

## Revised Architecture

```
┌─────────────────────────────────────────────────┐
│  Data Sources                                    │
│  Slack, GitHub, Zoom, Telegram, YouTube, etc.   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Collection Scripts                              │
│  - slackdump wrapper                             │
│  - con/tinuous (existing)                        │
│  - annextube (existing)                          │
│  - New: telegram, matrix collectors              │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  ETL Layer (OPTIONAL)                            │
│  - DVC pipelines (if needed)                     │
│  - DataLad run (provenance)                      │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Storage: git-annex Repositories                 │
│                                                  │
│  con-flux-archives/      (root DataLad dataset)  │
│  ├── teams/                                      │
│  │   ├── engineering/   (subdataset)             │
│  │   │   ├── slack/     (subdataset)             │
│  │   │   ├── github/    (subdataset)             │
│  │   │   └── zoom/      (subdataset)             │
│  │   └── research/      (subdataset)             │
│  └── shared/            (subdataset)             │
│      └── youtube/       (subdataset)             │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Forgejo-aneksajo (Web UI + Management)          │
│  - Browse datasets and files                     │
│  - Issue tracking per dataset                    │
│  - Pull requests for contributions               │
│  - CI/CD (Forgejo Actions)                       │
│  - Access control                                │
│  - Search and discovery                          │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  Access Methods                                  │
│  - Git clone (developers)                        │
│  - DataLad install/get (researchers)             │
│  - Web UI (non-technical)                        │
│  - API (AI agents)                               │
└─────────────────────────────────────────────────┘
```

## Minimal Implementation (MVP)

### Infrastructure Needed
- **1 server** running Forgejo-aneksajo
- **Git hosting** (built-in to Forgejo)
- **Storage** for git-annex files (local or S3-compatible)

### Software Stack
```bash
# Core
- Forgejo-aneksajo (web UI + git hosting)
- git-annex (already installed)
- DataLad (already installed)
- DVC (pip install dvc)

# Collectors
- slackdump (for Slack)
- yt-dlp (already used in annextube)
- Telethon (for Telegram)
- Your existing tools (con/tinuous, annextube)
```

### No Need For
❌ MinIO (unless want S3-compatible special remote)
❌ Apache Iceberg (unless need SQL analytics)
❌ Apache Spark (unless heavy transformations)
❌ Airflow/Prefect (Forgejo Actions sufficient)
❌ PostgreSQL (unless want metadata queries)
❌ Kafka (unless need streaming)

## Step-by-Step MVP (4 Weeks)

### Week 1: Setup Forgejo-aneksajo
```bash
# Deploy (podman or docker)
podman run -d -p 3000:3000 \
  -v forgejo-data:/data \
  --name forgejo-aneksajo \
  codeberg.org/forgejo-aneksajo/forgejo-aneksajo:latest

# Create organization: con-flux
# Create repository: archives
```

### Week 2: Initialize Root Dataset
```bash
# Create hierarchical structure
datalad create con-flux-archives
cd con-flux-archives
datalad create -d . teams/engineering/slack
datalad create -d . teams/engineering/github
datalad create -d . teams/engineering/zoom
datalad create -d . shared/youtube

# Push to Forgejo
git remote add forgejo http://forgejo.example.com/con-flux/archives.git
datalad push --to forgejo
```

### Week 3: First Automated Collection (Slack)
```bash
# Create collector
cat > collectors/slack_daily.py << 'EOF'
import slackdump
import datalad.api as dl
from datetime import date

export = slackdump.export_all()
output = f'teams/engineering/slack/export-{date.today()}.json'

with open(output, 'w') as f:
    json.dump(export, f)

dl.save(path=output, message=f'Daily Slack export {date.today()}')
EOF

# Test manually
python collectors/slack_daily.py
```

### Week 4: Automate with Forgejo Actions
```yaml
# .forgejo/workflows/daily-collections.yml
name: Daily Data Collections
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily

jobs:
  slack:
    runs-on: forgejo-runner
    steps:
      - uses: actions/checkout@v3
      - run: pip install slackdump datalad
      - run: python collectors/slack_daily.py
      - run: datalad push --to origin

  # Add more jobs for other sources...
```

**Result:** Automated daily archival with full git history, browsable in Forgejo UI

## Integration with Existing Tools

### con/tinuous (CI Log Archival)
Already git-annex native! Just push to Forgejo:

```python
# In con/tinuous code
def archive_logs(build_id, logs):
    # Save to git-annex dataset
    log_file = f'teams/engineering/github/ci-logs/{build_id}.log'
    with open(log_file, 'w') as f:
        f.write(logs)

    # Commit and push
    dl.save(path=log_file, message=f'CI logs for {build_id}')
    dl.push(to='forgejo')
```

### annextube (YouTube Archival)
Already uses yt-dlp and git-annex! Just organize and push:

```python
# In annextube code
def archive_video(video_url):
    # Existing download logic with yt-dlp
    info = download_with_ytdlp(video_url)

    # Organize in DataLad structure
    channel_dataset = f'shared/youtube/{info["channel"]}'

    # Already in git-annex, just commit
    dl.save(
        dataset=channel_dataset,
        message=f'Add video: {info["title"]}'
    )

    # Make discoverable in Forgejo
    dl.push(to='forgejo')
```

### New Collectors
Follow the same pattern:

```python
class DataCollector:
    """Base pattern for all collectors"""

    def __init__(self, dataset_path):
        self.dataset = datalad.Dataset(dataset_path)

    def collect(self, source_id):
        # 1. Fetch data (API, web scraping, etc.)
        data = self.fetch(source_id)

        # 2. Save to dataset
        output_path = self.get_output_path(source_id)
        self.write(data, output_path)

        # 3. Commit with provenance
        self.dataset.save(
            path=output_path,
            message=self.get_commit_message(source_id)
        )

        # 4. Push to Forgejo (optional, can batch)
        # self.dataset.push(to='forgejo')

        return output_path
```

## DVC Integration (Optional but Recommended)

DVC is git-native and works beautifully with DataLad:

```yaml
# dvc.yaml - Define your pipeline
stages:
  collect_slack:
    cmd: python collectors/slack_collector.py
    deps:
      - collectors/slack_collector.py
      - config/slack.yaml
    outs:
      - teams/engineering/slack/raw/

  normalize_messages:
    cmd: python transform/normalize_slack.py
    deps:
      - transform/normalize_slack.py
      - teams/engineering/slack/raw/
    outs:
      - teams/engineering/slack/normalized/

  daily_summary:
    cmd: python aggregate/daily_summary.py
    deps:
      - aggregate/daily_summary.py
      - teams/engineering/slack/normalized/
    outs:
      - reports/daily/
```

```bash
# Run entire pipeline
dvc repro

# Commit results (DVC creates git-committable metafiles)
git add dvc.lock teams/ reports/
datalad save -m "Daily pipeline execution"
```

**Benefits:**
- Pipeline definition versioned in git
- Automatic dependency tracking
- Reproducible transformations
- Works with git-annex large files
- CI/CD friendly

## When to Add Traditional Components

You might still want some traditional data lake components later:

### Add MinIO if:
- Want S3-compatible storage for git-annex special remotes
- Need to integrate with S3-native tools
- Want object storage for very large files

**Usage:** git-annex special remote
```bash
git annex initremote minio type=S3 host=minio.local bucket=con-flux
```

### Add Iceberg + Trino if:
- Need SQL queries on archived data
- Want to run analytical workloads (BI tools)
- Have structured data that benefits from table format

**Usage:** Analytics layer on top of git-annex data
```
git-annex repos (source of truth)
    ↓
Iceberg tables (SQL query layer)
    ↓
Trino (query engine for BI tools)
```

### Add Airflow/Prefect if:
- Forgejo Actions insufficient for orchestration
- Need complex dynamic workflows
- Want centralized monitoring dashboard

**Usage:** Orchestrate `datalad run` and `dvc repro` commands
```python
@flow
def complex_pipeline():
    # Use Prefect for orchestration
    # But still execute via datalad/dvc
    datalad.run(...)
    dvc.repro(...)
```

## Why NOT Traditional Data Lake First?

The research in the other documents (MinIO, Iceberg, Spark, etc.) is valuable, but it's **optional** and **overkill** for your use case:

### Reasons to Avoid (Initially)

❌ **Unnecessary complexity** - You don't need Spark if Python scripts suffice
❌ **Heavy infrastructure** - Clusters, databases, management overhead
❌ **New learning curve** - Team would need to learn Spark, Iceberg, etc.
❌ **Doesn't leverage strengths** - Ignores your git/git-annex expertise
❌ **Worse collaboration** - No built-in PR/issue model
❌ **More maintenance** - Each component needs care and feeding

### Your Situation is Different

Most organizations don't have:
- ✅ Deep git/git-annex/DataLad expertise
- ✅ Existing git-native archival tools
- ✅ Strong version control culture
- ✅ Need for rich provenance tracking
- ✅ Distributed collaboration model

You do! So leverage it.

## Comparison to citation-collector

The issue mentions con/citation-collector as inspiration. Here's how con/flux should be similar/different:

### Similarities (Adopt These)
- ✅ Configuration-driven design
- ✅ Plugin architecture for sources
- ✅ Git-based storage
- ✅ Metadata-focused
- ✅ Command-line first, web UI secondary

### Differences (Scale Up)
- 📈 More data types (not just citations)
- 📈 Larger files (videos, not just text)
- 📈 More frequent updates (daily vs on-demand)
- 📈 More sources (10+ vs 2-3)
- 📈 Team collaboration (not single user)

### Pattern to Follow
```
con/citation-collector:
- Git repo with Python scripts
- Config files for sources
- DataLad for datasets
- Command-line collection

con/flux (scaled up):
- Git repos (many) with Python scripts
- Config files for sources (many)
- DataLad hierarchical datasets
- Automated collection (Forgejo Actions)
- Web UI (Forgejo-aneksajo)
```

## Migration Path: If You Later Need Data Lake

If you start git-native and later need SQL analytics:

### Phase 1: Git-Native (Start Here)
```
Sources → git-annex repos → Forgejo UI
```
**Duration:** Weeks to deploy
**Complexity:** Low
**Value:** Immediate

### Phase 2: Add Analytics Layer (Later)
```
Sources → git-annex repos → Forgejo UI
                ↓
           Iceberg tables → Trino → BI tools
```
**Duration:** Months to deploy
**Complexity:** Medium
**Value:** If SQL queries needed

**Key:** git-annex remains source of truth!

### Phase 3: Add Streaming (Much Later)
```
Sources → Kafka → git-annex repos → Forgejo UI
                        ↓
                   Iceberg → Trino → BI
```
**Duration:** Months to deploy
**Complexity:** High
**Value:** If real-time needed

## Success Metrics

### MVP Success (1 Month)
- ✅ Forgejo-aneksajo deployed
- ✅ Root dataset with subdatasets
- ✅ One automated collection (Slack)
- ✅ Viewable in Forgejo web UI

### Production Success (3 Months)
- ✅ 5+ data sources automated
- ✅ con/tinuous and annextube integrated
- ✅ Forgejo Actions for all collections
- ✅ Team using web UI to browse
- ✅ Issues/PRs for new sources

### Scale Success (6 Months)
- ✅ 10+ data sources
- ✅ Multiple teams with subdatasets
- ✅ DVC pipelines for transformations
- ✅ AI agent consuming data via API
- ✅ <1 hour/week maintenance

## Recommended Reading Order

1. **Start here:** `git-native-approach.md` (comprehensive guide)
2. **Then:** `chat-archival-tools.md` (specific collectors)
3. **Then:** `video-archival-tools.md` (more collectors)
4. **Optional:** Other docs (if you later need data lake components)

## Quick Decision Matrix

### Use Git-Native Approach If:
✅ You know git/git-annex/DataLad (you do!)
✅ Data needs version control (yes)
✅ Team collaboration important (yes)
✅ Provenance tracking important (yes)
✅ Want lightweight infrastructure (yes)
✅ Self-hosting preference (yes)

**Score: 6/6 → Use git-native!**

### Add Data Lake Components If:
- Need SQL on archived data (no, not yet)
- Running analytical workloads (no, not yet)
- Streaming real-time required (no)
- Team wants Spark/Trino (no)

**Score: 0/4 → Don't need data lake yet!**

## Final Recommendation

### Primary: Git-Native Stack
```
Forgejo-aneksajo + DataLad + DVC + Forgejo Actions
```

**Deploy immediately, delivers value in weeks**

### Optional: Traditional Components
```
MinIO + Iceberg + Trino + Airflow
```

**Evaluate later if SQL analytics needed**

---

## Next Steps

1. **Review `git-native-approach.md`** - Full technical details
2. **Deploy Forgejo-aneksajo** - Start with MVP
3. **Migrate con/tinuous and annextube** - Push to Forgejo
4. **Build first new collector** - Follow DataLad pattern
5. **Automate with Forgejo Actions** - Schedule collections
6. **Iterate** - Add sources, refine workflows

**This approach leverages your strengths and delivers value quickly!**

---

**Research Date:** February 5, 2026
**Issue:** https://github.com/con/ceptualization/issues/2
**Key Discovery:** Forgejo-aneksajo changes the game for git-annex/DataLad users
