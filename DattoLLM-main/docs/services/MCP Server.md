---
tags:
  - platform/service
  - mcp
  - datto
aliases:
  - mcp-server
  - read-only-mcp
type: Service
description: The only container with Datto credentials — exposes 37 read-only tools over MCP HTTP transport
---

# MCP Server

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** The **only** container with Datto credentials. Exposes 37 read-only tools over HTTP using MCP `StreamableHTTPServerTransport`. Manages Datto OAuth token cache.

> [!info] Service Details
> **Build:** `./read-only-mcp`
> **Port:** `3001` (internal only)
> **Key env vars:** `DATTO_API_KEY`, `DATTO_API_SECRET`, `DATTO_PLATFORM`, `MCP_INTERNAL_SECRET`

## Dependencies

- Datto RMM API (`*.centrastage.net`)

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /mcp` | JSON-RPC 2.0 tool execution |
| `GET /health` | Liveness probe |
| `GET /metrics` | Prometheus counters |
| `GET /trace-spans` | Returns and drains buffered Datto API call spans (URL, method, status, duration, response size, retry flag). Called by [[MCP Bridge]] for distributed tracing. Requires `X-Internal-Secret` |

## Security Checks

On every `/mcp` request:
1. `X-Internal-Secret` header must match env var
2. `Accept: application/json, text/event-stream` required

## Token Management

See [[Token Manager]] for full details.
- Caches Datto OAuth token in memory
- Refreshes 5 minutes before expiry
- On 401 from Datto: invalidate + fetch + retry once

## 37 Tool Groups

| Group | Count | Examples |
|---|---|---|
| Account | 4 | `get-account`, `list-users`, `list-account-variables`, `list-components` |
| Sites | 7 | `list-sites`, `get-site`, `list-site-devices`, `list-site-open-alerts`, ... |
| Devices | 9 | `list-devices`, `get-device`, `get-device-by-mac`, `get-device-audit`, ... |
| Alerts | 5 | `list-open-alerts`, `list-resolved-alerts`, `get-alert`, ... |
| Jobs | 5 | `get-job`, `get-job-components`, `get-job-results`, `get-job-stdout`, `get-job-stderr` |
| Audit | 4 | `get-device-audit-by-mac`, `get-esxi-audit`, `get-printer-audit`, `get-device-software` |
| Activity | 1 | `get-activity-logs` |
| Filters | 2 | `list-default-filters`, `list-custom-filters` |
| System | 3 | `get-system-status`, `get-rate-limit`, `get-pagination-config` |

## Connections

- [[connections/MCP Bridge to MCP Server|MCP Bridge → MCP Server]] — receives approved tool calls
- [[connections/MCP Server to Datto|MCP Server → Datto]] — OAuth + REST calls to Datto RMM API

## Related Nodes

[[MCP Bridge]] · [[Token Manager]] · [[Tool Execution Flow]] · [[Datto Credential Isolation]] · [[Network Isolation]] · [[Tool Router]] · [[AI Service]] · [[RBAC System]]
