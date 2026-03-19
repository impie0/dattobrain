# Fuzzy Search + Context Overflow Fix — Complete Architectural Flow

## Problems

1. **Token waste:** `list-sites()` returns ALL 89 sites (~170K tokens) even when looking for one site
2. **Broken filter:** `cachedListSites()` ignores the `siteName` parameter entirely
3. **No typo tolerance:** ILIKE `%rojlig%` won't match "Rohlig" — need fuzzy matching (pg_trgm)
4. **Stage 2 overflow:** `compressForSynthesizer()` exists but is never called → DeepSeek R1 gets 175K tokens, crashes at 163K limit

---

## COMPLETE Current System Flow

User asks: **"How many devices at Rojlig?"**

Every service, every auth check, every step — exactly as it runs today.

### Step 1: Browser → API Gateway

```
BROWSER
  │
  │  POST /api/chat
  │  Headers:
  │    Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
  │    Content-Type: application/json
  │  Body:
  │    { "message": "how many devices at rojlig?",
  │      "sessionId": "uuid-of-session" }
  │
  ▼
API GATEWAY (apisix :80)
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  AUTH CHECK #1 — JWT Validation                          │
  │  │                                                          │
  │  │  1. jwt-auth plugin extracts Bearer token                │
  │  │  2. Verifies RS256 signature using auth-service          │
  │  │     public key (no round-trip to auth-service)           │
  │  │  3. Checks exp claim — reject if expired                 │
  │  │  4. Checks key == "dattoapp"                             │
  │  │                                                          │
  │  │  If invalid → 401 immediately, request stops here        │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  AUTH CHECK #2 — JTI Revocation (SEC-002)                │
  │  │                                                          │
  │  │  Lua serverless-post-function:                           │
  │  │    1. Decode JWT payload                                 │
  │  │    2. Extract jti (JWT ID)                               │
  │  │    3. Query Redis: EXISTS revoked_jtis:<jti>             │
  │  │    4. If found → 401 (token was revoked by admin)        │
  │  │                                                          │
  │  │  This catches tokens that are still cryptographically    │
  │  │  valid but were explicitly revoked                       │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  HEADER INJECTION                                        │
  │  │                                                          │
  │  │  Lua decodes JWT payload and injects:                    │
  │  │    X-User-Id: "ff2267cc-de92-4f4d-822f-2b3c9f595363"   │
  │  │    X-User-Role: "admin"                                  │
  │  │    X-Allowed-Tools: '["get-account","list-sites",        │
  │  │      "list-devices","get-device","get-site",...37 total]' │
  │  │                                                          │
  │  │  These headers are TRUSTED by downstream services        │
  │  │  because only the gateway can set them (internal net)    │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  Route: /api/chat → upstream ai-service:6001
  │
  ▼
```

### Step 2: AI Service — Setup Phase

