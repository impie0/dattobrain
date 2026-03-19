---
type: Connection
from: "[[API Gateway]]"
to: "[[Auth Service]]"
---
# Gateway → Auth Service

**Routes:** `/api/auth/*`
**Port:** 5001
**Auth:** None (these ARE the auth endpoints)

- `POST /api/auth/login` → issue JWT
- `POST /auth/refresh` → renew access token
- `GET /auth/introspect` → validate claims
- `GET /api/auth/verify` → APISIX compat check
