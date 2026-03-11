# Git-Native Approach for con/flux

## Overview

This revised analysis focuses on building con/flux as a **git/git-annex/DataLad-native** system, leveraging your existing expertise and infrastructure. This approach treats git-annex repositories as the primary data store, not just for metadata.

## Key Discovery: Forgejo-aneksajo

### What is Forgejo-aneksajo?

**Forgejo-aneksajo** is a Forgejo variant with native git-annex support, making it the **perfect web UI and management layer** for con/flux.

- **Name:** "aneksaĵo" is Esperanto for "annex" (matching "forĝejo" = "forge")
- **Developer:** Matthias Riße (based on earlier work by Nick Guenther)
- **Production Use:** Powers DataLad Hub (hub.datalad.org)
- **Status:** Mature, proven at scale

### Key Features

#### Native git-annex Integration
- Browse git-annex content through web UI
- View file metadata without downloading
- Web-based access to annexed files
- Seamless DataLad dataset hosting

#### GitHub-Like Interface
- Issue tracking per dataset
- Pull requests for data contributions
- CI/CD integration (GitHub Actions compatible)
- Wiki, releases, webhooks

#### Massive Scale Support
- Handle ~4500 subdatasets
- 15 million file records accessible
- Root dataset as entry point to hierarchy
- Efficient UI even with large datasets

#### Lightweight & Self-Hosted
- Runs on Raspberry Pi
- Low resource requirements
- Independent/community-driven
- Privacy-focused

### Why Forgejo-aneksajo is Perfect for con/flux

✅ **Native git-annex** - Not an afterthought, it's built-in
✅ **Web UI** - Browse and manage datasets without command line
✅ **Issue tracking** - Track data collection issues per source
✅ **Pull requests** - Contribute new data sources via PRs
✅ **CI/CD** - Automate collection workflows
✅ **Self-hosted** - Full control, no vendor lock-in
✅ **Proven at scale** - DataLad Hub demonstrates it works

## Revised Architecture: Git-Native Stack

```
┌────────────────────────────────────────────────┐
│  Data Sources: Slack, GitHub, Zoom, etc.       │
└─────────────────────┬──────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────┐
│  Collection Layer                               │
│  - DataLad run (provenance tracking)            │
│  - DVC pipelines (git-native ETL)               │
│  - Custom scripts (con/tinuous, annextube)      │
└─────────────────────┬──────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────┐
│  Storage: git-annex repositories                │
│  - One repo per data source or team             │
│  - Hierarchical DataLad datasets                │
│  - Special remotes for large files              │
└─────────────────────┬──────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────┐
│  Management: Forgejo-aneksajo                   │
│  - Web UI for browsing                          │
│  - Issue tracking per dataset                   │
│  - CI/CD for automation                         │
│  - Access control and permissions               │
└─────────────────────┬──────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────┐
│  Access Layer                                   │
│  - Git clone (researchers)                      │
│  - DataLad install/get                          │
│  - Web UI (non-technical users)                 │
│  - API (AI agents)                              │
└────────────────────────────────────────────────┘
```

## Git-Native Technology Stack

### Core Storage: git-annex
**Purpose:** Primary data storage, not just large files

**Benefits:**
- Version control for ALL data
- Distributed by design
- Efficient for large files
- Content addressing (checksums)
- Flexible special remotes

**Structure:**
```
con-flux-archives/           # Root DataLad dataset
├── .git/
├── .datalad/
├── teams/
│   ├── engineering/         # Subdataset
│   │   ├── .git/
│   │   ├── slack/          # Subdataset
│   │   ├── github/         # Subdataset
│   │   └── zoom/           # Subdataset
│   └── research/           # Subdataset
└── shared/                 # Subdataset
```

### Web UI & Management: Forgejo-aneksajo
**Purpose:** GitHub-like interface for git-annex repos

**Features:**
- Repository browsing
- Issue tracking per dataset
- Pull requests for contributions
- CI/CD automation
- Access control
- Search and discovery

**Deployment:**
```bash
# Using podman (as documented by DataLad)
podman run -d \
  -p 3000:3000 \
  -v forgejo-data:/data \
  --name forgejo-aneksajo \
  codeberg.org/forgejo-aneksajo/forgejo-aneksajo:latest
```

### Provenance & ETL: DataLad run + duct
**Purpose:** Git-native command execution with full provenance

