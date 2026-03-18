---
tags:
  - platform/service
  - gateway
  - security
type: Service
description: Single public entry point — RS256 JWT validation, traffic routing, and rate limiting via APISIX
---

# API Gateway

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Service** node

**Purpose:** Single public entry point. Validates RS256 JWTs, injects user identity headers, routes traffic, enforces rate limits. Backed by `etcd` for live config.

**Image:** `apache/apisix:3.9.0-debian`
**Ports:** `80` (public), `127.0.0.1:9180` (admin API)
**Networks:** `public` + `internal`

## Dependencies

- [[etcd]] — route and plugin configuration store
- [[Auth Service]] — upstream for `/api/auth/*`
- [[AI Service]] — upstream for `/api/chat`, `/api/history`, `/api/admin/*`, `/api/tools`, `/api/debug/*`, `/api/approvals*`
- [[Web App]] — upstream for `/*` catch-all
- Redis — rate-limit counters

## Key Functions

- JWT validation (RS256 signature + expiry) on every protected route
- Lua `serverless-post-function` decodes JWT payload and injects:
  - `X-User-Id: <sub>`
  - `X-User-Role: <role>`
  - `X-Allowed-Tools: <json array>`
- Routes: `/api/auth/*` (no JWT), all others require Bearer token

**Lua injection snippet (all protected routes):**
```lua
local pl = cjson.decode(ngx.decode_base64(jwt_payload_part))
ngx.req.set_header("X-User-Id", pl.sub or "")
ngx.req.set_header("X-User-Role", pl.role or "")
ngx.req.set_header("X-Allowed-Tools", cjson.encode(pl.allowed_tools or {}))
```

## Related Nodes

[[Auth Service]] · [[AI Service]] · [[JWT Model]] · [[Network Isolation]] · [[Authentication Flow]] · [[Web App]]
