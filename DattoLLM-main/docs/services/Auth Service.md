---
tags:
  - platform/service
  - auth
  - jwt
aliases:
  - auth-service
  - auth
type: Service
description: RS256 JWT issuance, credential validation, RBAC-aware allowed_tools computation, and refresh token management
---

# Auth Service

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Issues RS256 JWT tokens, validates credentials against PostgreSQL, computes per-user `allowed_tools`, manages refresh tokens.

> [!info] Service Details
> **Build:** `./auth-service`
> **Port:** `5001`
> **Key env vars:** `DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `REDIS_URL`

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
| `handleRevoke` | `POST /auth/revoke` | Revoke single JTI or all active JTIs for a user (SEC-002, SEC-008) |

## Token Signing

File: `auth-service/src/tokens.ts`

- `signAccessToken(payload)` — RS256, 1h TTL — embeds `jti: randomUUID()`, returns `{token, jti}` (SEC-002)
- `generateRefreshToken()` — 32-byte hex opaque token
- `hashRefreshToken(raw)` — SHA-256, stored in DB (never plaintext)
- Keys accepted as raw PEM or base64-encoded PEM

## JTI Tracking

File: `auth-service/src/redis.ts`

- `trackJti(userId, jti)` — `ZADD user_jtis:<userId> <expiryTimestamp> <jti>` — called after every login/refresh
- `revokeJti(jti)` — `SET revoked_jtis:<jti> 1 EX 3600` — single-token revocation
- `revokeAllForUser(userId)` — scans `user_jtis:<userId>`, revokes all active JTIs — forced-revoke (SEC-008)
- Graceful degradation: if Redis is unavailable, revocation is skipped (fail-open)

## Connections

- [[connections/Auth to PostgreSQL|Auth → PostgreSQL]] — credential validation, token storage
- [[connections/Gateway to Auth|Gateway → Auth]] — APISIX forwards `/api/auth/*`

## Related Nodes

[[JWT Model]] · [[RBAC System]] · [[Authentication Flow]] · [[Users Table]] · [[Tool Permissions Table]] · [[API Gateway]] · [[Network Isolation]] · [[Roles Table]] · [[PostgreSQL]] · [[Token Manager]] · [[MCP Bridge]]
