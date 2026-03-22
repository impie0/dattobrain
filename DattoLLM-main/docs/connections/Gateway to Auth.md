---
type: Connection
from: "[[API Gateway]]"
to: "[[Auth Service]]"
tags:
  - connection
---
# Gateway → Auth Service

> [!info] Key facts
> **Routes:** `/api/auth/*` | **Port:** 5001 | **Auth:** None (these ARE the auth endpoints)

- `POST /api/auth/login` → issue [[JWT Model|JWT]]
- `POST /auth/refresh` → renew access token
- `GET /auth/introspect` → validate claims
- `GET /api/auth/verify` → APISIX compat check

**See also:** [[Authentication Flow]] · [[Browser to Gateway]] · [[Gateway to AI]]
