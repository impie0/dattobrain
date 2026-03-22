---
tags:
  - platform/module
  - mcp
  - tools
type: Module
aliases:
  - Tool Registry
  - toolRegistry
description: Registry of all 40 tool definitions (37 MCP + 3 cached/MV-backed) — filters to allowed subset per user before passing schemas to the LLM
---

# Tool Router

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Module** node

**Purpose:** Registry of all 40 tool definitions used by [[AI Service]] to build LLM tool call schemas (OpenAI format, via LiteLLM). Includes 37 MCP tools (live Datto API) and 3 cached/MV-backed fleet tools. Only tools matching `allowed_tools` are passed to the LLM.

**Files (ARCH-002):**
- `ai-service/src/toolRegistry.ts` — thin re-export shim; all existing imports unchanged
- `ai-service/src/tools/index.ts` — assembles `toolRegistry` from domain modules
- `ai-service/src/tools/shared.ts` — `ToolDef` interface + shared constants
- Domain files: `fleet.ts` (3) · `account.ts` (8) · `sites.ts` (7) · `devices.ts` (5) · `alerts.ts` (1) · `jobs.ts` (5) · `audit.ts` (5) · `activity.ts` (1) · `filters.ts` (2) · `system.ts` (3)

## Tool Definition Structure

```typescript
{
  name: "list-devices",
  description: "List/search devices...",
  inputSchema: { type: "object", properties: { ... } }
}
```

## Tool Groups (40 total)

| Group | Count | Examples |
|---|---|---|
| **Fleet (MV-backed)** | 3 | `get-fleet-status`, `list-site-summaries`, `list-critical-alerts` |
| Account | 4 | `get-account`, `list-users`, `list-account-variables`, `list-components` |
| Sites | 7 | `list-sites`, `get-site`, `list-site-devices`, `list-site-open-alerts`, ... |
| Devices | 9 | `list-devices`, `get-device`, `get-device-by-mac`, `get-device-audit`, ... |
| Alerts | 5 | `list-open-alerts`, `list-resolved-alerts`, `get-alert`, ... |
| Jobs | 5 | `get-job`, `get-job-components`, `get-job-results`, `get-job-stdout`, `get-job-stderr` |
| Audit | 4 | `get-device-audit-by-mac`, `get-esxi-audit`, `get-printer-audit`, `get-device-software` |
| Activity | 1 | `get-activity-logs` |
| Filters | 2 | `list-default-filters`, `list-custom-filters` |
| System | 3 | `get-system-status`, `get-rate-limit`, `get-pagination-config` |

### Fleet Tools (MV-backed)

Three new cached tools backed by PostgreSQL materialized views, designed to replace multi-tool call patterns with single efficient queries:

| Tool | Description | Materialized View |
|---|---|---|
| `get-fleet-status` | Complete fleet overview — device counts, online/offline, sites, alerts, last sync times | `mv_fleet_status` |
| `list-site-summaries` | All sites with device counts and alert counts per site | `mv_site_summary` |
| `list-critical-alerts` | Top 20 Critical/High alerts with priority breakdown | `mv_critical_alerts`, `mv_alert_priority` |

Fleet tools are placed **first** in the registry array so the LLM sees them before heavier API-backed tools and prefers them for simple questions. Tool descriptions are written to guide the orchestrator toward these tools with phrases like "Use this FIRST" and "Much more efficient than calling list-sites + list-site-devices for each site".

## Truncation

All tool results (CACHED and LIVE) are capped at **8,000 characters** (`MAX_TOOL_RESULT_CHARS` in `chat.ts` / `legacyChat.ts`). Results exceeding the cap are truncated with a suffix suggesting narrower filters.

## Usage

At chat time: `toolRegistry.filter(t => allowedTools.includes(t.name))` → passed to [[Prompt Builder]] and Anthropic SDK. The [[RBAC System]] determines which tools each user can access via [[JWT Model|JWT]] claims.

**Called by:** `legacyChat.ts` · `chat.ts` · `admin.ts` (tools listing endpoint) · `preQuery.ts` (pattern permission checks)

## Related Nodes

[[RBAC System]] · [[Prompt Builder]] · [[MCP Bridge]] · [[Tool Execution Flow]] · [[AI Service]] · [[MCP Server]] · [[Tool Permissions Table]] · [[ActionProposal]] · [[Chat Request Flow]]
