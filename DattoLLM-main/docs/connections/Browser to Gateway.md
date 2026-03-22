---
type: Connection
from: "[[Web App|Browser]]"
to: "[[API Gateway]]"
tags:
  - connection
---
# Browser → API Gateway

> [!info] Key facts
> **Port:** 80 (HTTP) | **Via:** APISIX reverse proxy | **Auth:** RS256 [[JWT Model|JWT]]

All user traffic enters here. APISIX validates RS256 JWT on protected routes, injects `X-User-Id`, `X-User-Role`, `X-Allowed-Tools` headers via Lua, then forwards upstream.

**Unprotected:** `/api/auth/*`
**Protected:** everything else

**See also:** [[Authentication Flow]] · [[Gateway to Auth]] · [[Gateway to AI]] · [[Gateway to WebApp]]
