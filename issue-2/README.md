# Research for Issue #2: Comprehensive Data Aggregation System

## Issue Overview

**Issue Title:** "hoarder to bring them all in!"

**Proposed Names:** con/flux, con/serve

**Goal:** Create a comprehensive data aggregation and archival system that:
- Consolidates diverse data sources (CI logs, chat platforms, videos, etc.)
- Provides automated discovery and backup
- Uses DataLad datasets for hierarchical organization
- Features configuration-driven design with web UI
- Makes data accessible to AI agents

**Design Inspiration:** con/citation-collector architecture

## ⚠️ IMPORTANT: Read Corrections First

**[CORRECTIONS.md](./CORRECTIONS.md)** - Critical updates based on user feedback:
- ❌ DVC is NOT in the core stack (optional only)
- ✅ Use DataLad run + duct instead (already using)
- ✅ git-bug for GitHub issues archival

## 🎯 START HERE: Key Findings

### Major Discovery: Forgejo-aneksajo

**[Forgejo-aneksajo](https://blog.datalad.org/posts/forgejo-aneksajo/)** is a game-changer for git-annex/DataLad users:

- **What:** Forgejo fork with native git-annex support
- **Where:** Powers DataLad Hub (hub.datalad.org)
- **Scale:** Handles 4500+ datasets, 15 million files
- **Features:** GitHub-like UI for git-annex repos (issues, PRs, CI/CD, wiki)
- **Status:** Production-ready, actively maintained

**This changes the recommendation from a traditional data lake to a git-native approach.**

## Recommended Reading Path

### 1. **[REVISED-RECOMMENDATIONS.md](./REVISED-RECOMMENDATIONS.md)** ⭐ START HERE
**TL;DR of the revised git-native approach**
- Why Forgejo-aneksajo changes everything
- Git-native stack vs traditional data lake comparison
- Quick decision matrix
- 4-week MVP implementation guide

### 2. **[git-native-approach.md](./git-native-approach.md)** 📘 DETAILED GUIDE
**Comprehensive technical guide for git/git-annex/DataLad users**
- Forgejo-aneksajo deep dive
- DVC + DataLad run for ETL
- Integration with con/tinuous and annextube
- Hierarchical DataLad dataset organization
- Forgejo Actions for automation
- Complete implementation guide

### 3. Specific Tool Research (as needed)

#### Essential for Git-Native Approach:
- **[chat-archival-tools.md](./chat-archival-tools.md)** - slackdump, Telethon for Slack/Telegram
- **[video-archival-tools.md](./video-archival-tools.md)** - yt-dlp for YouTube (used in annextube)
- **[data-management-tools.md](./data-management-tools.md)** - DataLad ecosystem and related tools

#### Optional (Traditional Data Lake Components):
- **[backup-archival-systems.md](./backup-archival-systems.md)** - Traditional backup systems (reference only)
- **[workflow-orchestration.md](./workflow-orchestration.md)** - Airflow/Prefect (if Forgejo Actions insufficient)
- **[etl-data-pipelines.md](./etl-data-pipelines.md)** - ETL patterns (mostly for non-git approaches)
- **[data-lake-architecture.md](./data-lake-architecture.md)** - MinIO/Iceberg/Spark (optional, if SQL analytics needed)
- **[recommendations-summary.md](./recommendations-summary.md)** - Original recommendations (now superseded)

## Two Approaches Compared

### ✅ Git-Native Approach (RECOMMENDED)

**Stack:** Forgejo-aneksajo + DataLad + DVC + Forgejo Actions

**Best for:**
- Teams with git/git-annex/DataLad expertise ✅ (you!)
- Need rich provenance tracking ✅
- Want version control everywhere ✅
- Prefer lightweight infrastructure ✅
- Value collaboration features (issues, PRs) ✅

**Infrastructure:** 1 server running Forgejo-aneksajo

**Deployment:** Hours to days

**Maintenance:** Low (one service to manage)

### ⚠️ Traditional Data Lake (OPTIONAL)

**Stack:** MinIO + Apache Iceberg + Spark + Airflow + Trino

**Best for:**
- Need SQL queries on archived data ❌ (not yet)
- Running analytical workloads (BI tools) ❌ (not yet)
- Streaming real-time processing ❌ (not needed)
- Team familiar with Spark/Hadoop ecosystem ❌ (not your case)

**Infrastructure:** Cluster (multiple services, databases)

**Deployment:** Weeks to months

**Maintenance:** High (many components)

## Quick Decision Matrix

Your situation:
- ✅ Heavy git/git-annex/DataLad users
- ✅ Existing tools: con/tinuous, annextube (git-native)
- ✅ Need provenance and version control
- ✅ Prefer self-hosted, lightweight
- ✅ Want collaboration features
- ❌ Don't need SQL analytics (yet)
- ❌ Don't need real-time streaming

**Conclusion: Git-Native Approach is the clear winner** 🎯

## Recommended Stack

### Core (Deploy Immediately)
```
✅ Forgejo-aneksajo    - Web UI + git hosting + CI/CD
✅ git-annex           - Storage (already have)
✅ DataLad             - Dataset management (already have)
✅ DVC                 - Git-native ETL pipelines
✅ slackdump           - Slack archival
✅ Telethon            - Telegram archival
✅ yt-dlp              - YouTube archival (already using)
✅ con/tinuous         - CI logs (already have)
✅ annextube           - YouTube + captions (already have)
```

### Optional (Add Later If Needed)
```
⚪ MinIO               - S3-compatible special remote
⚪ Apache Iceberg      - If SQL analytics needed
⚪ Trino               - If analytical queries needed
⚪ Airflow/Prefect     - If Forgejo Actions insufficient
```

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│  Data Sources                                 │
│  Slack, GitHub, Zoom, Telegram, YouTube      │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Collectors (git-native)                      │
│  - slackdump, con/tinuous, annextube         │
│  - New: telegram, matrix collectors          │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Storage: git-annex Repositories              │
│  - Hierarchical DataLad datasets             │
│  - One repo per team/source                  │
│  - Everything version controlled             │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Management: Forgejo-aneksajo                 │
│  - GitHub-like web UI for git-annex          │
│  - Issues, PRs, CI/CD, wiki                  │
│  - Browse datasets without downloading       │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Access                                       │
│  - Git clone (developers)                    │
│  - Web UI (non-technical users)              │
│  - API (AI agents)                           │
└──────────────────────────────────────────────┘
```

## Key Features of Git-Native Approach

### Version Control Everywhere
- Not just metadata - ALL data in git-annex
- Full history of every change
- Branch, merge, revert like code

### Rich Provenance
- DataLad run tracks: command, inputs, outputs, checksums
- DVC pipelines track: dependencies, transformations
- Full reproducibility

### Collaboration Built-In
- Issues per dataset (track problems, requests)
- Pull requests for contributions
- Code review for collector changes
- Wiki for documentation

### Lightweight & Scalable
- Runs on modest hardware
- Proven to 15M files (DataLad Hub)
- Distributed architecture
- No cluster management

### Leverages Your Skills
- You already know git/git-annex/DataLad
- Existing tools work out of the box
- Familiar workflows
- Low learning curve

## Implementation Timeline

### Week 1: Deploy Forgejo-aneksajo
- Install Forgejo-aneksajo
- Create organization and root repository
- Set up initial subdatasets

### Week 2-3: Migrate Existing Tools
- Push con/tinuous output to Forgejo
- Push annextube archives to Forgejo
- Create web UI visibility

### Week 4: First New Collector
- Implement Slack collector with slackdump
- Automate with Forgejo Actions
- Test end-to-end workflow

### Month 2+: Expand
- Add more sources (Telegram, Matrix, etc.)
- Implement DVC pipelines for transformations
- Build AI agent API

## Next Steps

1. **Read REVISED-RECOMMENDATIONS.md** - Understand the git-native rationale
2. **Read git-native-approach.md** - Get technical details
3. **Deploy Forgejo-aneksajo** - Start MVP (1-2 hours)
4. **Migrate one existing tool** - Prove the concept
5. **Build first new collector** - Establish pattern
6. **Scale up** - Add sources, automate, refine

## When to Revisit Traditional Data Lake

Re-evaluate if/when:
- ❓ Need SQL queries on archived data (BI tools)
- ❓ Running complex analytical workloads
- ❓ Team wants to learn Spark/Hadoop ecosystem
- ❓ Real-time streaming becomes requirement

Until then: **git-native approach delivers more value with less complexity**

## Research Date

February 5, 2026

**Major Revision:** February 5, 2026 (after discovering Forgejo-aneksajo relevance)
