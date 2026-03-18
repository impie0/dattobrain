# PostgreSQL

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Database** node

**Image:** `pgvector/pgvector:pg16`
**Port:** `5432` (internal only)
**Volume:** `postgres_data` (named, persists across container restarts)
**Extensions:** `uuid-ossp`, `vector`
**Database:** `datto_rmm`

## Tables

| Table | Purpose |
|---|---|
| `users` | [[Users Table]] — credentials, roles, approval authority |
| `roles` | [[Roles Table]] — role definitions |
| `user_roles` | [[Roles Table]] — many-to-many user ↔ role |
| `tool_permissions` | [[Tool Permissions Table]] — role ↔ tool grants |
| `tool_policies` | Per-tool metadata (risk level, approval required) |
| `chat_sessions` | [[Chat Messages Table]] — session metadata, allowed_tools snapshot |
| `chat_messages` | [[Chat Messages Table]] — messages with vector embeddings |
| `refresh_tokens` | Hashed refresh tokens with expiry |
| `audit_logs` | Login events, tool calls, tool denials |
| `approvals` | Pending/approved/rejected tool approval requests |
| `user_tool_overrides` | Per-user tool grants outside of role |

## Migrations

`db/001_extensions.sql` → `db/007_vector_index.sql`

**Seed:** `db/seed.sql` — 4 default users, 4 roles, tool assignments

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
```

## Used By

[[Auth Service]] · [[AI Service]]

## Related Nodes

[[Users Table]] · [[Roles Table]] · [[Tool Permissions Table]] · [[Chat Messages Table]] · [[Auth Service]] · [[AI Service]]
