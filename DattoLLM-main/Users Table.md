# Users Table

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Database** node

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

- [[Auth Service]] — login, token refresh
- [[AI Service]] — admin CRUD (`/api/admin/users`), approvals

## References

`user_roles` · `chat_sessions` · `chat_messages` · `refresh_tokens` · `audit_logs` · `approvals`

## Related Nodes

[[Auth Service]] · [[Roles Table]] · [[RBAC System]] · [[Authentication Flow]] · [[PostgreSQL]]