#### DataLad run (Primary)
DataLad run provides rich provenance tracking (you already use this per CLAUDE.md):

**Benefits:**
- Full command provenance (inputs, outputs, checksums)
- Reproducible: `datalad rerun <commit>`
- Native git-annex integration
- Already familiar to your team
- No additional tools needed

**Example:**
```bash
# Collect with full provenance
datalad run \
  -m "Collect Slack data 2026-02-05" \
  --input config/slack.yaml \
  --output teams/engineering/slack/2026-02-05.json \
  python collectors/slack_collector.py

# Later: reproduce exactly
datalad rerun <commit-hash>
```

#### duct (Output Logging)
con/duct captures stdout/stderr alongside data:

**Benefits:**
- Archive command output
- Debug information preserved
- Full audit trail
- Already using in your projects

**Example:**
```bash
# Capture all output
duct --output-directory logs/slack/2026-02-05 \
  datalad run \
    -m "Collect Slack data" \
    --input config/slack.yaml \
    --output teams/engineering/slack/2026-02-05.json \
    --output logs/slack/2026-02-05 \
    python collectors/slack_collector.py
```

**Result:** Command output (stdout/stderr) saved alongside data for debugging

#### DataLad run
Alternative/complementary to DVC, with richer provenance:

```bash
# Collect with provenance tracking
datalad run -m "Collect Slack data" \
  --input config/slack.yaml \
  --output bronze/slack/messages.json \
  python collectors/slack_collector.py

# DataLad records:
# - Command executed
# - Input files (with checksums)
# - Output files (with checksums)
# - Timestamp and author
```

**Re-execute:**
```bash
# Re-run based on recorded provenance
datalad rerun <commit-hash>
```

### Orchestration: Forgejo CI + Optional Prefect
**Purpose:** Automate scheduled collections

#### Forgejo Actions (GitHub Actions compatible)
```yaml
# .forgejo/workflows/daily-collection.yml
name: Daily Data Collection
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
  workflow_dispatch:     # Manual trigger

jobs:
  collect:
    runs-on: forgejo-runner
    steps:
      - uses: actions/checkout@v3

      - name: Install dependencies
        run: |
          pip install -r requirements.txt

      - name: Run collection pipeline
        run: |
          dvc repro

      - name: Commit results
        run: |
          git config user.name "con/flux bot"
          git config user.email "bot@example.com"
          git add bronze/ silver/ gold/ dvc.lock
          git commit -m "Automated collection $(date -I)" || true
          git push
```

#### Optional: Prefect for Complex Workflows
For workflows that need:
- Dynamic task generation
- Complex dependencies
- External API coordination
- Real-time monitoring

```python
from prefect import flow, task
import datalad.api as dl

@flow(name="slack-collection")
def collect_slack():
    # Discover channels
    channels = discover_slack_channels()

    # Collect each (runs in parallel)
    for channel in channels:
        collect_channel.submit(channel)

    # Commit to DataLad
    commit_to_datalad()

@task
def collect_channel(channel_id):
    # Use datalad run for provenance
    dl.run(
        cmd=f"python collectors/slack.py {channel_id}",
        inputs=["config/slack.yaml"],
        outputs=[f"bronze/slack/{channel_id}.json"]
    )
```

### Data Organization: Hierarchical DataLad Datasets

#### Structure
```
con-flux-archives/                    # Root dataset on Forgejo
│
├── teams/                            # Organization by team
│   ├── engineering/                  # Team dataset
│   │   ├── slack/                   # Source dataset
│   │   │   ├── channels/
│   │   │   │   ├── general.jsonl
│   │   │   │   └── random.jsonl
│   │   │   └── metadata.yaml
│   │   ├── github/                  # Source dataset
│   │   │   ├── ci-logs/
│   │   │   └── issues/
│   │   └── zoom/                    # Source dataset
│   │       └── recordings/
│   └── research/                    # Team dataset
│       ├── slack/
│       └── papers/
│
└── shared/                           # Cross-team resources
    ├── youtube/                     # Source dataset
    │   ├── con-channel/
    │   └── metadata/
    └── conferences/
```

#### Benefits
- **Modular:** Clone only what you need
- **Distributed:** Each team owns their datasets
- **Versioned:** All changes tracked
- **Discoverable:** Browse in Forgejo UI
- **Collaborative:** Issues and PRs per dataset

