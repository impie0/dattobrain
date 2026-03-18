# Datto RMM AI Chat Platform — Architecture Plan

## Context

The existing `read-only-mcp` server is a TypeScript/Node.js MCP server with 37 GET-only tools for querying Datto RMM via OAuth2. It runs as a stdio subprocess and has no web-facing interface. This plan describes adding a full layered platform on top of it — a web UI, AI service, API gateway, and PostgreSQL — following a strict security-first layer model where no layer bypasses another and Datto credentials never leave the MCP server.

---

## Architectural Flow (strict — no layer may be bypassed)

```
User (browser)
 │
 ▼
API Gateway      (Apache APISIX — ONLY public entry point, port 80/443)
 ├── /*              → Web App     (Next.js — chat UI, login, history)
 ├── /api/auth/*     → Auth Service
 └── /api/chat
     /api/history    → AI Service  (Node.js — Claude API + tool loop + role filtering)
                                    │  stdio JSON-RPC
                                    ▼
                                   MCP Server  (read-only-mcp — ONLY component touching Datto)
                                    │  OAuth2 client_credentials
                                    ▼
                                   Datto RMM API

Admin (localhost only)
 │
 ▼
APISIX Dashboard (port 9000 — bound to 127.0.0.1 only)
 │  reads/writes config
 ▼
etcd             (internal-net only — config store for APISIX + Dashboard)
```

**Rules enforced by this topology:**
- Users never call Datto directly.
- The MCP server is the only component that holds `DATTO_API_KEY` / `DATTO_API_SECRET`.
- All requests pass through the API gateway.
- AI tools are filtered to the user's role before being sent to Claude.
- Every action is logged.

---

## System Components

### 1. Web App (`services/web-app/`)
**Stack:** Next.js 14 (App Router), TypeScript, TailwindCSS, shadcn/ui
**Responsibilities:**
- OAuth2/OIDC login (or local login against Auth Service)
- Chat interface — send question, stream/display AI response
- History page — view past queries and results from PostgreSQL
- Role-based UI (e.g., engineer sees script actions, viewer does not)
- Stores JWT in memory or `httpOnly` cookie (never `localStorage`)
- All API calls go to APISIX only — never directly to backend services

---

### 2. API Gateway (`services/apisix/`)
**Stack:** Apache APISIX 3.x, traditional mode backed by etcd (enables Dashboard GUI)
**Responsibilities:**
- Single public entry point — all traffic enters here on ports 80/443
- JWT validation (HS256 or RS256)
- Extract role claim from JWT → inject `X-User-Id`, `X-User-Role` headers
- RBAC: enforce which routes each role can access
- Rate limiting (especially on `/api/auth/login` to prevent brute force)
- Request/response logging to audit log (via APISIX `http-logger` plugin or file logger)
- Route traffic: `/*` → Web App, `/api/auth/*` → Auth Service, `/api/chat` + `/api/history` → AI Service
- **Never holds Datto credentials**

### 2a. APISIX Dashboard (`services/apisix/`)
**Stack:** `apache/apisix-dashboard:2.9.0`
**Purpose:** Web GUI for managing routes, upstreams, plugins, and consumers visually
- Reads/writes APISIX config from the shared etcd instance
- Exposed on host port `9000`, bound to `127.0.0.1` only (localhost admin access — not public)
- Change the default admin password in `conf.yaml` before first use
- **Never on public-net**

### 2b. etcd (`services/etcd/`)
**Stack:** `bitnamilegacy/etcd:3.5.11` (Bitnami deprecated `bitnami/etcd` in 2025; use `bitnamilegacy` namespace)
**Purpose:** Config store required by APISIX and the Dashboard when not running in standalone mode
- Both APISIX and the Dashboard connect to `http://etcd:2379`
- Not exposed to the host — `internal-net` only
- **Never holds Datto credentials or application data**

