---
type: Connection
from: "[[API Gateway]]"
to: "[[AI Service]]"
---
# Gateway → AI Service

**Routes:** `/api/chat`, `/api/history/*`, `/api/admin/*`, `/api/tools`, `/api/approvals*`
**Port:** 6001
**Auth:** RS256 JWT required — decoded by Lua

All chat, history, admin CRUD, tool listing, and approval requests. JWT validated and user identity headers injected by APISIX before forwarding.
