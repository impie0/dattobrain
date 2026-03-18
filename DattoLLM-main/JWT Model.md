# JWT Model

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Security** node

**Algorithm:** RS256 (asymmetric)
- Private key: [[Auth Service]] only — never leaves that container
- Public key: [[API Gateway]] — local signature verification, no round-trip to Auth Service

## Payload Structure

```json
{
  "key": "dattoapp",
  "sub": "<user-uuid>",
  "email": "user@example.com",
  "role": "admin",
  "roles": ["admin"],
  "allowed_tools": ["get-account", "list-sites", "..."],
  "iat": 1710000000,
  "exp": 1710086400
}
```

## Claim Purposes

| Claim | Used By | Purpose |
|---|---|---|
| `key` | [[API Gateway]] jwt-auth plugin | Consumer identity for APISIX |
| `sub` | [[AI Service]], audit_logs | User identity throughout platform |
| `role` | [[Web App]] | Display role in UI |
| `allowed_tools` | [[API Gateway]] Lua → [[AI Service]] | RBAC enforcement — sealed at login |
| `exp` | [[API Gateway]] | Reject stale tokens before any service |

## Token Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active: Login → token issued
    Active --> Expired: exp reached (1h platform / 24h legacy)
    Expired --> Active: POST /auth/refresh → re-query tool_permissions
    Active --> Revoked: Admin action
    Revoked --> [*]: Must re-login
    Expired --> [*]: Refresh token also expired (7 days)
```

## Key Storage

Keys stored in `.env` as base64-encoded PEM. `auth-service/src/tokens.ts` detects and decodes both raw PEM and base64 formats.

## Related Nodes

[[Auth Service]] · [[RBAC System]] · [[API Gateway]] · [[Authentication Flow]] · [[Tool Permissions Table]]
