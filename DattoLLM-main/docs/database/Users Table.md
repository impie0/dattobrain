---
tags:
  - platform/database
  - auth
  - users
aliases:
  - users-table
  - users
type: Database
description: Platform users table with bcrypt credentials, active flag, and approval_authority for tool approval workflows
---

# Users Table

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Database** node

**Table:** `users` in [[PostgreSQL]]

## Schema

```sql
id               uuid PRIMARY KEY DEFAULT uuid_generate_v4()
username         text NOT NULL UNIQUE
email            text NOT NULL UNIQUE
password_hash    text NOT NULL          -- bcrypt cost 12
is_active        boolean DEFAULT true
approval_authority text[] DEFAULT '{}'  -- tools this user can approve
created_at       timestamptz DEFAULT now()
updated_at       timestamptz DEFAULT now()
last_login_at    timestamptz
```

## Default Users

Password for all: `secret`

| Username | Email | Role |
|---|---|---|
| `admin_user` | `admin@example.com` | admin |
| `analyst_user` | `analyst@example.com` | analyst |
| `helpdesk_user` | `helpdesk@example.com` | helpdesk |
| `readonly_user` | `readonly@example.com` | readonly |

## Used By

- [[Auth Service]] — login, token refresh, credential validation
- [[AI Service]] — admin CRUD (`/api/admin/users`), approvals
- [[Voice Gateway]] — service account user for voice calls
- [[Web App]] — admin user management UI

## References

`user_roles` · `chat_sessions` · `chat_messages` · `refresh_tokens` · `audit_logs` · `approvals`

> [!tip] Default Credentials
> All seed users share the password `secret`. Change these immediately in production.

## Related Nodes

[[Auth Service]] · [[Roles Table]] · [[RBAC System]] · [[Authentication Flow]] · [[PostgreSQL]] · [[AI Service]] · [[Tool Permissions Table]] · [[JWT Model]] · [[Voice Gateway]] · [[Web App]]