#### Access Patterns
```bash
# Clone root dataset (lightweight, just structure)
datalad clone https://forgejo.example.com/con/con-flux-archives

# Install specific subdataset
cd con-flux-archives
datalad install teams/engineering/slack

# Get actual data (on demand)
datalad get teams/engineering/slack/channels/general.jsonl

# Update from remote
datalad update --merge
```

## Integration with Existing Tools

### con/tinuous
**Current:** CI log archival into git/git-annex

**Integration:**
```python
# con/tinuous output → git-annex repo → Forgejo
def archive_ci_logs(build_id):
    # Existing con/tinuous logic
    logs = fetch_ci_logs(build_id)

    # Save to git-annex dataset
    log_path = f"teams/engineering/github/ci-logs/{build_id}.log"
    with open(log_path, 'w') as f:
        f.write(logs)

    # Use datalad save for provenance
    datalad.save(
        dataset='.',
        path=log_path,
        message=f"CI logs for build {build_id}"
    )

    # Push to Forgejo
    datalad.push(to='forgejo')
```

### annextube (yt-dlp wrapper)
**Current:** YouTube archival with yt-dlp → git-annex

**Integration:**
```python
# annextube → git-annex dataset → Forgejo
def archive_youtube_video(video_url):
    # Use existing annextube logic
    info = annextube.download(video_url)

    # Already in git-annex, just organize
    dataset_path = f"shared/youtube/{info['channel']}"

    # Commit with metadata
    datalad.save(
        dataset=dataset_path,
        message=f"Add video: {info['title']}"
    )

    # Make discoverable in Forgejo
    datalad.push(to='forgejo')
```

### New Collectors (Slack, Telegram)
**Pattern:** Follow con/tinuous and annextube model

```python
class SlackCollector:
    def __init__(self, dataset_path):
        self.dataset = datalad.Dataset(dataset_path)

    def collect(self, channel_id):
        # Use slackdump
        export = slackdump.export_channel(channel_id)

        # Save to git-annex
        output_path = f"channels/{channel_id}.jsonl"
        with open(output_path, 'w') as f:
            json.dump(export, f)

        # Commit with datalad (provenance tracking)
        self.dataset.save(
            path=output_path,
            message=f"Update Slack channel {channel_id}"
        )

        return output_path
```

## Git-Native ETL Patterns

### Pattern 1: DataLad run for Simple Pipelines
**Best for:** Single-step transformations, provenance tracking

```bash
# Raw data → processed data with full provenance
datalad run \
  -m "Normalize Slack messages" \
  --input bronze/slack/raw.json \
  --output silver/slack/normalized.parquet \
  python transform/normalize_slack.py
```

**Benefits:**
- Full command provenance
- Input/output checksums
- Reproducible with `datalad rerun`
- Works with git-annex large files

### Pattern 2: DVC for Multi-Stage Pipelines
**Best for:** Complex DAGs, multiple dependencies

```yaml
# dvc.yaml
stages:
  extract:
    cmd: python extract/slack.py
    deps:
      - extract/slack.py
    outs:
      - bronze/slack/

  transform:
    cmd: python transform/normalize.py
    deps:
      - transform/normalize.py
      - bronze/slack/
    outs:
      - silver/messages/

  load:
    cmd: python load/aggregate.py
    deps:
      - load/aggregate.py
      - silver/messages/
    outs:
      - gold/summaries/
```

**Benefits:**
- Explicit DAG definition
- Automatic change detection
- Parallel execution
- CI/CD friendly

### Pattern 3: Hybrid (DVC + DataLad)
**Best for:** Complex pipelines + rich provenance

```bash
# Use DVC for pipeline orchestration
dvc repro

# Use DataLad for versioning and distribution
datalad save -m "Pipeline execution $(date -I)"
datalad push --to forgejo
```

**Benefits:**
- DVC handles complex dependencies
- DataLad provides distribution and provenance
- Both tracked in git
- Best of both worlds

## Forgejo-aneksajo as Central Hub

### Repository Organization

