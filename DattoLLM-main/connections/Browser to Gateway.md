---
type: Connection
from: "[[Web App|Browser]]"
to: "[[API Gateway]]"
---
# Browser → API Gateway

**Port:** 80 (HTTP)
**Via:** APISIX reverse proxy

All user traffic enters here. APISIX validates RS256 JWT on protected routes, injects `X-User-Id`, `X-User-Role`, `X-Allowed-Tools` headers via Lua, then forwards upstream.

Unprotected: `/api/auth/*`
Protected: everything else
