---
tags:
  - platform/database
  - rbac
  - tools
aliases:
  - tool-permissions-table
  - tool-permissions
type: Database
description: Source-of-truth RBAC table mapping roles to tool names — changes take effect at next token refresh
---

# Tool Permissions Table

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Database** node

**Table:** `tool_permissions` in [[PostgreSQL]]

## Schema

```sql
id          uuid PRIMARY KEY DEFAULT uuid_generate_v4()
role_id     uuid REFERENCES roles(id) ON DELETE CASCADE
tool_name   text NOT NULL
UNIQUE (role_id, tool_name)
```

> [!tip] Source of Truth
> This is the ==source of truth== for [[RBAC System|RBAC]]. Adding a row grants the tool to that role. Removing it revokes it. Changes take effect at the user's **next token refresh**.

## Related Table: tool_policies

Per-tool metadata (does not affect RBAC — only affects UI display and approval workflow):

```sql
-- tool_policies
tool_name        text PRIMARY KEY
risk_level       text DEFAULT 'low'
approval_required boolean DEFAULT false
description      text
```

## Used By

- [[Auth Service]] — login + refresh (source of `allowed_tools` in [[JWT Model|JWT]])
- [[AI Service]] — `GET/PUT /api/admin/roles/:role`
- [[MCP Bridge]] — introspect call verifies DB-sourced permissions
- [[Web App]] — admin tool policy management UI

## Managed Via

- `PUT /api/admin/roles/:role` — replaces all tool grants for a role
- `PATCH /api/admin/tools/:toolName` — update tool_policies metadata

## Related Nodes

[[Roles Table]] · [[RBAC System]] · [[Auth Service]] · [[JWT Model]] · [[PostgreSQL]] · [[AI Service]] · [[MCP Bridge]] · [[Users Table]] · [[Authentication Flow]] · [[Tool Execution Flow]] · [[Web App]]
