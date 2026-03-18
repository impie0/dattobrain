---
tags:
  - platform/security
  - jwt
  - auth
type: Security
description: RS256 asymmetric JWT structure with JTI revocation, claim purposes, token lifecycle, and key storage for the platform authentication model
---

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
  "jti": "550e8400-e29b-41d4-a716-446655440000",
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
| `jti` | [[API Gateway]] Lua, [[Auth Service]] Redis | Per-token UUID for revocation — checked against `revoked_jtis:<jti>` in Redis on every request (SEC-002) |
| `exp` | [[API Gateway]] | Reject stale tokens before any service |

## Token Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active: Login — token + jti issued\nJTI tracked in Redis user_jtis:<userId>
    Active --> Expired: exp reached (1h platform / 24h legacy)
    Expired --> Active: POST /auth/refresh → new token + new jti\nre-query tool_permissions
    Active --> Revoked: Admin forced-revoke\nPOST /api/admin/users/:id/revoke\nAll user JTIs → revoked_jtis:<jti>
    Active --> Revoked: Single-token revoke\nPOST /auth/revoke {jti}\nrevoked_jtis:<jti> SET EX 3600
    Revoked --> [*]: APISIX Lua rejects 401\nMust re-login
    Expired --> [*]: Refresh token also expired (7 days)
```

**JTI revocation (SEC-002 ✅):**
- `auth-service/src/tokens.ts` — `signAccessToken()` embeds `jti: randomUUID()`, returns `{token, jti}`
- `auth-service/src/redis.ts` — `trackJti(userId, jti)` → `ZADD user_jtis:<userId> <expiry> <jti>`
- `auth-service/src/redis.ts` — `revokeJti(jti)` → `SET revoked_jtis:<jti> 1 EX 3600`
- `auth-service/src/redis.ts` — `revokeAllForUser(userId)` → scans sorted set, writes all active JTIs to revocation set (SEC-008)
- APISIX Lua `serverless-post-function` — `EXISTS revoked_jtis:<jti>` via `resty.redis` — fail-open if Redis unavailable

## Key Storage

Keys stored in `.env` as base64-encoded PEM. `auth-service/src/tokens.ts` detects and decodes both raw PEM and base64 formats.

## Related Nodes

[[Auth Service]] · [[RBAC System]] · [[API Gateway]] · [[Authentication Flow]] · [[Tool Permissions Table]]