```
AI SERVICE (:6001)  —  file: chat.ts (SSE handler) or legacyChat.ts (JSON handler)
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  READ HEADERS                                            │
  │  │                                                          │
  │  │  userId = req.headers["x-user-id"]                       │
  │  │  role = req.headers["x-user-role"]                       │
  │  │  allowedTools = JSON.parse(req.headers["x-allowed-tools"])│
  │  │  jwtToken = req.headers["authorization"]                 │
  │  │    → extracted from "Bearer <token>"                     │
  │  │    → passed to MCP bridge for independent verification   │
  │  │                                                          │
  │  │  message = req.body.message                              │
  │  │  sessionId = req.body.sessionId                          │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  CREATE TRACE CONTEXT                                    │
  │  │                                                          │
  │  │  requestId = randomUUID()                                │
  │  │  trace = new TraceContext(pool, requestId)                │
  │  │  trace.init({ userId, sessionId, question })             │
  │  │    → INSERT INTO request_traces (id, session_id,         │
  │  │       user_id, question, status='in_progress')           │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  LOAD ROUTING CONFIG                                     │
  │  │  File: llmConfig.ts → getRoutingConfig(pool)             │
  │  │                                                          │
  │  │  SQL: SELECT key, model FROM llm_routing_config          │
  │  │  (cached in-process for 60 seconds)                      │
  │  │                                                          │
  │  │  Returns:                                                │
  │  │    orchestrator_default    = "claude-haiku-4-5-20251001"  │
  │  │    orchestrator_high_risk  = "claude-opus-4-6"            │
  │  │    synthesizer_default     = "claude-haiku-4-5-20251001"  │
  │  │    synthesizer_large_data  = "deepseek/deepseek-r1"       │
  │  │    synthesizer_high_risk   = "claude-opus-4-6"            │
  │  │    synthesizer_cached      = "claude-haiku-4-5-20251001"  │
  │  │    default_data_mode       = "cached"                     │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  SESSION LOOKUP                                          │
  │  │                                                          │
  │  │  SQL: SELECT data_mode FROM chat_sessions WHERE id = $1  │
  │  │                                                          │
  │  │  Resolves data_mode:                                     │
  │  │    session.data_mode = "live" → live                     │
  │  │    else config.default_data_mode = "live" → live         │
  │  │    else → "cached"                                       │
  │  │                                                          │
  │  │  Result: dataMode = "cached"                             │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  PARALLEL: Load History + Embed + Vector Search          │
  │  │  (Promise.all — runs simultaneously)                     │
  │  │                                                          │
  │  │  ┌── Thread A: History ──────────────────────────────┐   │
  │  │  │  File: history.ts → loadHistory(sessionId, pool)  │   │
  │  │  │  SQL: SELECT role, content                        │   │
  │  │  │       FROM chat_messages                          │   │
  │  │  │       WHERE session_id = $1                       │   │
  │  │  │       ORDER BY created_at ASC LIMIT 20            │   │
  │  │  │                                                   │   │
  │  │  │  Returns: last 20 messages in this conversation   │   │
  │  │  └──────────────────────────────────────────────────┘   │
  │  │                                                          │
  │  │  ┌── Thread B: Embed + Search ──────────────────────┐   │
  │  │  │  1. POST http://embedding-service:7001/embed      │   │
  │  │  │     Body: { text: "how many devices at rojlig?" } │   │
  │  │  │     Returns: { vector: [0.123, -0.456, ...1024] } │   │
  │  │  │                                                   │   │
  │  │  │  2. File: vectorSearch.ts → searchSimilar()       │   │
  │  │  │     SQL: SELECT content, role, tools_used,        │   │
  │  │  │          1 - (embedding <=> $1) AS similarity     │   │
  │  │  │          FROM chat_messages                       │   │
  │  │  │          WHERE user_id = $2                       │   │
  │  │  │            AND session_id != $3                   │   │
  │  │  │            AND 1 - (embedding <=> $1) > 0.78      │   │
  │  │  │          ORDER BY embedding <=> $1 LIMIT 5        │   │
  │  │  │                                                   │   │
  │  │  │  Returns: up to 5 semantically similar past msgs  │   │
  │  │  └──────────────────────────────────────────────────┘   │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  TOOL FILTERING (Layer 1 — Prompt Filter)                │
  │  │  File: chat.ts line 168                                  │
  │  │                                                          │
  │  │  filteredTools = toolRegistry.filter(t =>                 │
  │  │    allowedTools.includes(t.name))                        │
  │  │                                                          │
  │  │  toolRegistry has 37 tools total                         │
  │  │  allowedTools from JWT has (e.g.) 37 for admin           │
  │  │  Result: only tools this user can use                    │
  │  │                                                          │
  │  │  A helpdesk user would only see 5 tools here.            │
  │  │  The LLM literally cannot call tools it can't see.       │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  BUILD SYSTEM PROMPT                                     │
  │  │  File: prompt.ts → buildSystemPrompt()                   │
  │  │                                                          │
  │  │  Assembles:                                              │
  │  │    1. Platform instructions (you are a Datto assistant)  │
  │  │    2. Tool definitions JSON (ONLY filtered tools)        │
  │  │    3. Similar past messages (from vector search)         │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  HIGH RISK CHECK                                         │
  │  │  File: llmConfig.ts → checkHighRiskInScope()             │
  │  │                                                          │
  │  │  SQL: SELECT tool_name FROM tool_policies                │
  │  │       WHERE tool_name = ANY($1)                          │
  │  │         AND risk_level = 'high'                          │
  │  │                                                          │
  │  │  If ANY tool in user's set is high-risk:                 │
  │  │    → use orchestrator_high_risk model (Opus)             │
  │  │    → use synthesizer_high_risk model (Opus)              │
  │  │  Else:                                                   │
  │  │    → use orchestrator_default (Haiku)                    │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  conversationMessages = [...history, { role: "user", content: message }]
  │
  ▼
```

### Step 3: Stage 1 — Orchestrator Agentic Loop

```
AI SERVICE — STAGE 1 LOOP
  │
  │  orchestratorModel = "claude-haiku-4-5-20251001"
  │  CONTEXT_OVERFLOW_CHARS = 100,000
  │
  │  ╔═══════════════════════════════════════════════════════════╗
  │  ║  ITERATION 1                                              ║
  │  ║                                                           ║
  │  ║  Call LiteLLM (via OpenAI SDK):                           ║
  │  ║    POST http://litellm:4000/v1/chat/completions           ║
  │  ║    {                                                      ║
  │  ║      model: "claude-haiku-4-5-20251001",                  ║
  │  ║      messages: [system prompt, ...history, user question], ║
  │  ║      tools: [list-sites, list-devices, get-site, ...],    ║
  │  ║      stream: true                                         ║
  │  ║    }                                                      ║
  │  ║                                                           ║
  │  ║  LiteLLM routes to OpenRouter → Anthropic                 ║
  │  ║                                                           ║
  │  ║  LLM response (streamed chunks):                          ║
  │  ║    finish_reason: "tool_calls"                             ║
  │  ║    tool_calls: [{                                          ║
  │  ║      name: "list-sites",                                   ║
  │  ║      arguments: {}           ← NO FILTER (this is the bug) ║
  │  ║    }]                                                      ║
  │  ║                                                           ║
  │  ╚═══════════════════════════════════════════════════════════╝
  │
  │  LLM wants to call: list-sites()
  │  Now execute this tool call...
  │
  ▼
```

### Step 4: Tool Execution — TWO PATHS (Cached vs Live)

