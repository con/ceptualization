# ETL & Data Pipeline Systems

## Overview

Configuration-driven ETL (Extract, Transform, Load) systems and data pipeline architectures with pluggable components. These patterns are essential for building flexible, maintainable data collection systems like con/flux.

## Configuration-Driven ETL Frameworks

### Metadata-Driven ETL Pattern

#### Core Concept
Instead of hardcoding each data source integration, use **configuration files** to define:
- Source connections
- Extraction rules
- Transformation logic
- Storage destinations

#### Benefits for con/flux
✅ Add new data sources without code changes
✅ Non-developers can add sources via configuration
✅ Consistent handling across all sources
✅ Easy to version control configurations
✅ Centralized metadata management

#### Implementation Pattern (Databricks/Azure)
- **3-Level Configuration:**
  1. **Environment:** Database connections, API keys, storage paths
  2. **DAG:** Workflow structure, dependencies, schedules
  3. **Tasks:** Individual data source specifications

- **Lakehouse Architecture Integration:**
  - Bronze layer: Raw data ingestion
  - Silver layer: Cleaned, validated data
  - Gold layer: Aggregated, enriched data

#### Example Configuration
```yaml
# config/sources/slack.yaml
source:
  type: slack
  connection: ${SLACK_TOKEN}
  discovery:
    auto_detect_channels: true
    include_private: false
  collection:
    frequency: daily
    incremental: true
  storage:
    dataset: teams/engineering/slack
    format: json
```

### Google Data Fusion & Composer Pattern

**Framework:** Configuration-driven data lake using Cloud Data Fusion and Cloud Composer

**Key Features:**
- Visual pipeline designer (GUI)
- Configuration stored as JSON/YAML
- Reusable pipeline templates
- Metadata-driven transformations

**Approach:**
- Define pipelines visually
- Export as configuration
- Version control the configs
- Deploy across environments

### Microsoft Azure Configuration-Driven Pattern

**Reference:** Azure Architecture - Configuration-driven data pipeline

**Architecture:**
- Central metadata store (SQL Database)
- Configuration tables define:
  - Source systems
  - Extraction patterns
  - Transformation rules
  - Destination mappings
- Azure Data Factory reads configs
- Pipelines generated dynamically

**Benefits:**
- Single pipeline handles all sources
- Adding source = adding database row
- No code deployment needed

## Pluggable Architecture Patterns

### Kafka Connect Architecture

#### Overview
- **Type:** Distributed streaming platform
- **Pattern:** Pluggable connectors for sources and sinks
- **Ecosystem:** 100+ community connectors

#### Key Design Principles

**1. Connector Plugin System**
```
Connectors:
├── Source Connectors (ingest data)
│   ├── SlackConnector
│   ├── GitHubConnector
│   └── DatabaseConnector
└── Sink Connectors (output data)
    ├── S3Connector
    ├── DataLadConnector
    └── ElasticsearchConnector
```

**2. Pluggable Converters**
- JSON converter
- Avro converter
- Protobuf converter
- Custom converters

**3. Schema Registry Integration**
- Tracks data schemas
- Schema evolution support
- Compatibility checking

#### Lessons for con/flux
✅ Clear plugin interface (abstract base class)
✅ Separate source logic from framework
✅ Schema validation at boundaries
✅ Metadata propagation through pipeline

### Modern ETL Framework Patterns (2026)

#### Design Principles

**1. Cloud-Native & Microservices**
- Distributed components
- Independent scaling
- Fault isolation
- Container-based deployment

**2. Flexibility & Extensibility**
- Plugin architecture for connectors
- Pluggable functions/transforms
- Configurable destinations
- No vendor lock-in

**3. Scalability**
- Horizontal scaling
- Parallel execution
- Stream and batch processing
- Auto-scaling based on load

**4. Observability**
- Pipeline monitoring
- Data quality metrics
- Lineage tracking
- Error handling & retries

## Implementation Patterns for con/flux

### Pattern 1: Abstract Collector Interface

