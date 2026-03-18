# Auth Service

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Service** node

**Purpose:** Issues RS256 JWT tokens, validates credentials against PostgreSQL, computes per-user `allowed_tools`, manages refresh tokens.

**Build:** `./auth-service`
**Port:** `5001`
**Key env vars:** `DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`

## Dependencies

- [[PostgreSQL]] — users, roles, tool_permissions, refresh_tokens, audit_logs
- [[Users Table]] · [[Roles Table]] · [[Tool Permissions Table]]

## Key Functions

File: `auth-service/src/handlers.ts`

| Function | Route | Purpose |
|---|---|---|
| `handleLegacyLogin` | `POST /api/auth/login` | Web-app compat: `{username,password}` → `{token}` |
| `handleLogin` | `POST /auth/login` | Platform: `{email,password}` → `{access_token, refresh_token}` |
| `handleRefresh` | `POST /auth/refresh` | Renew access token, re-query tool permissions |
| `handleIntrospect` | `GET /auth/introspect` | Validate token, return claims |
| `handleLegacyVerify` | `GET /api/auth/verify` | APISIX compat token check |

## Token Signing

File: `auth-service/src/tokens.ts`

- `signAccessToken(payload)` — RS256, 1h TTL
- `generateRefreshToken()` — 32-byte hex opaque token
- `hashRefreshToken(raw)` — SHA-256, stored in DB (never plaintext)
- Keys accepted as raw PEM or base64-encoded PEM

## Related Nodes

[[JWT Model]] · [[RBAC System]] · [[Authentication Flow]] · [[Users Table]] · [[Tool Permissions Table]] · [[API Gateway]]