```
AI SERVICE — TOOL EXECUTION DECISION
  │  File: chat.ts lines 308-320
  │
  │  dataMode = "cached"
  │  toolName = "list-sites"
  │  isLiveOnlyTool("list-sites") = false
  │    (live-only = get-job*, get-activity-logs, get-system-status,
  │     get-rate-limit, get-pagination-config)
  │
  │  dataMode == "cached" AND NOT live-only?
  │
  ├─── YES → CACHED PATH ──────────────────────────────────────────┐
  │                                                                 │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  CACHED TOOL EXECUTION                                   │   │
  │  │  File: cachedQueries.ts → executeCachedTool()            │   │
  │  │                                                          │   │
  │  │  executeCachedTool("list-sites", {}, pool)               │   │
  │  │    → calls cachedListSites(db, {})                       │   │
  │  │                                                          │   │
  │  │  ┌───────────────────────────────────────────────────┐   │   │
  │  │  │  cachedListSites(db, {})                          │   │   │
  │  │  │  File: cachedQueries.ts line 60                   │   │   │
  │  │  │                                                   │   │   │
  │  │  │  page = 1, pageSize = 50, offset = 0              │   │   │
  │  │  │  siteName = undefined  (not passed by LLM)        │   │   │
  │  │  │                                                   │   │   │
  │  │  │  ▸▸▸ BUG: siteName param is NEVER checked ◂◂◂    │   │   │
  │  │  │  Even if LLM had passed siteName, code ignores it │   │   │
  │  │  │                                                   │   │   │
  │  │  │  SQL:                                             │   │   │
  │  │  │    SELECT data, synced_at                         │   │   │
  │  │  │    FROM datto_cache_sites                         │   │   │
  │  │  │    ORDER BY name                                  │   │   │
  │  │  │    LIMIT 50 OFFSET 0                              │   │   │
  │  │  │                                                   │   │   │
  │  │  │  PostgreSQL returns: ALL 50 sites (page 1 of 2)   │   │   │
  │  │  │  JSON result: ~170,000 characters                 │   │   │
  │  │  └───────────────────────────────────────────────────┘   │   │
  │  │                                                          │   │
  │  │  No network call. No MCP bridge. No auth check.          │   │
  │  │  Straight DB query → result string back to chat.ts       │   │
  │  └──────────────────────────────────────┬───────────────────┘   │
  │                                         │                       │
  │                                         │ resultText (170K)     │
  │                                         ▼                       │
  │                              (continue at Step 5)               │
  │                                                                 │
  ├─── NO → LIVE PATH ─────────────────────────────────────────────┐
  │    (or if cached query throws → falls back to live)             │
  │                                                                 │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  LIVE TOOL CALL — AI SERVICE → MCP BRIDGE                │   │
  │  │  File: mcpBridge.ts → callTool()                         │   │
  │  │                                                          │   │
  │  │  POST http://mcp-bridge:4001/tool-call                   │   │
  │  │  Headers:                                                │   │
  │  │    Content-Type: application/json                         │   │
  │  │    X-Trace-Id: <requestId>                               │   │
  │  │    X-Parent-Span-Id: <toolSpanId>                        │   │
  │  │  Body:                                                   │   │
  │  │    { toolName: "list-sites",                             │   │
  │  │      toolArgs: {},                                       │   │
  │  │      requestId: "uuid",                                  │   │
  │  │      allowedTools: ["list-sites",...],  ← IGNORED by     │   │
  │  │      jwtToken: "eyJhbG..." }              bridge for     │   │
  │  │                                           user requests  │   │
  │  │  Timeout: 35 seconds                                     │   │
  │  └──────────────────────────────────┬───────────────────────┘   │
  │                                     │                           │
  │                                     ▼                           │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  MCP BRIDGE (:4001) — PERMISSION GATE                    │   │
  │  │  File: mcp-bridge/src/index.ts                           │   │
  │  │                                                          │   │
  │  │  ┌── AUTH CHECK #3 — resolveAllowedTools() ──────────┐  │   │
  │  │  │                                                    │  │   │
  │  │  │  Is X-Internal-Secret header present and matching? │  │   │
  │  │  │                                                    │  │   │
  │  │  │  ├─ YES (internal caller, e.g. sync scheduler):    │  │   │
  │  │  │  │   Trust the allowedTools array from request body│  │   │
  │  │  │  │   → skip auth-service call                      │  │   │
  │  │  │  │                                                 │  │   │
  │  │  │  └─ NO (user request — THIS PATH):                 │  │   │
  │  │  │      jwtToken present?                             │  │   │
  │  │  │      │                                             │  │   │
  │  │  │      ├─ NO → return null → 401 Unauthorized        │  │   │
  │  │  │      │                                             │  │   │
  │  │  │      └─ YES → Call auth-service to verify:         │  │   │
  │  │  │                                                    │  │   │
  │  │  │         ┌──────────────────────────────────────┐   │  │   │
  │  │  │         │  GET http://auth-service:5001         │   │  │   │
  │  │  │         │      /auth/introspect                 │   │  │   │
  │  │  │         │  Headers:                             │   │  │   │
  │  │  │         │    Authorization: Bearer eyJhbG...    │   │  │   │
  │  │  │         │                                       │   │  │   │
  │  │  │         │  AUTH SERVICE checks:                 │   │  │   │
  │  │  │         │    1. Verify JWT signature (RS256)    │   │  │   │
  │  │  │         │    2. Check expiry                    │   │  │   │
  │  │  │         │    3. Check JTI not revoked in DB     │   │  │   │
  │  │  │         │    4. Query user's tool_permissions   │   │  │   │
  │  │  │         │       from PostgreSQL (NOT from JWT)  │   │  │   │
  │  │  │         │                                       │   │  │   │
  │  │  │         │  Returns:                             │   │  │   │
  │  │  │         │    { valid: true,                     │   │  │   │
  │  │  │         │      allowed_tools: ["list-sites",    │   │  │   │
  │  │  │         │        "list-devices", ...from DB] }  │   │  │   │
  │  │  │         └──────────────────────────────────────┘   │  │   │
  │  │  │                                                    │  │   │
  │  │  │  SEC-MCP-001: Bridge uses the DB-sourced list,     │  │   │
  │  │  │  NOT the list from request body. A compromised     │  │   │
  │  │  │  ai-service cannot forge permissions.              │  │   │
  │  │  └────────────────────────────────────────────────────┘  │   │
  │  │                                                          │   │
  │  │  ┌── AUTH CHECK #4 — checkPermission() ──────────────┐  │   │
  │  │  │  File: validate.ts                                 │  │   │
  │  │  │                                                    │  │   │
  │  │  │  Is "list-sites" in dbAllowedTools?                │  │   │
  │  │  │    YES → proceed                                   │  │   │
  │  │  │    NO  → 403 { error: "tool_denied" }              │  │   │
  │  │  └────────────────────────────────────────────────────┘  │   │
  │  │                                                          │   │
  │  │  Permission granted → forward to MCP Server              │   │
  │  └──────────────────────────────────┬───────────────────────┘   │
  │                                     │                           │
  │                                     ▼                           │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  MCP BRIDGE → MCP SERVER                                 │   │
  │  │  File: mcp-bridge/src/mcpClient.ts → callMcpTool()      │   │
  │  │                                                          │   │
  │  │  POST http://mcp-server:3001/mcp                         │   │
  │  │  Headers:                                                │   │
  │  │    Content-Type: application/json                         │   │
  │  │    Accept: application/json, text/event-stream            │   │
  │  │    X-Internal-Secret: <MCP_INTERNAL_SECRET>              │   │
  │  │    X-Trace-Id: <traceId>                                 │   │
  │  │  Body (JSON-RPC 2.0):                                    │   │
  │  │    { jsonrpc: "2.0",                                     │   │
  │  │      id: "<requestId>",                                  │   │
  │  │      method: "tools/call",                               │   │
  │  │      params: { name: "list-sites", arguments: {} } }     │   │
  │  │                                                          │   │
  │  │  Retry policy: 4 attempts (1s / 2s / 4s backoff)         │   │
  │  │    401 → throw immediately (bad secret)                  │   │
  │  │    503 → retry with backoff                              │   │
  │  │    network error → retry with backoff                    │   │
  │  │  Timeout: 30 seconds per attempt                         │   │
  │  └──────────────────────────────────┬───────────────────────┘   │
  │                                     │                           │
  │                                     ▼                           │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  MCP SERVER (:3001)                                      │   │
  │  │  File: read-only-mcp/src/index.ts                        │   │
  │  │                                                          │   │
  │  │  ┌── AUTH CHECK #5 — Internal Secret ────────────────┐  │   │
  │  │  │                                                    │  │   │
  │  │  │  req.headers["x-internal-secret"]                  │  │   │
  │  │  │    === process.env.MCP_INTERNAL_SECRET?            │  │   │
  │  │  │                                                    │  │   │
  │  │  │  YES → proceed                                     │  │   │
  │  │  │  NO  → 401                                         │  │   │
  │  │  └────────────────────────────────────────────────────┘  │   │
  │  │                                                          │   │
  │  │  ┌── AUTH CHECK #6 — Tool Registry ──────────────────┐  │   │
  │  │  │                                                    │  │   │
  │  │  │  Is "list-sites" in the 37 registered tools?       │  │   │
  │  │  │  YES → find handler                                │  │   │
  │  │  │  NO  → error "Unknown tool: x"                     │  │   │
  │  │  └────────────────────────────────────────────────────┘  │   │
  │  │                                                          │   │
  │  │  ┌── DATTO API CALL ─────────────────────────────────┐  │   │
  │  │  │                                                    │  │   │
  │  │  │  Token Manager:                                    │  │   │
  │  │  │    Is cached OAuth token valid (5min before exp)?  │  │   │
  │  │  │    YES → use cached token                          │  │   │
  │  │  │    NO  → POST *.centrastage.net/auth/oauth/token   │  │   │
  │  │  │           { grant_type: client_credentials }       │  │   │
  │  │  │           using DATTO_API_KEY + DATTO_API_SECRET   │  │   │
  │  │  │           → cache new token in memory              │  │   │
  │  │  │                                                    │  │   │
  │  │  │  GET https://merlot-api.centrastage.net            │  │   │
  │  │  │      /v2/account/sites                             │  │   │
  │  │  │  Headers:                                          │  │   │
  │  │  │    Authorization: Bearer <datto-oauth-token>       │  │   │
  │  │  │                                                    │  │   │
  │  │  │  Datto API returns: all sites JSON                 │  │   │
  │  │  │                                                    │  │   │
  │  │  │  If 401 → invalidate token, refresh, retry once    │  │   │
  │  │  │  If 429 → wait 62s, retry once                     │  │   │
  │  │  └────────────────────────────────────────────────────┘  │   │
  │  │                                                          │   │
  │  │  Returns JSON-RPC result:                                │   │
  │  │    { result: { content: [{ type: "text",                 │   │
  │  │        text: "<all sites JSON>" }] } }                   │   │
  │  └──────────────────────────────────┬───────────────────────┘   │
  │                                     │                           │
  │                                     ▼                           │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  MCP BRIDGE — COLLECT TRACE SPANS                        │   │
  │  │                                                          │   │
  │  │  After MCP server responds, bridge also:                 │   │
  │  │    GET http://mcp-server:3001/trace-spans                │   │
  │  │    → collects Datto API call spans (url, status, time)   │   │
  │  │                                                          │   │
  │  │  Bundles all spans into response:                        │   │
  │  │    _traceSpans: [                                        │   │
  │  │      { service: "auth-service", op: "introspect" },      │   │
  │  │      { service: "mcp-bridge", op: "permission_check" },  │   │
  │  │      { service: "mcp-server", op: "mcp_tool_call" },     │   │
  │  │      { service: "datto-api", op: "datto_api_call" },     │   │
  │  │    ]                                                     │   │
  │  └──────────────────────────────────┬───────────────────────┘   │
  │                                     │                           │
  │                                     ▼                           │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │  AI SERVICE — INGEST TRACE SPANS                         │   │
  │  │  File: mcpBridge.ts lines 95-98                          │   │
  │  │                                                          │   │
  │  │  trace.ingestExternalSpans(body._traceSpans)             │   │
  │  │    → INSERT INTO request_trace_spans for each span       │   │
  │  └──────────────────────────────────┬───────────────────────┘   │
  │                                     │                           │
  │                                     │ resultText                │
  └─────────────────────────────────────┘───────────────────────────┘
                                        │
                                        ▼
```

