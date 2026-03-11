# Quick Recommendations Summary

## Executive Summary

For building **con/flux** (or **con/serve**) - a comprehensive data aggregation and archival system - here are the top recommended technologies based on research conducted on February 5, 2026.

## Recommended Technology Stack

### Core Architecture: Medallion + DataLad

```
┌──────────────────────────────────────────────┐
│  Data Sources: Slack, GitHub, Zoom, etc.     │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Orchestration: Prefect                       │
│  - Schedule collections                       │
│  - Event-driven updates                       │
│  - Python-first workflows                     │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Bronze Layer (Raw Data)                      │
│  Storage: MinIO + Apache Iceberg              │
│  Version Control: DataLad + git-annex         │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Silver Layer (Normalized)                    │
│  Processing: Python scripts / Spark           │
│  Schema: Unified message/event formats        │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Gold Layer (AI-Ready)                        │
│  Format: JSONL, Parquet                       │
│  Organization: By team, project, timeframe    │
└───────────────────┬──────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│  Access: Web UI, API, DataLad clone           │
└──────────────────────────────────────────────┘
```

## Specific Tool Recommendations

### 1. Workflow Orchestration → Prefect
**Why:**
- ✅ Python-first, matches DataLad ecosystem
- ✅ Event-driven for dynamic source discovery
- ✅ Fast iteration for new collectors
- ✅ Clean, Pythonic API

**Alternative:** Dagster (if data lineage is critical)

### 2. Data Management → DataLad
**Why:**
- ✅ Built for distributed, heterogeneous data
- ✅ Git-based version control
- ✅ Handles any file size via git-annex
- ✅ Research data focused
- ✅ Already used in CON projects

**No Alternative:** This is the right choice

### 3. Object Storage → MinIO
**Why:**
- ✅ S3-compatible, works with DataLad
- ✅ Self-hosted or cloud
- ✅ No vendor lock-in
- ✅ Kubernetes-native

**Alternative:** Direct S3 (if purely cloud-based)

### 4. Table Format → Apache Iceberg
**Why:**
- ✅ ACID transactions
- ✅ Time travel queries
- ✅ Schema evolution
- ✅ Hidden partitioning

**Alternative:** Not needed initially, add later if SQL queries become important

### 5. Chat Archival → slackdump + Telethon
**Why:**
- ✅ **slackdump:** No Slack admin needed
- ✅ **Telethon:** Python library for Telegram
- ✅ Both open source and active

### 6. Video Archival → yt-dlp + zoom-recording-downloader
**Why:**
- ✅ **yt-dlp:** Most reliable YouTube downloader (2026)
- ✅ **zoom-recording-downloader:** Official Zoom API
- ✅ Integrate with existing git-annex setup

## Implementation Phases

### Phase 1: MVP (Weeks 1-4)
**Goal:** Prove the concept with one data source

1. **Setup Core:**
   - Initialize DataLad superdataset
   - Deploy MinIO locally (single node)
   - Install Prefect

2. **First Collector:**
   - Implement Slack collector using slackdump
   - Store in Bronze layer (raw JSON)
   - Commit to DataLad on each run

3. **Basic Scheduling:**
   - Daily collection via Prefect
   - Simple error handling
   - Email notifications

**Deliverable:** Automated daily Slack archival in DataLad

### Phase 2: Multi-Source (Weeks 5-8)
**Goal:** Add more data sources

1. **Add Collectors:**
   - GitHub (CI logs via con/tinuous)
   - Telegram (via Telethon)
   - YouTube (via yt-dlp for select channels)

2. **Configuration System:**
   - YAML configs for each source
   - Plugin architecture (factory pattern)
   - Centralized metadata database

3. **Improved Organization:**
   - Hierarchical DataLad datasets
   - Per-team subdatasets
   - Per-source subdatasets

**Deliverable:** Multi-source archival with config-driven collectors

### Phase 3: Normalization (Weeks 9-12)
**Goal:** Silver layer with unified schema

1. **Schema Design:**
   - Unified message schema (Slack, Telegram, Matrix)
   - Standardized event schema (CI, commits, releases)
   - Media metadata schema

2. **Transform Pipeline:**
   - Prefect flows for Bronze → Silver
   - Data validation
   - Deduplication

