---
type: Connection
from: "[[AI Service]]"
to: "[[PostgreSQL]]"
tags:
  - connection
---
# AI Service → PostgreSQL

> [!info] Key facts
> **Via:** PgBouncer :5432 (session mode) | **Protocol:** PostgreSQL wire protocol

**Reads/writes:** `chat_sessions`, [[Chat Messages Table|chat_messages]], `audit_logs`, `tool_policies`, `approvals`, `llm_routing_config`, `llm_request_logs`, all `datto_cache_*` tables, and materialized views (`mv_fleet_status`, `mv_site_summary`, `mv_critical_alerts`, `mv_os_distribution`, `mv_alert_priority`).

**Materialized view queries:** The pre-query engine (`preQuery.ts`) reads directly from materialized views to answer simple questions instantly without an LLM call. The sync pipeline refreshes all five views after every sync using `REFRESH MATERIALIZED VIEW CONCURRENTLY`. See [[local-data]] for details.

Advisory locks (`pg_advisory_lock`) used for sync pipeline exclusion ([[SECURITY_FINDINGS|SEC-011]]).

**See also:** [[Auth to PostgreSQL]] · [[local-data]] · [[Chat Request Flow]]
