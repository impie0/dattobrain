---
tags:
  - platform/module
  - auth
  - datto
type: Module
description: In-memory Datto OAuth token cache inside MCP Server — prevents redundant OAuth round-trips across concurrent tool requests
---

# Token Manager

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Module** node

**Purpose:** In-memory Datto OAuth token cache inside [[MCP Server]]. Prevents redundant OAuth calls across concurrent tool requests.

**File:** `read-only-mcp/src/index.ts` (inline class)

## Functions

| Function | Description |
|---|---|
| `getToken()` | Return cached token or fetch new one |
| `refreshToken()` | POST to Datto `/auth/oauth/token`, store result + `expiresAt` |
| `invalidate()` | Clear cache on 401 response from Datto |

## Logic

```
if (Date.now() < expiresAt - 5min) return cached
else refreshToken()
```

On 401 from Datto API:
1. `invalidate()` — clears cached token
2. `refreshToken()` — fetches new OAuth token
3. Retry original request once

**Called by:** Tool handlers in [[MCP Server]]
**Calls:** `POST *.centrastage.net/auth/oauth/token`

## Related Nodes

[[MCP Server]] · [[Datto Credential Isolation]] · [[Tool Execution Flow]]