**Routes:**
| Route | Method | Auth required | Roles allowed |
|---|---|---|---|
| `/api/auth/login` | POST | No | All |
| `/api/chat` | POST | Yes (JWT) | viewer, helpdesk, engineer, admin |
| `/api/history` | GET | Yes (JWT) | viewer, helpdesk, engineer, admin |
| `/api/history/:id` | GET | Yes (JWT) | viewer, helpdesk, engineer, admin |
| `/api/admin/users` | GET/POST | Yes (JWT) | admin |

---

### 3. RBAC Authorization Model

**Roles and permissions:**

| Permission | viewer | helpdesk | engineer | admin |
|---|:---:|:---:|:---:|:---:|
| `devices.read` | ✓ | ✓ | ✓ | ✓ |
| `alerts.read` | ✓ | ✓ | ✓ | ✓ |
| `devices.password_reset` | | ✓ | ✓ | ✓ |
| `devices.run_script` | | | ✓ | ✓ |
| `devices.reboot` | | | ✓ | ✓ |
| `admin.*` | | | | ✓ |

**MCP tool → role mapping** (stored in `role_tool_permissions` table):

| MCP Tool                      | viewer | helpdesk | engineer | admin |
| ----------------------------- | :----: | :------: | :------: | :---: |
| `get-account`                 |   ✓    |    ✓     |    ✓     |   ✓   |
| `list-sites`                  |   ✓    |    ✓     |    ✓     |   ✓   |
| `list-devices`                |   ✓    |    ✓     |    ✓     |   ✓   |
| `get-device`                  |   ✓    |    ✓     |    ✓     |   ✓   |
| `list-open-alerts`            |   ✓    |    ✓     |    ✓     |   ✓   |
| `list-resolved-alerts`        |   ✓    |    ✓     |    ✓     |   ✓   |
| `get-alert`                   |   ✓    |    ✓     |    ✓     |   ✓   |
| `list-site-open-alerts`       |   ✓    |    ✓     |    ✓     |   ✓   |
| `list-site-resolved-alerts`   |   ✓    |    ✓     |    ✓     |   ✓   |
| `list-site-devices`           |   ✓    |    ✓     |    ✓     |   ✓   |
| `get-site`                    |   ✓    |    ✓     |    ✓     |   ✓   |
| `get-system-status`           |   ✓    |    ✓     |    ✓     |   ✓   |
| `get-device-by-id`            |        |    ✓     |    ✓     |   ✓   |
| `get-device-by-mac`           |        |    ✓     |    ✓     |   ✓   |
| `list-device-open-alerts`     |        |    ✓     |    ✓     |   ✓   |
| `list-device-resolved-alerts` |        |    ✓     |    ✓     |   ✓   |
| `get-device-audit`            |        |    ✓     |    ✓     |   ✓   |
| `get-device-software`         |        |    ✓     |    ✓     |   ✓   |
| `get-job`                     |        |          |    ✓     |   ✓   |
| `get-job-components`          |        |          |    ✓     |   ✓   |
| `get-job-results`             |        |          |    ✓     |   ✓   |
| `get-job-stdout`              |        |          |    ✓     |   ✓   |
| `get-job-stderr`              |        |          |    ✓     |   ✓   |
| `get-activity-logs`           |        |          |    ✓     |   ✓   |
| `get-device-audit-by-mac`     |        |          |    ✓     |   ✓   |
| `get-esxi-audit`              |        |          |    ✓     |   ✓   |
| `get-printer-audit`           |        |          |    ✓     |   ✓   |
| `get-site-settings`           |        |          |    ✓     |   ✓   |
| `list-site-variables`         |        |          |    ✓     |   ✓   |
| `list-site-filters`           |        |          |    ✓     |   ✓   |
| `list-default-filters`        |        |          |    ✓     |   ✓   |
| `list-custom-filters`         |        |          |    ✓     |   ✓   |
| `get-rate-limit`              |        |          |    ✓     |   ✓   |
| `get-pagination-config`       |        |          |    ✓     |   ✓   |
| `list-components`             |        |          |          |   ✓   |
| `list-users`                  |        |          |          |   ✓   |
| `list-account-variables`      |        |          |          |   ✓   |

