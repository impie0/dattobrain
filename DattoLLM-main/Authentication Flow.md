# Authentication Flow

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Flow** node

How a user logs in, gets a JWT with baked-in tool permissions, and that JWT is validated on every subsequent request.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant GW as API Gateway
    participant A as Auth Service
    participant DB as PostgreSQL

    B->>GW: POST /api/auth/login {username, password}
    GW->>A: Forward (no JWT check on auth routes)
    A->>DB: SELECT id, password_hash, is_active FROM users WHERE username=$1
    DB-->>A: User row

    alt Invalid credentials
        A->>DB: INSERT audit_logs {login_failure, ip}
        A-->>B: 401 Invalid credentials
    else Valid
        A->>A: bcrypt.compare(password, hash)
        A->>DB: SELECT tool_name FROM tool_permissions JOIN user_roles WHERE user_id=$1
        DB-->>A: allowed_tools[]
        A->>A: Sign RS256 JWT {key,sub,email,role,roles,allowed_tools,exp:+24h}
        A->>DB: INSERT audit_logs {login_success, ip}
        A-->>B: 200 {token}
        B->>B: Store token in cookie
    end
```

## JWT Payload

```json
{
  "key": "dattoapp",
  "sub": "<uuid>",
  "email": "admin@example.com",
  "role": "admin",
  "roles": ["admin"],
  "allowed_tools": ["get-account", "list-sites", "...37 total"]
}
```

## Key Points

- `allowed_tools` is computed once at login from `tool_permissions` table — sealed into the token
- The [[API Gateway]] validates the RS256 signature locally (no round-trip to [[Auth Service]])
- APISIX Lua injects `X-User-Id`, `X-User-Role`, `X-Allowed-Tools` headers from the decoded payload
- Failed logins are audit-logged with the client IP

## Related Nodes

[[Auth Service]] · [[JWT Model]] · [[RBAC System]] · [[Users Table]] · [[Tool Permissions Table]] · [[API Gateway]]