3. **Quality Checks:**
   - Completeness validation
   - Freshness monitoring
   - Error alerting

**Deliverable:** Normalized, validated data ready for analysis

### Phase 4: AI-Ready & UI (Weeks 13-16)
**Goal:** Gold layer and access interface

1. **Gold Layer:**
   - Aggregations (daily summaries, user stats)
   - Cross-source joins
   - AI-friendly formats (JSONL, context windows)

2. **Web UI:**
   - Browse datasets
   - Search content
   - View lineage
   - Configure new sources

3. **AI Agent API:**
   - REST API for querying
   - GraphQL for flexible queries
   - Streaming for large results

**Deliverable:** Complete system with UI and API

## Architecture Decisions

### Decision 1: Prefect vs Airflow vs Dagster
**Choice:** Prefect

**Reasoning:**
- Matches Python-first approach
- Better for dynamic, event-driven workflows
- Easier initial setup
- Fast iteration

**When to reconsider:**
- If team already expert in Airflow
- If need maximum ecosystem support
- If data lineage is paramount (choose Dagster)

### Decision 2: Medallion Architecture
**Choice:** Bronze/Silver/Gold layers

**Reasoning:**
- Clear separation of concerns
- Bronze = immutable raw data
- Silver = validated, normalized
- Gold = analysis-ready

**Implementation:**
```
archives/
├── bronze/          # Raw from collectors
│   ├── slack/
│   ├── github/
│   └── zoom/
├── silver/          # Normalized schemas
│   ├── messages/
│   ├── events/
│   └── media/
└── gold/            # AI-ready aggregations
    ├── by-team/
    ├── by-project/
    └── conversations/
```

### Decision 3: DataLad + MinIO (not Iceberg initially)
**Choice:** Start with DataLad + git-annex, add Iceberg later if needed

**Reasoning:**
- DataLad already familiar to team
- Git-annex handles large files well
- MinIO as git-annex special remote
- Add Iceberg later if SQL queries become important

**When to add Iceberg:**
- Need SQL queries on archived data
- Want ACID transactions
- Need time travel queries
- Have large analytical workloads

## Configuration-Driven Design

### Source Configuration Example
```yaml
# config/sources/slack.yaml
name: Engineering Team Slack
type: slack
enabled: true

authentication:
  token_env: SLACK_ENGINEERING_TOKEN

discovery:
  auto_detect_channels: true
  include_private: false
  exclude_patterns:
    - "tmp-*"
    - "test-*"

collection:
  schedule: "0 2 * * *"  # 2 AM daily
  incremental: true
  lookback_days: 7

storage:
  dataset: teams/engineering/slack
  format: json
  compress: true

notifications:
  on_success: false
  on_failure: true
  recipients:
    - ops@example.com
```

### Plugin Interface
```python
# collectors/base.py
from abc import ABC, abstractmethod

class DataCollector(ABC):
    """Base class for all collectors"""

    def __init__(self, config: dict):
        self.config = config

    @abstractmethod
    def discover(self) -> List[str]:
        """Discover available sources"""
        pass

    @abstractmethod
    def collect(self, source_id: str) -> dict:
        """Collect data from source"""
        pass

    @abstractmethod
    def validate(self, data: dict) -> bool:
        """Validate collected data"""
        pass
```

## Key Design Principles

### 1. Configuration Over Code
- New sources added via YAML, not Python
- Non-developers can add sources
- Version control configurations
- Environment-specific configs (dev/staging/prod)

### 2. Immutable Bronze Layer
- Never modify raw data
- All transformations happen Bronze → Silver
- Can always reprocess from source
- Audit trail preserved

### 3. Plugin Architecture
- Clear interfaces (abstract base classes)
- Factory pattern for instantiation
- Isolated collector logic
- Easy to add new sources

### 4. Metadata First
- Track provenance (when, how, by whom)
- Data quality metrics
- Lineage tracking
- Schema evolution history

### 5. Incremental Collection
- Don't redownload everything daily
- Track last collection timestamp
- Detect changes and additions
- Handle deletions gracefully

## Comparison to Similar Systems

### con/citation-collector
**Similarities:**
- Configuration-driven design
- Plugin architecture for sources
- Metadata-focused