---

### 4. AI Service (`services/ai-service/`)
**Stack:** Node.js 22, TypeScript, Express, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `pg`
**Responsibilities:**
- Receive user question + `X-User-Role` from APISIX
- Query `role_tool_permissions` table → build allowed tool list
- Pass **only allowed tools** as tool definitions to Claude (`claude-sonnet-4-6`)
- Run multi-turn tool_use loop:
  1. Claude returns `tool_use` block
  2. AI Service checks tool is in allowed list (defense in depth)
  3. Calls MCP server via stdio → gets result
  4. Returns `tool_result` to Claude
  5. Repeat until Claude returns `end_turn`
- Save full conversation (question, answer, tool calls, tokens) to PostgreSQL
- Return final answer to APISIX → Web App

**MCP subprocess strategy:**
The AI Service spawns the MCP server as a managed stdio child process using `StdioClientTransport` from `@modelcontextprotocol/sdk`. The MCP binary is bundled into the AI Service Docker image via multi-stage build. The `DATTO_*` env vars are injected only into this subprocess — no other service or container has them.

```typescript
// Conceptual — services/ai-service/src/mcp/client.ts
const transport = new StdioClientTransport({
  command: "node",
  args: ["/app/mcp/dist/index.js"],
  env: {
    DATTO_API_KEY: process.env.DATTO_API_KEY,
    DATTO_API_SECRET: process.env.DATTO_API_SECRET,
    DATTO_PLATFORM: process.env.DATTO_PLATFORM,
  }
});
```

---

### 5. MCP Server (`read-only-mcp/` — existing, unchanged)
**Stack:** Existing TypeScript/Node.js (no changes needed)
**Responsibilities:**
- Exposes 37 GET-only tool definitions via stdio JSON-RPC
- Manages OAuth2 `client_credentials` token lifecycle for Datto API
- Calls Datto RMM API and returns structured results
- **Only component that holds or uses Datto credentials**
- Not a network service — only reachable as a subprocess of the AI Service

---