### Step 5: Tool Result → Back to Stage 1 Loop

```
AI SERVICE — TOOL RESULT HANDLING
  │
  │  resultText = <all sites JSON> (~170,000 characters)
  │  totalToolResultLength += 170000
  │
  │  Push to conversation:
  │    conversationMessages.push({
  │      role: "tool",
  │      tool_call_id: "call_abc",
  │      content: resultText       ← 170K chars sitting in memory
  │    })
  │
  │  SEC-015: Context overflow check
  │    ctxLen = sum of all message content lengths
  │    ctxLen (170K) > CONTEXT_OVERFLOW_CHARS (100K)?
  │    YES → break loop early (but damage is done — 170K already in messages)
  │
  │  ╔═══════════════════════════════════════════════════════════╗
  │  ║  ITERATION 2 (if not broken by overflow)                  ║
  │  ║                                                           ║
  │  ║  LLM receives all 170K chars of site data                 ║
  │  ║  Scans through every site to find "Rohlig"                ║
  │  ║  Extracts site UID: "abc-123"                             ║
  │  ║                                                           ║
  │  ║  LLM: call list-site-devices(siteUid: "abc-123")         ║
  │  ║                                                           ║
  │  ║  → Tool execution (same cached/live path as above)        ║
  │  ║  → Returns 20 devices (~15K chars)                        ║
  │  ║  → Push to conversationMessages                           ║
  │  ║                                                           ║
  │  ║  Total in conversationMessages:                           ║
  │  ║    170K (sites) + 15K (devices) + messages                ║
  │  ║    ≈ 190K chars                                           ║
  │  ╚═══════════════════════════════════════════════════════════╝
  │
  │  ╔═══════════════════════════════════════════════════════════╗
  │  ║  ITERATION 3                                              ║
  │  ║                                                           ║
  │  ║  LLM: "I have enough data"                                ║
  │  ║  finish_reason: "stop" (end_turn)                         ║
  │  ║  textChunk: "Based on the data..."                        ║
  │  ║                                                           ║
  │  ║  → Break out of while(true) loop                          ║
  │  ╚═══════════════════════════════════════════════════════════╝
  │
  ▼
```

