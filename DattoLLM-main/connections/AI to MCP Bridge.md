---
type: Connection
from: "[[AI Service]]"
to: "[[MCP Bridge]]"
---
# AI Service → MCP Bridge

**Endpoint:** `POST /tool-call`
**Port:** 4001
**Payload:** `{toolName, toolArgs, allowedTools, requestId}`

Called inside the orchestrator's agentic loop. Bridge validates `toolName` is in `allowedTools` before forwarding. Returns **403** if denied + logs to `audit_logs`.
