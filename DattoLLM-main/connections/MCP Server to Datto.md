---
type: Connection
from: "[[MCP Server]]"
to: "Datto RMM API"
---
# MCP Server → Datto API

**Base:** `*.centrastage.net`
**Auth:** OAuth Bearer token (cached in-memory by TokenManager)
**Methods:** GET only (read-only by design)

37 read-only tools. Token refreshed 5min before expiry. On 401: invalidate → re-auth → retry once. Rate limit: 600 req/60s (sync enforces 480 cap).
