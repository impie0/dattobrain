---
type: Connection
from: "[[Auth Service]]"
to: "[[PostgreSQL]]"
tags:
  - connection
---
# Auth Service → PostgreSQL

> [!info] Key facts
> **Via:** PgBouncer :5432 | **Protocol:** PostgreSQL wire protocol

**Reads:** [[Users Table|users]], [[Roles Table|roles]], `user_roles`, [[Tool Permissions Table|tool_permissions]] (at login/refresh)
**Writes:** `refresh_tokens`, `audit_logs` (login events)

Tool permissions = UNION across all user roles → sealed into [[JWT Model|JWT]] at login.

**See also:** [[Authentication Flow]] · [[AI to PostgreSQL]] · [[RBAC System]]