**Differences:**
- con/flux handles diverse data types (not just citations)
- Larger scale (videos, chat logs)
- More complex scheduling needs

**Lesson:** Adopt similar config structure and plugin pattern

### Traditional Backup Systems (Bareos, UrBackup)
**What to Adopt:**
- Scheduling infrastructure
- Retention policies
- Deduplication strategies

**What to Avoid:**
- File-based thinking (we need API-based collection)
- Limited metadata support

### ETL Platforms (Airbyte, Meltano)
**What to Adopt:**
- Connector architecture
- Configuration schemas
- Web UI for source management

**What to Avoid:**
- Database-centric approach (we have diverse data types)
- Cloud-first design (need self-hosted option)

## Quick Start Commands

### Initialize Project
```bash
# Create DataLad superdataset
datalad create con-flux

# Initialize subdatasets
cd con-flux
datalad create -d . bronze/slack
datalad create -d . bronze/github
datalad create -d . bronze/zoom

# Start MinIO
docker run -d -p 9000:9000 \
  -e MINIO_ROOT_USER=admin \
  -e MINIO_ROOT_PASSWORD=secretpass \
  -v $(pwd)/data/minio:/data \
  minio/minio server /data

# Add MinIO as git-annex remote
git annex initremote minio \
  type=S3 \
  host=localhost \
  port=9000 \
  bucket=con-flux-archives \
  encryption=none

# Install Prefect
pip install prefect

# Start Prefect server
prefect server start
```

### First Collection Flow
```python
# workflows/slack_daily.py
from prefect import flow, task
import slackdump
import datalad.api as dl

@task
def collect_slack():
    """Collect Slack messages"""
    # Use slackdump to export
    return slackdump.export_all()

@task
def save_to_datalad(data):
    """Save in DataLad dataset"""
    with open('bronze/slack/export.json', 'w') as f:
        json.dump(data, f)

    dl.save(
        dataset='.',
        path='bronze/slack/export.json',
        message=f'Slack export {datetime.now()}'
    )

@flow(name="slack-daily")
def slack_archival():
    data = collect_slack()
    save_to_datalad(data)

if __name__ == "__main__":
    slack_archival()
```

## Success Metrics

### MVP Success (Phase 1)
- ✅ Daily Slack archival running automatically
- ✅ Zero data loss for 30 days
- ✅ < 5 minutes manual intervention per week

### Multi-Source Success (Phase 2)
- ✅ 3+ data sources active
- ✅ Config-based source addition
- ✅ Hierarchical DataLad organization

### Production Success (Phase 3-4)
- ✅ All team data sources covered
- ✅ Web UI for browsing and search
- ✅ AI agent successfully queries data
- ✅ < 1 hour maintenance per week

## Risk Mitigation

### Risk 1: API Changes Break Collectors
**Mitigation:**
- Use maintained libraries (yt-dlp, slackdump)
- Monitor for breakage (daily test collections)
- Have fallback collectors
- Store raw API responses

### Risk 2: Storage Grows Too Large
**Mitigation:**
- git-annex for large files
- MinIO with compression
- Retention policies (archive old data)
- Monitor growth trends

### Risk 3: Collection Takes Too Long
**Mitigation:**
- Incremental updates (not full exports)
- Parallel collection (Prefect concurrency)
- Optimize slow collectors
- Scale horizontally if needed

### Risk 4: Configuration Complexity
**Mitigation:**
- JSON schema validation
- Config templates
- Web UI for configuration
- Good documentation

## Resources

All detailed research is available in:
- [backup-archival-systems.md](./backup-archival-systems.md)
- [chat-archival-tools.md](./chat-archival-tools.md)
- [data-management-tools.md](./data-management-tools.md)
- [workflow-orchestration.md](./workflow-orchestration.md)
- [etl-data-pipelines.md](./etl-data-pipelines.md)
- [video-archival-tools.md](./video-archival-tools.md)
- [data-lake-architecture.md](./data-lake-architecture.md)

## Next Steps

1. **Review this research** with the team
2. **Validate technology choices** against requirements
3. **Prototype Phase 1** (Slack collector + DataLad)
4. **Iterate based on learnings**
5. **Expand to more sources** (Phase 2+)

---

**Research Date:** February 5, 2026
**Issue:** https://github.com/con/ceptualization/issues/2
