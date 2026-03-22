---
tags:
  - platform/security
  - jwt
  - auth
type: Security
aliases:
  - JWT
  - JSON Web Token
description: RS256 asymmetric JWT structure with JTI revocation, claim purposes, token lifecycle, and key storage for the platform authentication model
---

# JWT Model

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Security** node

> [!info] Algorithm
> ==RS256 (asymmetric)== — private key signs in [[Auth Service]], public key verifies in [[API Gateway]]. No round-trip needed.

- Private key: [[Auth Service]] only — never leaves that container
- Public key: [[API Gateway]] — local signature verification, no round-trip to [[Auth Service]]

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

> [!success] JTI revocation (SEC-002) implemented
- `auth-service/src/tokens.ts` — `signAccessToken()` embeds `jti: randomUUID()`, returns `{token, jti}`
- `auth-service/src/redis.ts` — `trackJti(userId, jti)` → `ZADD user_jtis:<userId> <expiry> <jti>`
- `auth-service/src/redis.ts` — `revokeJti(jti)` → `SET revoked_jtis:<jti> 1 EX 3600`
- `auth-service/src/redis.ts` — `revokeAllForUser(userId)` → scans sorted set, writes all active JTIs to revocation set (SEC-008)
- APISIX Lua `serverless-post-function` — `EXISTS revoked_jtis:<jti>` via `resty.redis` — fail-open if Redis unavailable

## Key Storage

Keys stored in `.env` as **base64-encoded PEM** — the entire PEM file base64'd to a single line with no literal `\n` characters.

`auth-service/src/tokens.ts` detects format at startup:
- If value starts with `-----` → treated as raw PEM (legacy)
- Otherwise → base64-decoded to raw PEM

**Raw PEM with `\n` literals does NOT work.** Always use:
```bash
base64 -w 0 private.pem   # Linux  → JWT_PRIVATE_KEY
base64 -w 0 public.pem    # Linux  → JWT_PUBLIC_KEY
base64 -i private.pem     # macOS
```

`JWT_PUBLIC_KEY` is also read by `setup-apisix.sh` to configure the APISIX RS256 consumer.

## Related Nodes

[[Auth Service]] · [[RBAC System]] · [[API Gateway]] · [[Authentication Flow]] · [[Tool Permissions Table]] · [[AI Service]] · [[Web App]] · [[Network Isolation]]
