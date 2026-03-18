---
tags:
  - platform/database
  - postgres
type: Database
description: pgvector/pg16 instance hosting all 28 platform tables — auth, chat, LLM routing, and 15 Datto cache tables
---

# PostgreSQL

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Database** node

**Image:** `pgvector/pgvector:pg16`
**Port:** `5432` (internal only)
**Volume:** `postgres_data` (named, persists across container restarts)
**Extensions:** `uuid-ossp`, `vector`
**Database:** `datto_rmm`

## Tables

**Auth, Chat & LLM (13):**

| Table | Purpose |
|---|---|
| `users` | [[Users Table]] — credentials, roles, approval authority |
| `roles` | [[Roles Table]] — role definitions |
| `user_roles` | [[Roles Table]] — many-to-many user ↔ role |
| `tool_permissions` | [[Tool Permissions Table]] — role ↔ tool grants |
| `tool_policies` | Per-tool metadata (risk level, approval required) |
| `user_tool_overrides` | Per-user tool grants outside of role |
| `refresh_tokens` | Hashed refresh tokens with expiry |
| `audit_logs` | Login events, tool calls, tool denials |
| `approvals` | Pending/approved/rejected tool approval requests |
| `chat_sessions` | [[Chat Messages Table]] — session metadata, allowed_tools snapshot, data_mode |
| `chat_messages` | [[Chat Messages Table]] — messages with vector embeddings |
| `llm_request_logs` | Per-request LLM log — orchestrator/synthesizer model, tools called |
| `llm_routing_config` | Admin-editable model routing config (60s cache in ai-service) |

**Datto Cache (15):**

| Table | Purpose |
|---|---|
| `datto_sync_log` | Sync run history — status, counts, errors |
| `datto_cache_account` | Account summary |
| `datto_cache_sites` | Sites list + detail + settings |
| `datto_cache_site_variables` | Per-site variables |
| `datto_cache_site_filters` | Per-site device filters |
| `datto_cache_devices` | All devices (largest table) |
| `datto_cache_device_audit` | Hardware audit per device |
| `datto_cache_device_software` | Installed software per device |
| `datto_cache_esxi_audit` | ESXi host audit |
| `datto_cache_printer_audit` | Printer audit + supply levels |
| `datto_cache_alerts` | Open + resolved alerts |
| `datto_cache_users` | Datto portal users (PK = email) |
| `datto_cache_account_variables` | Account-level variables |
| `datto_cache_components` | Job components |
| `datto_cache_filters` | Default + custom device filters |

## Migrations

`db/001_extensions.sql` → `db/014_hnsw_index.sql` (14 migrations)

**Seed:** `db/seed.sql` — 4 default users (`readonly_user`, `helpdesk_user`, `analyst_user`, `admin_user`), 4 roles, tool assignments, tool_policies, llm_request_logs

> [!success] SEC-010 ✅ — PgBouncer connection pooler in place
> `auth-service`, `ai-service`, and `litellm` connect via **PgBouncer** (`edoburu/pgbouncer:1.23.1`) in **session mode**. Session mode is mandatory for `pg_try_advisory_lock` in `sync.ts` (SEC-011). Config: `services/pgbouncer/pgbouncer.ini`.

> [!warning] SEC-005 — Audit immutability not implemented
> App DB user has full DML on `audit_logs`. Write records can be deleted or modified.
> **Fix:** PostgreSQL RLS — INSERT-only role for audit writes.
> See [[SECURITY_FINDINGS]].

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
```

## Used By

[[Auth Service]] · [[AI Service]]

## Related Nodes

[[Users Table]] · [[Roles Table]] · [[Tool Permissions Table]] · [[Chat Messages Table]] · [[Auth Service]] · [[AI Service]]
