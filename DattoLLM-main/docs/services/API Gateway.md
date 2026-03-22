---
tags:
  - platform/service
  - gateway
  - security
aliases:
  - api-gateway
  - apisix
  - gateway
type: Service
description: Single public entry point — RS256 JWT validation, traffic routing, and rate limiting via APISIX
---

# API Gateway

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Single public entry point. Validates RS256 JWTs, injects user identity headers, routes traffic, enforces rate limits. Backed by `etcd` for live config.

> [!info] Service Details
> **Image:** `apache/apisix:3.9.0-debian`
> **Ports:** `80` (public), `127.0.0.1:9180` (admin API)
> **Networks:** `public` + `internal`

## Dependencies

- [[etcd]] — route and plugin configuration store
- [[Auth Service]] — upstream for `/api/auth/*`
- [[AI Service]] — upstream for `/api/chat`, `/api/history`, `/api/admin/*`, `/api/tools`, `/api/debug/*`, `/api/approvals*`
- [[Web App]] — upstream for `/*` catch-all
- Redis — rate-limit counters and [[JWT Model|JTI]] revocation checks

## Key Functions

- ==JWT validation== (RS256 signature + expiry) on every protected route
- Lua `serverless-post-function` decodes JWT payload, checks JTI revocation, and injects:
  - `X-User-Id: <sub>`
  - `X-User-Role: <role>`
  - `X-Allowed-Tools: <json array>`
- SEC-002: JTI revocation — Lua queries `EXISTS revoked_jtis:<jti>` in Redis before forwarding. Returns 401 immediately on revoked tokens.
- Routes: `/api/auth/*` (no JWT, rate-limited), all others require Bearer token

**Lua injection snippet (all protected routes — see `setup-apisix.sh` for full one-liner):**
```lua
local pl = cjson.decode(ngx.decode_base64(jwt_payload_part))
-- SEC-002: JTI revocation check
if jti and redis.exists("revoked_jtis:" .. jti) == 1 then ngx.exit(401) end
ngx.req.set_header("X-User-Id", pl.sub or "")
ngx.req.set_header("X-User-Role", pl.role or "")
ngx.req.set_header("X-Allowed-Tools", cjson.encode(pl.allowed_tools or {}))
```

## Configuration

Routes, upstreams, and the JWT consumer are **not** stored in any repo file. They are pushed to the APISIX Admin API (backed by etcd) via `./setup-apisix.sh` on first deploy and after any fresh `docker compose up`.

**JWT consumer:** `setup-apisix.sh` creates consumer `dattoapp` with `algorithm: RS256`, `public_key` (decoded from `JWT_PUBLIC_KEY` in `.env`), and `"private_key": ""`. The empty `private_key` field is required — omitting it causes HTTP 400.

**12 routes configured by `setup-apisix.sh`:**
1. `/api/auth/*` — no JWT, rate-limited (5 req/s)
2. `/api/chat` POST — JWT + Lua inject
3. `/api/chat/mode` POST — JWT + Lua inject
4. `/api/history` GET — JWT + Lua inject
5. `/api/history/*` GET — JWT + Lua inject
6. `/api/admin/*` all methods — JWT + Lua inject
7. `/api/debug/*` GET — JWT + Lua inject
8. `/api/tools` GET — JWT + Lua inject
9. `/api/approvals/*` GET,POST — JWT + Lua inject
10. `/api/proposals/*` GET,POST — JWT + Lua inject
11. `/chat` POST — SSE streaming, JWT + Lua inject
12. `/*` catch-all — no auth, proxied to web-app

## Connections

- [[connections/Browser to Gateway|Browser → Gateway]] — all client requests enter here
- [[connections/Gateway to Auth|Gateway → Auth]] — forwards `/api/auth/*`
- [[connections/Gateway to AI|Gateway → AI]] — forwards `/api/chat`, `/api/history`, `/api/admin/*`
- [[connections/Gateway to WebApp|Gateway → WebApp]] — `/*` catch-all to Next.js

## Related Nodes

[[Auth Service]] · [[AI Service]] · [[JWT Model]] · [[Network Isolation]] · [[Authentication Flow]] · [[Web App]] · [[Voice Gateway]] · [[RBAC System]] · [[Chat Request Flow]]
