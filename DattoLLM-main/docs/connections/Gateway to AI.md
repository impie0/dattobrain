---
type: Connection
from: "[[API Gateway]]"
to: "[[AI Service]]"
tags:
  - connection
---
# Gateway → AI Service

> [!info] Key facts
> **Routes:** `/api/chat`, `/api/history/*`, `/api/admin/*`, `/api/tools`, `/api/approvals*` | **Port:** 6001 | **Auth:** RS256 [[JWT Model|JWT]] required

All chat, history, admin CRUD, tool listing, and approval requests. JWT validated and user identity headers injected by APISIX before forwarding.

**See also:** [[Chat Request Flow]] · [[Browser to Gateway]] · [[Gateway to Auth]]
