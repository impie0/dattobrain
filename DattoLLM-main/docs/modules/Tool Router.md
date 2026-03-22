---
tags:
  - platform/module
  - mcp
  - tools
type: Module
aliases:
  - Tool Registry
  - toolRegistry
description: Registry of all 37 MCP tool definitions — filters to allowed subset per user before passing schemas to the LLM
---

# Tool Router

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Module** node

**Purpose:** Registry of all 37 MCP tool definitions used by [[AI Service]] to build LLM tool call schemas (OpenAI format, via LiteLLM). Only tools matching `allowed_tools` are passed to the LLM.

**Files (ARCH-002):**
- `ai-service/src/toolRegistry.ts` — thin re-export shim; all existing imports unchanged
- `ai-service/src/tools/index.ts` — assembles `toolRegistry` from domain modules
- `ai-service/src/tools/shared.ts` — `ToolDef` interface + shared constants
- Domain files: `account.ts` (8) · `sites.ts` (7) · `devices.ts` (5) · `alerts.ts` (1) · `jobs.ts` (5) · `audit.ts` (5) · `activity.ts` (1) · `filters.ts` (2) · `system.ts` (3)

## Tool Definition Structure

```typescript
{
  name: "list-devices",
  description: "List/search devices...",
  inputSchema: { type: "object", properties: { ... } }
}
```

## Tool Groups (37 total)

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

## Usage

At chat time: `toolRegistry.filter(t => allowedTools.includes(t.name))` → passed to [[Prompt Builder]] and Anthropic SDK. The [[RBAC System]] determines which tools each user can access via [[JWT Model|JWT]] claims.

**Called by:** `legacyChat.ts` · `chat.ts` · `admin.ts` (tools listing endpoint)

## Related Nodes

[[RBAC System]] · [[Prompt Builder]] · [[MCP Bridge]] · [[Tool Execution Flow]] · [[AI Service]] · [[MCP Server]] · [[Tool Permissions Table]] · [[ActionProposal]] · [[Chat Request Flow]]