```python
# collectors/base.py
from abc import ABC, abstractmethod
from typing import Dict, Any, Iterator

class DataCollector(ABC):
    """Base class for all data collectors"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.source_type = self.config['type']

    @abstractmethod
    def discover(self) -> Iterator[str]:
        """Discover available data sources (channels, repos, etc.)"""
        pass

    @abstractmethod
    def collect(self, source_id: str) -> Dict[str, Any]:
        """Collect data from a specific source"""
        pass

    @abstractmethod
    def validate(self, data: Dict[str, Any]) -> bool:
        """Validate collected data"""
        pass

    def get_metadata(self) -> Dict[str, Any]:
        """Return metadata about this collector"""
        return {
            'type': self.source_type,
            'version': self.version,
            'config': self.config
        }
```

### Pattern 2: Configuration-Based Collector Factory

```python
# collectors/factory.py
from typing import Dict, Any
from .slack_collector import SlackCollector
from .github_collector import GitHubCollector

class CollectorFactory:
    """Create collectors from configuration"""

    COLLECTORS = {
        'slack': SlackCollector,
        'github': GitHubCollector,
        # ... more collectors
    }

    @classmethod
    def create(cls, config: Dict[str, Any]) -> DataCollector:
        """Create a collector from configuration"""
        source_type = config['type']
        collector_class = cls.COLLECTORS.get(source_type)

        if not collector_class:
            raise ValueError(f"Unknown collector type: {source_type}")

        return collector_class(config)
```

### Pattern 3: Pipeline Configuration

```yaml
# config/pipelines/daily-collection.yaml
pipeline:
  name: daily-archival
  schedule: "0 2 * * *"  # 2 AM daily

  sources:
    - type: slack
      enabled: true
      config_file: sources/slack.yaml

    - type: github
      enabled: true
      config_file: sources/github.yaml

    - type: zoom
      enabled: true
      config_file: sources/zoom.yaml

  storage:
    backend: datalad
    base_path: /data/archives

  notifications:
    on_success: team@example.com
    on_failure: ops@example.com
```

### Pattern 4: Metadata Store Schema

```sql
-- Central metadata database
CREATE TABLE sources (
    id SERIAL PRIMARY KEY,
    source_type VARCHAR(50) NOT NULL,
    source_id VARCHAR(255) NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(source_type, source_id)
);

CREATE TABLE collection_runs (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES sources(id),
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    status VARCHAR(20),
    records_collected INTEGER,
    error_message TEXT,
    metadata JSONB
);

CREATE TABLE collected_items (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES collection_runs(id),
    item_type VARCHAR(50),
    item_id VARCHAR(255),
    collected_at TIMESTAMP,
    data_location TEXT,  -- DataLad path
    checksum VARCHAR(64)
);
```

## Distributed ETL Architecture

### Lightweight Ingestion Service Pattern

**Reference:** Stanford research on distributed ETL

**Key Features:**
- Lightweight design
- Pluggable components
- Scalable ingestion
- Real-time capable

**Architecture Layers:**
1. **Ingestion Layer:** Collect from sources
2. **Buffer Layer:** Queue/stream (Kafka, RabbitMQ)
3. **Processing Layer:** Transform/validate
4. **Storage Layer:** Persist (DataLad, S3)

### Considerations for con/flux

**Scalability:**
- Start simple (single process)
- Add buffering when needed (message queue)
- Scale horizontally as load increases

**Reliability:**
- Retry failed collections
- Store raw data first (Bronze layer)
- Transform afterwards (Silver/Gold layers)
- Idempotent operations

**Monitoring:**
- Track collection success rate
- Monitor data freshness
- Alert on failures
- Log lineage metadata

## Best Practices for Configuration-Driven Systems

### 1. Configuration Validation
```python
import jsonschema

def validate_config(config: dict, schema: dict):
    """Validate configuration against JSON schema"""
    try:
        jsonschema.validate(config, schema)
    except jsonschema.ValidationError as e:
        raise ValueError(f"Invalid configuration: {e.message}")
```

