---
type: Connection
from: "[[AI Service]]"
to: "[[PostgreSQL]]"
---
# AI Service → PostgreSQL

**Via:** PgBouncer :5432 (session mode)
**Protocol:** PostgreSQL wire protocol

**Reads/writes:** `chat_sessions`, `chat_messages`, `audit_logs`, `tool_policies`, `approvals`, `llm_routing_config`, `llm_request_logs`, all `datto_cache_*` tables.

Advisory locks (`pg_advisory_lock`) used for sync pipeline exclusion (SEC-011).