```
Forgejo Instance: forgejo.example.com
├── con-flux (organization)
│   ├── archives (root dataset)
│   │   - Issues: General archival issues
│   │   - Wiki: Documentation
│   │   - Actions: Automated collections
│   │   - Pull Requests: New data contributions
│   │
│   ├── engineering-data (team dataset)
│   │   - Issues: Team-specific data issues
│   │   - Pull Requests: Data updates
│   │   - Actions: Team collection workflows
│   │
│   ├── research-data (team dataset)
│   └── collectors (code repository)
│       - Source code for all collectors
│       - Issue tracking for collector bugs
│       - Pull Requests for new collectors
│
└── Users can fork, clone, submit PRs
```

### Workflow: Adding New Data Source

1. **Open Issue** in `con-flux/archives`:
   - "Add Telegram archival for research team"
   - Discussion in issue comments

2. **Develop Collector** in `con-flux/collectors`:
   - Fork repository
   - Add telegram_collector.py
   - Submit PR with tests

3. **Create Dataset** in Forgejo:
   - New repo: `research-data-telegram`
   - Initialize as DataLad dataset
   - Set up git-annex remotes

4. **Configure Automation** via Forgejo Actions:
   - `.forgejo/workflows/telegram-daily.yml`
   - Scheduled collection
   - Automatic commits

5. **Link as Subdataset**:
   ```bash
   cd archives/teams/research
   datalad install -d . \
     https://forgejo.example.com/con-flux/research-data-telegram \
     telegram
   datalad save -m "Add Telegram subdataset"
   ```

6. **Close Issue** with link to new dataset

### Benefits of Forgejo-aneksajo Hub

✅ **Discoverability:** Browse all datasets in web UI
✅ **Collaboration:** Issues and PRs for data contributions
✅ **Automation:** CI/CD for scheduled collections
✅ **Access Control:** Fine-grained permissions per dataset
✅ **Documentation:** Wiki per dataset
✅ **History:** Full git history of all changes
✅ **Search:** Find datasets and files
✅ **API:** Programmatic access for AI agents

## Comparison: Git-Native vs Traditional Data Lake

| Aspect | Git-Native (Recommended) | Traditional Data Lake |
|--------|--------------------------|----------------------|
| **Storage** | git-annex repos | MinIO/S3 + Iceberg |
| **Versioning** | Native (git) | Iceberg snapshots |
| **Provenance** | DataLad run, DVC | Manual/external |
| **Distribution** | git clone/push | S3 sync |
| **Collaboration** | PRs, issues | Manual/external |
| **Web UI** | Forgejo-aneksajo | Custom (Superset, etc.) |
| **ETL** | DVC, DataLad run | Airflow, Spark |
| **Access Control** | Git forge permissions | IAM, ACLs |
| **Learning Curve** | Leverages git knowledge | New concepts |
| **Infrastructure** | Lightweight (Forgejo) | Heavy (Spark, Trino, etc.) |

## When to Add Traditional Data Lake Components

You might still want some traditional components:

### Add MinIO if:
- Need S3-compatible storage for git-annex special remotes
- Want cloud-like object storage on-premise
- Need to integrate with S3-native tools

```bash
# Use MinIO as git-annex special remote
git annex initremote minio \
  type=S3 \
  host=minio.local \
  port=9000 \
  bucket=con-flux-large-files
```

### Add Apache Iceberg if:
- Need SQL queries on archived data
- Want analytical workloads (Spark, Trino)
- Have structured data that benefits from table format

```
Hybrid: git-annex (version control) + Iceberg (analytics)
- Primary: git-annex repos
- Analytics layer: Iceberg tables pointing to git-annex data
- Best of both: version control + SQL queries
```

### Add Airflow/Prefect if:
- Forgejo Actions insufficient for complex orchestration
- Need external API coordination
- Want centralized monitoring dashboard
- Have very complex dependencies

## Recommended Stack for con/flux

### Minimal Stack (Start Here)
```
✅ git-annex          - Core storage
✅ DataLad            - Dataset management
✅ Forgejo-aneksajo   - Web UI and management
✅ DVC                - Pipeline orchestration
✅ Forgejo Actions    - Automation (CI/CD)
✅ Existing tools     - con/tinuous, annextube
```

**Total Infrastructure:**
- One Forgejo-aneksajo instance (lightweight)
- Git-annex repos (standard git hosting)
- No databases, no heavy compute engines
- Runs on modest hardware

