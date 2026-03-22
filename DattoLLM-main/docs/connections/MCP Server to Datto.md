---
type: Connection
from: "[[MCP Server]]"
to: "Datto RMM API"
tags:
  - connection
---
# MCP Server → Datto API

> [!info] Key facts
> **Base:** `*.centrastage.net` | **Auth:** OAuth Bearer token (cached in-memory by [[Token Manager]]) | **Methods:** GET only (read-only by design)

37 read-only tools. Token refreshed 5min before expiry. On 401: invalidate → re-auth → retry once. Rate limit: 600 req/60s (sync enforces 480 cap).

> [!warning] Rate limits
> Datto enforces 600 requests per 60 seconds. Exceeding this triggers a 403 IP block. The sync pipeline caps at 480 requests to leave headroom for live queries.

**See also:** [[Datto Credential Isolation]] · [[MCP Bridge to MCP Server]] · [[local-data]] · [[Tool Execution Flow]]
