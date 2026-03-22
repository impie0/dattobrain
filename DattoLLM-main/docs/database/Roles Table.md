---
tags:
  - platform/database
  - rbac
  - auth
aliases:
  - roles-table
  - roles
type: Database
description: roles and user_roles tables — many-to-many role assignments with union-based effective tool list computation
---

# Roles Table

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Database** node

**Tables:** `roles` + `user_roles` in [[PostgreSQL]]

## Schema

```sql
-- roles
id          uuid PRIMARY KEY DEFAULT uuid_generate_v4()
name        text NOT NULL UNIQUE
description text
created_at  timestamptz DEFAULT now()

-- user_roles (many-to-many)
user_id     uuid REFERENCES users(id) ON DELETE CASCADE
role_id     uuid REFERENCES roles(id) ON DELETE CASCADE
PRIMARY KEY (user_id, role_id)
```

## How Tool Access Is Computed

A user's effective tool list = ==UNION== of all [[Tool Permissions Table|tool_permissions]] rows across **all roles the user holds**.

A user can hold multiple roles simultaneously (e.g. `analyst` + `helpdesk`).

> [!info] Multi-Role Support
> The `user_roles` junction table enables many-to-many relationships. A user's effective tool list is the union across all assigned roles.

## Default Roles

| Role | Tools |
|---|---|
| admin | all 37 |
| analyst | 9 |
| helpdesk | 5 |
| readonly | 4 |

See [[RBAC System]] for full tool lists per role.

## Used By

- [[Auth Service]] — login query to compute `allowed_tools`
- [[AI Service]] — `GET/PUT /api/admin/roles`
- [[Web App]] — admin role management UI

## Related Nodes

[[Tool Permissions Table]] · [[RBAC System]] · [[Users Table]] · [[PostgreSQL]] · [[Auth Service]] · [[AI Service]] · [[JWT Model]] · [[Authentication Flow]] · [[Web App]]