### Step 6: Stage 2 — Synthesizer

```
AI SERVICE — STAGE 2
  │
  │  toolsUsed.length > 0? YES (list-sites, list-site-devices)
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  SELECT SYNTHESIZER MODEL                                │
  │  │  File: llmConfig.ts → selectSynthesizerModel()           │
  │  │                                                          │
  │  │  Priority chain (highest wins):                          │
  │  │    1. highRiskInScope? → synthesizer_high_risk (Opus)    │
  │  │    2. dataMode == "cached"? → synthesizer_cached (Haiku) │
  │  │    3. totalToolResultLength > 8000?                      │
  │  │       → synthesizer_large_data (DeepSeek R1)             │
  │  │    4. else → synthesizer_default (Haiku)                 │
  │  │                                                          │
  │  │  In this case:                                           │
  │  │    highRisk = false                                      │
  │  │    dataMode = "cached" BUT totalToolResultLength = 185K  │
  │  │    185K > 8000 → synthesizer_large_data wins             │
  │  │                                                          │
  │  │  synthModel = "deepseek/deepseek-r1"                     │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  ▸▸▸ BUG: compressForSynthesizer NOT CALLED ◂◂◂         │
  │  │                                                          │
  │  │  The function exists at chat.ts line 36:                 │
  │  │    - STAGE2_MAX_CHARS = 120,000                          │
  │  │    - TOOL_RESULT_MAX = 12,000                            │
  │  │    - Truncates tool results if total > 120K              │
  │  │                                                          │
  │  │  But it is NEVER called. The synthesizer gets            │
  │  │  raw conversationMessages with 190K chars.               │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  SYNTHESIZER CALL                                        │
  │  │  File: modelRouter.ts → synthesizeStream()               │
  │  │                                                          │
  │  │  POST http://litellm:4000/v1/chat/completions            │
  │  │  {                                                       │
  │  │    model: "deepseek/deepseek-r1",                        │
  │  │    messages: [                                           │
  │  │      { role: "system", content: synthesizerPrompt },     │
  │  │      ...conversationMessages   ← 190K chars RAW         │
  │  │    ],                                                    │
  │  │    max_tokens: 4096,                                     │
  │  │    stream: true                                          │
  │  │  }                                                       │
  │  │                                                          │
  │  │  LiteLLM → OpenRouter → DeepSeek                         │
  │  │                                                          │
  │  │  DeepSeek R1 context limit: 163,840 tokens               │
  │  │  Request size: ~175,119 tokens                           │
  │  │                                                          │
  │  │  ╔════════════════════════════════════════════════════╗  │
  │  │  ║  400 ERROR                                         ║  │
  │  │  ║  litellm.BadRequestError: OpenrouterException -    ║  │
  │  │  ║  maximum context length is 163840 tokens,          ║  │
  │  │  ║  requested 175119 tokens                           ║  │
  │  │  ╚════════════════════════════════════════════════════╝  │
  │  └─────────────────────────────────────────────────────────┘
  │
  ▼
BROWSER: Error displayed to user
```

