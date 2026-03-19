---
type: Connection
from: "[[Auth Service]]"
to: "[[PostgreSQL]]"
---
# Auth Service → PostgreSQL

**Via:** PgBouncer :5432
**Protocol:** PostgreSQL wire protocol

**Reads:** `users`, `roles`, `user_roles`, `tool_permissions` (at login/refresh)
**Writes:** `refresh_tokens`, `audit_logs` (login events)

Tool permissions = UNION across all user roles → sealed into JWT at login.
