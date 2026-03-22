---
tags:
  - platform/database
  - postgres
aliases:
  - postgres
  - db
  - database
type: Database
description: pgvector/pg16 instance hosting all 33 platform tables — auth, chat, LLM routing, voice, CVE scanner, and 15 Datto cache tables
---

# PostgreSQL

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Database** node

> [!info] Service Details
> **Image:** `pgvector/pgvector:pg16`
> **Port:** `5432` (internal only)
> **Volume:** `postgres_data` (named, persists across container restarts)
> **Extensions:** `uuid-ossp`, `vector`, `pg_trgm`
> **Database:** `datto_rmm`

## Tables

**Auth, Chat, LLM & Voice (14 + 1 voice mapping):**

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
| `voice_device_mappings` | SIP extension → DattoLLM user mapping for [[Voice Gateway]] |

**CVE Scanner (4):**

| Table | Purpose |
|---|---|
| `cve_database` | Indexed CVE entries from NVD (CVE ID, description, severity, CVSS scores) |
| `cpe_dictionary` | CPE entries linked to CVEs (vendor, product, version ranges) |
| `device_vulnerabilities` | Match results — device software ↔ CVE matches with confidence scores |
| `cve_sync_log` | CVE scan run history — timestamps, counts, errors |

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

`db/001_extensions.sql` → `db/022_cve_scanner.sql` (21 migrations + `seed.sql`)

| Migration | Purpose |
|---|---|
| 001–007 | Extensions, users, roles, tokens, chat, audit, vector index |
| 008–011 | Datto cache tables, users cache PK fix, FK relaxation, sync log error columns |
| 012–013 | LLM routing config table, LLM logs model columns |
| 014_hnsw_index | SEC-014: HNSW vector index replacing IVFFlat |
| 014_observability | Observability performance indexes |
| 015_action_proposals | SEC-Write-001: ActionProposal state machine table |
| 016_audit_log_rls | SEC-Audit-001: Audit log immutability via PostgreSQL RLS |
| 017_request_traces | Distributed tracing tables |
| 018_fuzzy_search | pg_trgm extension + GIN trigram indexes for fuzzy site/device search |
| 019_voice_device_mappings | SIP extension → DattoLLM user mapping for [[Voice Gateway]] |
| 020_voice_routing_config | `synthesizer_voice` routing slot in `llm_routing_config` |
| 022_cve_scanner | CVE scanner tables: `cve_database`, `cpe_dictionary`, `device_vulnerabilities`, `cve_sync_log` + views |

**Seed:** `db/seed.sql` — 4 default users (`readonly_user`, `helpdesk_user`, `analyst_user`, `admin_user`), 4 roles, tool assignments, tool_policies, llm_request_logs

> [!success] SEC-010 ✅ — PgBouncer connection pooler in place
> `auth-service`, `ai-service`, and `litellm` connect via **PgBouncer** (`edoburu/pgbouncer:latest`) in **session mode**. Session mode is mandatory for `pg_try_advisory_lock` in `sync.ts` (SEC-011). Config: `services/pgbouncer/pgbouncer.ini`.
>
> **Deploy note:** `pgbouncer.ini` contains a hardcoded `password=` that must match `POSTGRES_PASSWORD` in `.env`. Update it before first `docker compose up`.

> [!success] SEC-005 ✅ — Audit log RLS implemented (migration 016)
> `016_audit_log_rls.sql` applies PostgreSQL RLS to `audit_logs` — INSERT-only policy for the app role.

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- migration 018: fuzzy search for sites/devices
```

## Used By

[[Auth Service]] · [[AI Service]]

## Related Nodes

[[Users Table]] · [[Roles Table]] · [[Tool Permissions Table]] · [[Chat Messages Table]] · [[Auth Service]] · [[AI Service]] · [[Voice Gateway]] · [[CVE Scanner]] · [[Embedding Service]] · [[Network Isolation]] · [[RBAC System]] · [[Observability Dashboard]] · [[Data Explorer]]