### Optional Additions (Phase 2+)
```
⚪ MinIO              - If need S3-compatible special remote
⚪ Prefect/Airflow    - If Forgejo Actions insufficient
⚪ PostgreSQL         - For metadata queries (optional)
⚪ Iceberg + Trino    - For analytical SQL queries (optional)
```

## Implementation Guide

### Phase 1: Setup Forgejo-aneksajo (Week 1)

```bash
# Deploy Forgejo-aneksajo
podman run -d \
  -p 3000:3000 \
  -v forgejo-data:/data \
  --name forgejo-aneksajo \
  codeberg.org/forgejo-aneksajo/forgejo-aneksajo:latest

# Access: http://localhost:3000
# Create organization: con-flux
```

### Phase 2: Create Root Dataset (Week 1)

```bash
# Initialize root dataset
datalad create con-flux-archives
cd con-flux-archives

# Create structure
datalad create -d . teams/engineering
datalad create -d . teams/research
datalad create -d . shared

# Push to Forgejo
git remote add forgejo http://localhost:3000/con-flux/archives.git
datalad push --to forgejo
```

### Phase 3: First Collector (Week 2)

```bash
# Create Slack dataset
cd teams/engineering
datalad create -d . slack

# Add collector script
cat > collectors/slack_collector.py << 'EOF'
import slackdump
import datalad.api as dl

def collect():
    export = slackdump.export_all()
    with open('bronze/messages.json', 'w') as f:
        json.dump(export, f)

    dl.save(
        path='bronze/messages.json',
        message='Daily Slack export'
    )

if __name__ == '__main__':
    collect()
EOF

# Test manually
python collectors/slack_collector.py
```

### Phase 4: Automate with Forgejo Actions (Week 2)

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
          fetch-depth: 0  # Full history for DataLad

      - name: Setup DataLad
        run: pip install datalad

      - name: Run collector
        env:
          SLACK_TOKEN: ${{ secrets.SLACK_TOKEN }}
        run: python collectors/slack_collector.py

      - name: Push changes
        run: datalad push --to origin
```

### Phase 5: Add DVC Pipeline (Week 3)

```yaml
# dvc.yaml (in dataset root)
stages:
  collect:
    cmd: python collectors/slack_collector.py
    deps:
      - collectors/slack_collector.py
    outs:
      - bronze/slack/

  normalize:
    cmd: python transform/normalize.py
    deps:
      - transform/normalize.py
      - bronze/slack/
    outs:
      - silver/messages/
```

```bash
# Run pipeline
dvc repro

# Commit results
git add dvc.lock bronze/ silver/
datalad save -m "DVC pipeline execution"
```

### Phase 6: Repeat for More Sources (Weeks 4-8)

1. Create subdataset for each source
2. Add collector following pattern
3. Set up Forgejo Action
4. Add to DVC pipeline if needed
5. Link as subdataset to root

## Real-World Example: DataLad Hub

**Live at:** https://hub.datalad.org/

**What it demonstrates:**
- Forgejo-aneksajo managing thousands of datasets
- Web UI for browsing git-annex content
- Issues and PRs for data contributions
- Search and discovery
- Access control and permissions

**Lessons:**
- Scales to massive numbers of datasets
- Web UI makes data accessible to non-git users
- Standard git workflows apply to data
- Lightweight infrastructure compared to traditional solutions

## Sources

- [Self-hosted and git-annex enabled data store with Forgejo](https://blog.datalad.org/posts/forgejo-aneksajo/)
- [Hosting really large datasets with Forgejo-aneksajo](https://blog.datalad.org/posts/forgejo-aneksajo-large-datasets/)
- [DataLad Hub: Powered by Forgejo-aneksajo](https://hub.datalad.org/)
- [Deploying and managing Forgejo-aneksajo with podman and systemd](https://blog.datalad.org/posts/forgejo-aneksajo-podman-deployment/)
- [Self-Hosted Git Platforms: GitLab vs Gitea vs Forgejo 2026](https://dasroot.net/posts/2026/01/self-hosted-git-platforms-gitlab-gitea-forgejo-2026/)
- [Forgejo – Beyond coding. We forge.](https://forgejo.org/)
- [Get Started: Data Pipelines | DVC](https://doc.dvc.org/start/data-pipelines/data-pipelines)
- [DVC Home](https://dvc.org/)
- [git-annex](https://git-annex.branchable.com/)
- [DataLad workflows](https://git-annex.branchable.com/workflow/)