### 6. Auth Service (`services/auth-service/`)
**Stack:** Node.js 22, TypeScript, Express, `jsonwebtoken`, `bcryptjs`, `pg`
**Responsibilities:**
- `POST /login` — validates username/password against `users` table (bcrypt), issues signed JWT with `{ sub, role, exp }`
- `GET /verify` — validates a JWT (used by APISIX's auth plugin to confirm token validity)
- Role is embedded in JWT at login; role changes require re-login
- Does NOT hold Datto credentials

---

### 7. PostgreSQL (`services/postgres/`)
**Stack:** `postgres:16-alpine`

#### Schema

```sql
-- Users
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles
CREATE TABLE roles (
    role_name   TEXT PRIMARY KEY,
    description TEXT NOT NULL
);
-- Seed: viewer, helpdesk, engineer, admin

-- Role → MCP tool permissions
CREATE TABLE role_tool_permissions (
    role       TEXT NOT NULL REFERENCES roles(role_name),
    tool_name  TEXT NOT NULL,
    PRIMARY KEY (role, tool_name)
);

-- Conversations (one per user question)
CREATE TABLE chat_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id),
    question      TEXT NOT NULL,
    answer        TEXT,
    status        TEXT NOT NULL DEFAULT 'processing',  -- processing|completed|failed
    input_tokens  INTEGER,
    output_tokens INTEGER,
    model         TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ
);

-- Individual tool calls per conversation (audit trail)
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    conversation_id UUID REFERENCES chat_history(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,      -- tool name
    parameters      JSONB NOT NULL,     -- tool input
    result_status   TEXT NOT NULL,      -- success|error
    result_summary  TEXT,               -- brief description or error message
    duration_ms     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_chat_history_user     ON chat_history(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_user       ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action     ON audit_logs(action);
```

---

### 8. Redis (`services/redis/`)
**Stack:** `redis:7-alpine`
**Purpose:**
- Session/token blacklist (for logout / token revocation)
- Rate limiting counter storage for APISIX
- Optional: cache frequently requested Datto data (e.g., site list) with short TTL

---

## Folder Structure

```
datto-chat-platform/
├── docker-compose.yml
├── .env.example                    ← template (never commit .env)
├── read-only-mcp/                  ← existing, unchanged
│   ├── src/
│   ├── Dockerfile
│   └── package.json
│
└── services/
    ├── apisix/
    │   ├── config.yaml             ← APISIX main config (etcd mode, points to etcd:2379)
    │   └── dashboard/
    │       └── conf.yaml           ← Dashboard config (etcd endpoint, admin credentials)
    │
    ├── auth-service/
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── routes/auth.ts
    │   │   └── db/queries.ts
    │   ├── Dockerfile
    │   └── package.json
    │
    ├── ai-service/
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── routes/
    │   │   │   ├── chat.ts
    │   │   │   └── history.ts
    │   │   ├── agent/
    │   │   │   ├── claude.ts       ← Anthropic API + tool loop
    │   │   │   ├── mcp-client.ts   ← StdioClientTransport wrapper
    │   │   │   └── rbac.ts         ← role → allowed tools resolver
    │   │   └── db/queries.ts
    │   ├── Dockerfile              ← multi-stage: builds MCP + ai-service
    │   └── package.json
    │
    ├── web-app/
    │   ├── src/
    │   │   ├── app/
    │   │   │   ├── login/page.tsx
    │   │   │   ├── chat/page.tsx
    │   │   │   └── history/page.tsx
    │   │   ├── components/
    │   │   │   ├── ChatWindow.tsx
    │   │   │   ├── MessageBubble.tsx
    │   │   │   └── HistoryList.tsx
    │   │   └── lib/api.ts          ← typed fetch client → APISIX only
    │   ├── nginx.conf
    │   ├── Dockerfile
    │   └── package.json
    │
    ├── postgres/
    │   └── init/
    │       ├── 001_schema.sql
    │       └── 002_seed.sql        ← roles + role_tool_permissions
    │
    └── redis/
        └── redis.conf
```

---

## Docker Compose Services

| Service | Internal Port | Exposed to host |
|---|---|---|
| `apisix` | 9080 | 80 (public), 127.0.0.1:9180 (Admin API) |
| `apisix-dashboard` | 9000 | 127.0.0.1:9000 (localhost only) |
| `etcd` | 2379 | No |
| `zipkin` | 9411 | 127.0.0.1:9411 (localhost only) |
| `web-app` | 3000 | via APISIX only |
| `auth-service` | 3001 | No |
| `ai-service` | 3002 | No |
| `postgres` | 5432 | No |
| `redis` | 6379 | No |

**Network isolation:**
- `public-net`: `apisix`, `web-app`
- `internal-net`: `apisix`, `apisix-dashboard`, `etcd`, `zipkin`, `auth-service`, `ai-service`, `postgres`, `redis`
- `etcd`, `postgres`, `redis`, and `zipkin` are on `internal-net` only — never reachable from outside Docker
- Dashboard (9000), Admin API (9180), and Zipkin (9411) are bound to `127.0.0.1` — not accessible remotely

**AI Service multi-stage Dockerfile logic:**
- Stage 1 — build `read-only-mcp/dist/` (copies MCP source, runs `npm run build`)
- Stage 2 — build `ai-service/dist/`
- Stage 3 — runtime image, copies both build outputs; MCP runs as subprocess of AI Service process, never as a standalone container

---

## Critical Existing Files (must not be broken)

| File | Why it matters |
|---|---|
| `read-only-mcp/src/index.ts` | MCP server entry point — spawned by AI Service via `StdioClientTransport` |
| `read-only-mcp/src/auth.ts` | Defines env var names `DATTO_API_KEY`, `DATTO_API_SECRET`, `DATTO_PLATFORM` — must match what AI Service injects into subprocess |
| `read-only-mcp/src/api.ts` | Defines `ToolDef` interface and all tool name strings — `role_tool_permissions` seed data must use exact same names |
| `read-only-mcp/src/tools/*.ts` | All 37 tool name constants — reference these when seeding RBAC permissions table |
| `read-only-mcp/Dockerfile` | Build recipe reused in AI Service multi-stage Dockerfile |

---

## Implementation Phases

### Phase 1 — Foundation (database + auth)
1. Write PostgreSQL schema (`001_schema.sql`) and seed data (`002_seed.sql`)
2. Build Auth Service — `POST /login` with bcrypt, JWT issuance; `GET /verify`
3. Verify: `curl POST /login` → JWT returned; decode claims show correct role

### Phase 2 — API Gateway
4. Bring up etcd + APISIX in etcd mode + Dashboard — confirm Dashboard accessible at `http://localhost:9000`
5. Use Dashboard GUI to create routes: `/*` → web-app, `/api/auth/*` → auth-service, `/api/chat` + `/api/history` → ai-service
6. Add JWT plugin to protected routes; wire JWT verification against Auth Service
7. Verify: no JWT → 401; valid JWT → forwarded with `X-User-Role` header injected

### Phase 3 — AI Service Core
7. MCP client wrapper — spawn `read-only-mcp` subprocess, call one tool, confirm response
8. RBAC resolver — query `role_tool_permissions`, return filtered tool list for role
9. Claude tool loop — send question + filtered tools, handle `tool_use` / `tool_result` turns
10. Conversation persistence — save to `chat_history` + `audit_logs` after each response

### Phase 4 — Web App
11. Login page → POST to APISIX `/api/auth/login` → store JWT in `httpOnly` cookie
12. Chat page → POST to APISIX `/api/chat` → display response
13. History page → GET `/api/history` → paginated list of past Q&A

### Phase 5 — Integration & Hardening
14. Docker Compose full stack — bring all 6 services up together
15. End-to-end test: login as `viewer` → ask question → verify only viewer tools used → result in DB
16. End-to-end test: login as `engineer` → verify additional tools accessible
17. Redis integration — rate limiting in APISIX, token blacklist on logout

---

## Security Rules (non-negotiable)

- [ ] `DATTO_API_KEY` / `DATTO_API_SECRET` exist **only** in the `ai-service` container env (passed to MCP subprocess only — no other service, no logs, no config file)
- [ ] JWT signing secret / RSA private key only in `auth-service` env
- [ ] APISIX holds only JWT public key or shared secret for **verification** — never signing
- [ ] PostgreSQL not exposed on any host port
- [ ] JWT stored in `httpOnly` cookie — never `localStorage` (XSS mitigation)
- [ ] Tool allowlist enforced **twice**: (1) only allowed tools passed to Claude; (2) runtime check before each MCP call (prompt injection defense)
- [ ] All tool calls logged to `audit_logs`: user, tool, parameters, result status, timestamp
- [ ] bcrypt work factor ≥ 12 for password hashing
- [ ] PostgreSQL, Redis, and etcd on `internal-net` only
- [ ] APISIX Dashboard port 9000 bound to `127.0.0.1` — not exposed publicly
- [ ] APISIX Dashboard default admin password changed before first use

---

## End-to-End Verification

```bash
# 1. Start full stack
docker compose up --build

# 2. Login as viewer — get JWT
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer_user","password":"secret"}'
# Expected: { "token": "eyJ..." }

# 3. Ask a question as viewer
curl -X POST http://localhost/api/chat \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"question":"How many open alerts are there?"}'
# Expected: { "conversation_id": "...", "answer": "There are 14 open alerts..." }

# 4. Confirm only viewer tools were used (check audit_logs in PostgreSQL)
# SELECT action FROM audit_logs ORDER BY created_at DESC LIMIT 10;
# → all tool names must be in viewer's allowed set

# 5. Confirm conversation was stored
curl http://localhost/api/history \
  -H "Authorization: Bearer eyJ..."
# Expected: paginated list including the question above

# 6. Confirm engineer gets more tools
# Login as engineer → ask "show me stdout for job X" → should succeed
# Login as viewer → ask same → should be refused by AI Service RBAC
```