### 2. Version Configuration
- Keep configs in git
- Tag releases
- Document breaking changes
- Provide migration scripts

### 3. Environment Separation
```
config/
├── schemas/           # JSON schemas for validation
├── environments/
│   ├── dev/
│   ├── staging/
│   └── production/
└── sources/           # Source definitions
    ├── slack.yaml
    ├── github.yaml
    └── zoom.yaml
```

### 4. Secret Management
- Never commit secrets
- Use environment variables
- Support secret managers (Vault, AWS Secrets Manager)
- Template files with placeholders

```yaml
# config/sources/slack.yaml
source:
  type: slack
  connection: ${SLACK_TOKEN}  # Injected at runtime
```

### 5. Testing Configurations
```python
def test_slack_config():
    """Test Slack collector configuration"""
    config = load_config('config/sources/slack.yaml')
    validate_config(config, SLACK_SCHEMA)

    collector = CollectorFactory.create(config)
    assert collector.test_connection() == True
```

## ETL Architecture Patterns

### Lambda Architecture
- **Batch Layer:** Complete reprocessing periodically
- **Speed Layer:** Real-time incremental updates
- **Serving Layer:** Merged view
- **Use Case:** When you need both batch and real-time

### Kappa Architecture
- **Single Stream:** Everything as event stream
- **Reprocessing:** Replay stream from beginning
- **Use Case:** Pure streaming approach

### Medallion Architecture (Lakehouse)
- **Bronze:** Raw data, no transformation
- **Silver:** Cleaned, validated, deduplicated
- **Gold:** Aggregated, business logic applied
- **Use Case:** Data lake/lakehouse systems

### Recommendation for con/flux: Medallion + Incremental

```
archives/
├── bronze/           # Raw collector output
│   ├── slack/
│   ├── github/
│   └── zoom/
├── silver/           # Cleaned, normalized
│   └── unified/     # Common schema across sources
└── gold/             # Ready for AI consumption
    ├── by-team/
    ├── by-project/
    └── by-timerange/
```

## Tools & Frameworks

### Apache NiFi
- Visual data flow tool
- Configuration-driven
- Excellent for complex routing
- May be overkill for simple needs

### Apache Camel
- Enterprise integration patterns
- 300+ connectors
- Java-based
- Good for complex integrations

### Airbyte
- Open source data integration
- 300+ pre-built connectors
- Configuration-driven
- Focus on ELT (Extract, Load, Transform)

### Meltano
- Open source DataOps platform
- Singer taps (extractors) and targets (loaders)
- CLI and SDK
- Great for analytics engineering

## Sources

- [Configuration-driven data pipeline - Azure](https://learn.microsoft.com/en-us/azure/architecture/solution-ideas/articles/configuration-driven-data-pipeline)
- [Metadata-Driven ETL Framework in Databricks](https://community.databricks.com/t5/technical-blog/metadata-driven-etl-framework-in-databricks-part-1/ba-p/92666)
- [Kafka Connect Architecture](https://docs.confluent.io/platform/current/connect/design.html)
- [Framework for building a configuration driven data lake using Data Fusion and Composer](https://cloud.google.com/blog/topics/developers-practitioners/framework-building-configuration-driven-data-lake-using-data-fusion-and-composer)
- [ETL Frameworks in 2026 for Future-Proof Data Pipelines](https://www.integrate.io/blog/etl-frameworks-in-2025-designing-robust-future-proof-data-pipelines/)
- [ETL Architecture and Design: Essential Steps and Patterns for Modern Data Pipelines](https://www.matillion.com/blog/etl-architecture-design-patterns-modern-data-pipelines)
- [Data Pipeline Architecture: Diagrams, Best Practices, and Examples](https://airbyte.com/data-engineering-resources/data-pipeline-architecture)
- [Distributed ETL (Stanford)](https://www.scs.stanford.edu/17au-cs244b/labs/projects/wang.pdf)
