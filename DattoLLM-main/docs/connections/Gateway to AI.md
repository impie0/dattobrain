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

> [!note] Chat route timeout
> The `/api/chat` route has a **180-second timeout** configured in APISIX (`setup-apisix.sh`). This accommodates local Ollama model inference (~10–30s on CPU) plus multi-step tool calling loops. The default APISIX timeout (60s) is too short for cached-mode queries that use local synthesis.

**See also:** [[Chat Request Flow]] · [[Browser to Gateway]] · [[Gateway to Auth]]
