# Tool Router

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Module** node

**Purpose:** Registry of all 37 MCP tool definitions used by [[AI Service]] to build Anthropic tool call schemas. Only tools matching `allowed_tools` are passed to the LLM.

**File:** `ai-service/src/toolRegistry.ts`

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

At chat time: `toolRegistry.filter(t => allowedTools.includes(t.name))` → passed to [[Prompt Builder]] and Anthropic SDK.

**Called by:** `legacyChat.ts` · `chat.ts` · `admin.ts` (tools listing endpoint)

## Related Nodes

[[RBAC System]] · [[Prompt Builder]] · [[MCP Bridge]] · [[Tool Execution Flow]] · [[AI Service]]
