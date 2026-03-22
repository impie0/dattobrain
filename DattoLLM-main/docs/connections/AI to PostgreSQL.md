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

**Reads/writes:** `chat_sessions`, [[Chat Messages Table|chat_messages]], `audit_logs`, `tool_policies`, `approvals`, `llm_routing_config`, `llm_request_logs`, all `datto_cache_*` tables.

Advisory locks (`pg_advisory_lock`) used for sync pipeline exclusion ([[SECURITY_FINDINGS|SEC-011]]).

**See also:** [[Auth to PostgreSQL]] · [[local-data]] · [[Chat Request Flow]]
