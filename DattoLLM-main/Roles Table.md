# Roles Table

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Database** node

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

A user's effective tool list = UNION of all `tool_permissions` rows across **all roles the user holds**.

A user can hold multiple roles simultaneously (e.g. `analyst` + `helpdesk`).

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

## Related Nodes

[[Tool Permissions Table]] · [[RBAC System]] · [[Users Table]] · [[PostgreSQL]]