---

## COMPLETE Proposed Flow — FIXED

Same question: **"How many devices at Rojlig?"**

### Step 1: Browser → Gateway (UNCHANGED)

```
BROWSER
  │  POST /api/chat + Bearer JWT
  ▼
API GATEWAY
  │  AUTH CHECK #1: RS256 JWT validation               ← same
  │  AUTH CHECK #2: JTI revocation check (Redis)       ← same
  │  Header injection: X-User-Id, X-Role, X-Tools     ← same
  │  Route to ai-service:6001                          ← same
  ▼
```

### Step 2: AI Service Setup (UNCHANGED)

```
AI SERVICE
  │  Read headers (userId, role, allowedTools, jwtToken)    ← same
  │  Create trace context                                    ← same
  │  Load routing config (60s cache)                         ← same
  │  Session lookup → dataMode = "cached"                    ← same
  │  Parallel: history + embed + vector search               ← same
  │  Tool filtering (Layer 1 — only user's tools)            ← same
  │  Build system prompt                                     ← same
  │  High risk check                                         ← same
  ▼
```

### Step 3: Stage 1 — Orchestrator (CHANGED: tool description)

```
AI SERVICE — STAGE 1 LOOP
  │
  │  ╔═══════════════════════════════════════════════════════════╗
  │  ║  ITERATION 1                                              ║
  │  ║                                                           ║
  │  ║  POST http://litellm:4000/v1/chat/completions             ║
  │  ║  Same model, same format, same streaming                  ║
  │  ║                                                           ║
  │  ║  BUT tool description NOW says:                           ║
  │  ║    "ALWAYS use the siteName filter when looking for       ║
  │  ║     a specific site. Supports fuzzy matching."            ║
  │  ║                                                           ║
  │  ║  LLM response:                                             ║
  │  ║    finish_reason: "tool_calls"                             ║
  │  ║    tool_calls: [{                                          ║
  │  ║      name: "list-sites",                                   ║
  │  ║      arguments: { "siteName": "rojlig" }   ← WITH FILTER  ║
  │  ║    }]                                                      ║
  │  ╚═══════════════════════════════════════════════════════════╝
  │
  ▼
```

### Step 4: Tool Execution — Cached Path (CHANGED: query logic)

