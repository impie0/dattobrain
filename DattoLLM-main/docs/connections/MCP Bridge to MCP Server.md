---
type: Connection
from: "[[MCP Bridge]]"
to: "[[MCP Server]]"
tags:
  - connection
---
# MCP Bridge → MCP Server

> [!info] Key facts
> **Endpoint:** `POST /mcp` | **Port:** 3001 | **Protocol:** JSON-RPC 2.0 | **Auth:** `X-Internal-Secret` header (shared secret)

Forwards approved tool calls only. Retries on 503 with 1s/2s/4s backoff (max 3). 401 = immediate fail. This is the **only path** to Datto credentials (see [[Datto Credential Isolation]]).

**See also:** [[Tool Execution Flow]] · [[AI to MCP Bridge]] · [[MCP Server to Datto]]