```
AI SERVICE — CACHED TOOL EXECUTION
  │
  │  dataMode = "cached", not live-only → CACHED PATH
  │
  │  executeCachedTool("list-sites", { siteName: "rojlig" }, pool)
  │    → cachedListSites(db, { siteName: "rojlig" })
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  cachedListSites — NEW LOGIC                             │
  │  │                                                          │
  │  │  siteName = "rojlig" (not empty → enter filter path)     │
  │  │                                                          │
  │  │  ┌── Step 1: ILIKE substring match ───────────────────┐ │
  │  │  │  SQL:                                               │ │
  │  │  │    SELECT data, synced_at                           │ │
  │  │  │    FROM datto_cache_sites                           │ │
  │  │  │    WHERE name ILIKE '%rojlig%'                      │ │
  │  │  │    ORDER BY name LIMIT 50                           │ │
  │  │  │                                                     │ │
  │  │  │  Uses GIN trigram index for fast ILIKE              │ │
  │  │  │  Result: 0 rows (no site contains "rojlig")        │ │
  │  │  └─────────────────────────────────────────────────────┘ │
  │  │                                                          │
  │  │  0 rows → fall through to fuzzy                          │
  │  │                                                          │
  │  │  ┌── Step 2: pg_trgm fuzzy match ────────────────────┐ │
  │  │  │  SQL:                                               │ │
  │  │  │    SELECT data, synced_at,                          │ │
  │  │  │      similarity(name, 'rojlig') AS sim              │ │
  │  │  │    FROM datto_cache_sites                           │ │
  │  │  │    WHERE similarity(name, 'rojlig') > 0.2           │ │
  │  │  │    ORDER BY sim DESC                                │ │
  │  │  │    LIMIT 50                                         │ │
  │  │  │                                                     │ │
  │  │  │  pg_trgm breaks both strings into trigrams:         │ │
  │  │  │    "rojlig" → {" r","ro","oj","jl","li","ig","g "} │ │
  │  │  │    "Rohlig" → {" r","ro","oh","hl","li","ig","g "} │ │
  │  │  │    Overlap: {" r","ro","li","ig","g "} = 5 of 9    │ │
  │  │  │    similarity ≈ 0.57 > 0.2 threshold ✓             │ │
  │  │  │                                                     │ │
  │  │  │  Result: 1 row — "Rohlig" site data                │ │
  │  │  │  Size: ~2,000 characters                           │ │
  │  │  └─────────────────────────────────────────────────────┘ │
  │  │                                                          │
  │  │  Returns:                                                │
  │  │    { sites: [Rohlig data], pageDetails: {count:1,...},   │
  │  │      _fuzzyMatch: true }                                 │
  │  │    + "[Fuzzy match — no exact match for 'rojlig']"       │
  │  │                                                          │
  │  │  ▸▸▸ 2K chars instead of 170K chars ◂◂◂                 │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  conversationMessages.push({ role: "tool", content: resultText })
  │
  │  ╔═══════════════════════════════════════════════════════════╗
  │  ║  ITERATION 2                                              ║
  │  ║                                                           ║
  │  ║  LLM sees 1 site: "Rohlig" with UID "abc-123"            ║
  │  ║  No scanning needed — it's the only result               ║
  │  ║                                                           ║
  │  ║  LLM: call list-site-devices(siteUid: "abc-123")         ║
  │  ║  → Same cached/live execution as above                    ║
  │  ║  → Returns 20 devices (~15K chars)                        ║
  │  ╚═══════════════════════════════════════════════════════════╝
  │
  │  ╔═══════════════════════════════════════════════════════════╗
  │  ║  ITERATION 3                                              ║
  │  ║  LLM: finish_reason = "stop"                              ║
  │  ║  → Break loop                                             ║
  │  ║                                                           ║
  │  ║  Total in conversationMessages:                           ║
  │  ║    2K (1 site) + 15K (devices) + messages ≈ 20K chars     ║
  │  ╚═══════════════════════════════════════════════════════════╝
  │
  ▼
```

### Step 5: Stage 2 — With Compression (CHANGED: wired in)

```
AI SERVICE — STAGE 2
  │
  │  synthModel = selectSynthesizerModel(...)
  │    totalToolResultLength = 17K
  │    17K > 8000 → "deepseek/deepseek-r1"
  │    (same model selection, just less data)
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  COMPRESSION — NOW WIRED IN                              │
  │  │  File: chat.ts → compressForSynthesizer()                │
  │  │                                                          │
  │  │  totalChars = sum of all message content lengths          │
  │  │  totalChars = ~20K                                       │
  │  │  STAGE2_MAX_CHARS = 120K                                 │
  │  │                                                          │
  │  │  20K < 120K → pass through unchanged (no truncation)     │
  │  │                                                          │
  │  │  If totalChars WERE >120K (e.g. user asked for all       │
  │  │  devices across all sites):                              │
  │  │    For each tool result message:                         │
  │  │      if content.length > TOOL_RESULT_MAX (12K):          │
  │  │        truncate to 12K chars                             │
  │  │        append "[...truncated from XK chars for           │
  │  │          synthesis — full data was used in Stage 1]"     │
  │  └─────────────────────────────────────────────────────────┘
  │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  SYNTHESIZER CALL                                        │
  │  │                                                          │
  │  │  POST http://litellm:4000/v1/chat/completions            │
  │  │  {                                                       │
  │  │    model: "deepseek/deepseek-r1",                        │
  │  │    messages: compressForSynthesizer(conversationMessages),│
  │  │    max_tokens: 4096,                                     │
  │  │    stream: true                                          │
  │  │  }                                                       │
  │  │                                                          │
  │  │  LiteLLM → OpenRouter → DeepSeek                         │
  │  │                                                          │
  │  │  Request: ~20K chars ≈ ~5K tokens                        │
  │  │  Limit: 163,840 tokens                                   │
  │  │  5K << 163K ✓ ✓ ✓                                        │
  │  │                                                          │
  │  │  DeepSeek writes:                                        │
  │  │    "Rohlig has 47 devices: 42 online, 5 offline..."      │
  │  │                                                          │
  │  │  ✅ SUCCESS                                               │
  │  └─────────────────────────────────────────────────────────┘
  │
  ▼
```

### Step 6: Response → Browser (UNCHANGED)

```
AI SERVICE
  │  Stream SSE deltas to browser (writeDelta)          ← same
  │  Save messages to DB (chat_sessions, chat_messages)  ← same
  │  Insert audit_logs entries for each tool called      ← same
  │  Update trace: status = "completed"                  ← same
  ▼
BROWSER: User sees streamed answer
```

---

## All Auth Checks Summary

| # | Where | What it checks | Changed? |
|---|-------|----------------|----------|
| 1 | API Gateway | RS256 JWT signature + expiry | NO |
| 2 | API Gateway (Lua) | JTI revocation via Redis | NO |
| 3 | MCP Bridge → Auth Service | JWT introspect → DB-sourced allowed_tools (SEC-MCP-001) | NO |
| 4 | MCP Bridge | checkPermission — tool in DB allowed_tools? | NO |
| 5 | MCP Server | X-Internal-Secret header matches env var | NO |
| 6 | MCP Server | Tool name in 37 registered tools | NO |

**None of these auth checks are modified by this plan.**

---

## Cached vs Live — Complete Decision Tree

```
AI SERVICE — tool call arrives
  │
  │  dataMode?
  ├─── "cached" ──────────────────────────────────────────────────┐
  │                                                                │
  │    isLiveOnlyTool(toolName)?                                   │
  │    (get-job*, get-activity-logs, get-system-status,            │
  │     get-rate-limit, get-pagination-config)                     │
  │                                                                │
  │    ├─── YES → forced to LIVE PATH (even in cached mode)        │
  │    │         → mcpBridge.ts → MCP Bridge → Auth Service        │
  │    │           → MCP Server → Datto API                        │
  │    │                                                           │
  │    └─── NO → CACHED PATH                                       │
  │              → cachedQueries.ts → PostgreSQL (local)            │
  │              → NO network call, NO MCP bridge, NO auth check   │
  │              → Just a SQL query to datto_cache_* tables         │
  │                                                                │
  │              If cache query THROWS:                             │
  │              → Fall back to LIVE PATH automatically             │
  │                                                                │
  ├─── "live" ────────────────────────────────────────────────────┐
  │                                                                │
  │    ALL tools go through LIVE PATH:                             │
  │    ai-service                                                  │
  │      → mcpBridge.ts (HTTP POST to bridge)                      │
  │        → MCP Bridge (:4001)                                    │
  │          → AUTH: resolveAllowedTools()                          │
  │            → Is X-Internal-Secret present?                      │
  │              NO → call auth-service /auth/introspect            │
  │                → AUTH SERVICE verifies JWT, queries DB          │
  │                → returns { valid, allowed_tools }               │
  │          → checkPermission(toolName, dbAllowedTools)            │
  │            → 403 if not allowed                                 │
  │          → callMcpTool() (JSON-RPC to MCP server)               │
  │            → MCP Server (:3001)                                 │
  │              → validates X-Internal-Secret                      │
  │              → finds tool handler                               │
  │              → Token Manager gets Datto OAuth token              │
  │              → GET https://datto-api/v2/...                     │
  │              → returns result                                   │
  │            ← result + trace spans back                          │
  │          ← result + _traceSpans back                            │
  │        ← result back to ai-service                              │
  │      → ingest trace spans into DB                               │
  │    → resultText back to Stage 1 loop                            │
  │                                                                │
  └────────────────────────────────────────────────────────────────┘
```

**What we're changing:**
- In the CACHED PATH: the SQL queries inside `cachedListSites()` and `cachedListDevices()`
- In the LIVE PATH: only the tool DESCRIPTIONS in MCP server (so live-mode LLM also uses filters)
- The auth checks, routing, MCP bridge, MCP server handlers: ALL UNCHANGED

---

## What Changes Where

| File | What changes | What stays the same |
|------|-------------|---------------------|
| `db/018_fuzzy_search.sql` | **NEW**: pg_trgm extension + 3 GIN indexes | N/A |
| `ai-service/src/cachedQueries.ts` | `cachedListSites`: add ILIKE + fuzzy on siteName; `cachedListDevices`: add siteName filter | All other cached query functions, executeCachedTool routing, isLiveOnlyTool |
| `ai-service/src/tools/account.ts` | `list-sites` and `list-devices` description text | inputSchema, param names, all other tools |
| `read-only-mcp/src/tools/account.ts` | Same description text changes | handlers, API calls, all other tools |
| `ai-service/src/chat.ts` | Wire `compressForSynthesizer()` into synthesizeStream call | The function itself (already exists), Stage 1 loop, all setup |
| `ai-service/src/legacyChat.ts` | Add `compressForSynthesizer()` + wire into synthesize call | Stage 1 loop, all setup |

---

## Token Reduction

| Scenario | Before | After | Reduction |
|----------|--------|-------|-----------|
| "Devices at Rohlig" site lookup | ~170K chars (all 89 sites) | ~2K chars (1 site) | **99%** |
| Full request (both stages) | ~440K chars | ~30K chars | **93%** |
| Stage 2 worst case | 175K tokens → 400 error | 120K chars max → safe | **No overflow** |

---

## Fuzzy Match Cascade

```
User types: "rojlig"
                │
                ▼
        ┌───────────────┐
        │ Step 1: ILIKE  │
        │ '%rojlig%'     │──── match? ──► YES → return results (fast, exact)
        └───────┬───────┘
                │ NO
                ▼
        ┌───────────────────┐
        │ Step 2: pg_trgm    │
        │ similarity > 0.2   │
        │                    │
        │ "Rohlig" = 0.57 ✓  │──── match? ──► YES → return + "[Fuzzy match]" note
        │ "Rogers" = 0.15 ✗  │                  (LLM knows it's approximate)
        └───────┬────────────┘
                │ NO
                ▼
        ┌───────────────┐
        │ Step 3: Empty  │
        │ { sites: [],   │
        │   "No sites    │
        │  matching X" } │──── LLM gets explicit "not found"
        └───────────────┘     Cannot hallucinate a site that doesn't exist
```
