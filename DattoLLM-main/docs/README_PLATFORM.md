---
tags:
  - reference
  - quickstart
type: Reference
description: Quick start guide for the Datto RMM AI Chat Platform — setup, URLs, logins, and project layout
aliases:
  - Quick Start
  - README
---

# Datto RMM AI Chat Platform

> Parent: [[PLATFORM_BRAIN]] · See also: [[ARCHITECTURE]] for full technical spec

Layered platform on top of the read-only [[MCP Server]]: [[Web App]], [[AI Service]], [[API Gateway]], and [[PostgreSQL]]. Datto credentials exist only inside the [[MCP Server]] container (see [[Datto Credential Isolation]]).

## Quick start

1. Copy environment file and fill in all required values:
   ```bash
   cp .env.example .env
   ```

   **Required secrets to set:**
   - `POSTGRES_PASSWORD` — random strong password (e.g. `openssl rand -hex 32`)
   - `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` — RS256 key pair as **base64-encoded PEM** (see below)
   - `MCP_INTERNAL_SECRET` — shared secret (`openssl rand -hex 32`)
   - `OPENROUTER_API_KEY` — for LLM routing via OpenRouter
   - `LITELLM_MASTER_KEY` — must start with `sk-` (e.g. `sk-litellm-admin`)
   - `DATTO_API_KEY` / `DATTO_API_SECRET` — from Datto RMM portal
   - `EMBEDDING_API_KEY` — Voyage or OpenAI key

   **Generating JWT keys (base64-encoded PEM):**
   ```bash
   openssl genrsa -out private.pem 2048
   openssl rsa -in private.pem -pubout -out public.pem
   # Encode for .env:
   base64 -w 0 private.pem   # → JWT_PRIVATE_KEY value
   base64 -w 0 public.pem    # → JWT_PUBLIC_KEY value
   ```

   > **Important:** JWT keys must be stored as base64-encoded PEM in `.env` (the entire PEM file, base64'd as a single line). The auth service detects the format: if the value starts with `-----` it is treated as raw PEM; otherwise it is base64-decoded. Raw PEM with literal `\n` characters does NOT work correctly.

2. **Update `services/pgbouncer/pgbouncer.ini`** — the `password=` value in the `[databases]` section must match `POSTGRES_PASSWORD` in `.env`. On a fresh deploy the password is random, so pgbouncer will fail to connect until this is updated:
   ```ini
   [databases]
   datto_rmm = host=postgres port=5432 dbname=datto_rmm user=postgres password=<YOUR_POSTGRES_PASSWORD>
   litellm   = host=postgres port=5432 dbname=litellm   user=postgres password=<YOUR_POSTGRES_PASSWORD>
   ```

3. Start the stack:
   ```bash
   docker compose up --build
   ```

4. **Configure APISIX routes** — APISIX routes are not persisted in the repo. After every fresh spin-up, run:
   ```bash
   ./setup-apisix.sh
   ```
   This creates all upstreams, the JWT consumer (RS256), and all 12 routes. Re-running is safe (idempotent).

5. Open **http://localhost** in your browser. Log in with one of the seed users.

> **After any `.env` change:** Use `docker compose up -d <service>` — NOT `docker compose restart <service>`. The `restart` command does not reload environment variables.

## URLs and logins

### URLs (after `docker compose up`)

| URL | Description |
|-----|-------------|
| **http://localhost** | Web app (login, chat, history) — all traffic goes through APISIX |
| **http://localhost/login** | Login page |
| **http://localhost/chat** | Chat page (requires login) |
| **http://localhost/history** | Chat history (requires login) |
| **http://localhost/api/auth/login** | Auth API — POST with `{"username","password"}` |
| **http://localhost/api/chat** | Chat API — POST with JWT + `{"question"}` |
| **http://localhost/api/history** | History API — GET with JWT |

### Logins (default password: `secret`)

| Username | Password | Role |
|----------|----------|------|
| `readonly_user` | `secret` | readonly — sites, system status, rate limit |
| `helpdesk_user` | `secret` | helpdesk — + devices, alerts |
| `analyst_user` | `secret` | analyst — + jobs, activity logs, site settings |
| `admin_user` | `secret` | admin — full access, all 37 tools |

Routes, consumers, and upstreams are configured via `./setup-apisix.sh` which pushes them to APISIX's Admin API (stored in etcd). They are **not** persisted in the repo — run the script after every fresh `docker compose up`.

### Test without connecting (see the calls)

Run with **no Datto and no Anthropic** and still see every call:

1. In `.env` set:
   - `MOCK_MCP=true` — use fake MCP (no Datto).
   - `MOCK_CLAUDE=true` or leave `ANTHROPIC_API_KEY` empty — no Claude API; one demo tool is called and the answer shows the result.
   - `LOG_CALLS=1` (default) — log `[CHAT]` and `[MCP]` to the ai-service console.

2. Start the stack and log in. Send a message from **Chat**. Then open **http://localhost/trace** (or click **Trace** in the header).

3. On the **Trace** page you see the last 20 chat requests: question, role, allowed tools, each MCP tool call (name, args, result snippet, duration), and the answer.

4. To see logs in the terminal: `docker compose logs -f ai-service`.

## Architecture

- **[[Web App]]** (Next.js) → login, chat, history, admin panel; all API calls go to APISIX.
- **[[API Gateway|APISIX]]** → JWT validation (RS256), injects `X-User-Id` / `X-User-Role` / `X-Allowed-Tools`, routes to auth and AI service. Routes configured via `setup-apisix.sh`.
- **[[Auth Service]]** → POST `/api/auth/login`; issues RS256 JWT with `sub`, `role`, `allowed_tools`. Also handles refresh tokens and token introspect.
- **[[AI Service]]** → POST `/api/chat`, GET `/api/history`; two-stage LLM pipeline (orchestrator + synthesizer via LiteLLM), RBAC-filtered tools, MCP tool loop, persists to [[PostgreSQL]].
- **[[MCP Bridge]]** → Permission gate between AI service and MCP server. Independently verifies `allowed_tools` by calling auth-service introspect (SEC-MCP-001).
- **[[MCP Server]]** → Standalone container; the **only** component with `DATTO_*` env vars. 37 read-only tools over HTTP.
- **LiteLLM** → Internal LLM proxy routing Claude/DeepSeek/Gemini. All LLM calls from AI service go through here.
- **PgBouncer** → Connection pooler (session mode) in front of [[PostgreSQL]]. Required for advisory locks in sync pipeline.
- **[[PostgreSQL]]** → users, roles, tool_permissions, chat_sessions, chat_messages (with embeddings), audit_logs, Datto cache tables.
- **Redis** → [[JWT Model|JWT]] revocation set (`revoked_jtis:<jti>`), JTI tracking per user, rate-limit counters.
- **[[Embedding Service]]** → Text → vector (Voyage-3 1024 dims). Used for semantic memory search.
- **CVE Scanner** → Local NVD mirror. Downloads CVE feeds, indexes them, matches against device software with version filtering. Dashboard at `/admin/explorer/vulnerabilities`.

See [[ARCHITECTURE]] for the full technical spec including security model and deployment notes.

## Verify

```bash
# Login
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"readonly_user","password":"secret"}'
# → { "token": "eyJ..." }

# Chat (use token from above)
curl -X POST http://localhost/api/chat \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"question":"How many sites are there?"}'
```

## Project layout

- `read-only-mcp/` — MCP server, 37 read-only Datto tools.
- `auth-service/` — login, RS256 JWT issuance, refresh tokens, introspect.
- `ai-service/` — two-stage LLM pipeline, MCP bridge client, RBAC, sync, observability.
- `mcp-bridge/` — permission gate between AI service and MCP server (SEC-MCP-001).
- `embedding-service/` — text → vector embeddings (Voyage or OpenAI).
- `services/web-app/` — Next.js UI: login, chat, history, admin panel.
- `services/apisix/` — `config.yaml` (APISIX bootstrap). Routes/upstreams are pushed via `setup-apisix.sh`.
- `services/pgbouncer/` — `pgbouncer.ini` (connection pooler config — **password must match `.env`**).
- `services/litellm/` — `config.yaml` (LLM provider routing).
- `services/redis/` — `redis.conf`.
- `db/` — SQL migrations (`001_extensions.sql` → `018_fuzzy_search.sql`) and `seed.sql`.
- `setup-apisix.sh` — configures all APISIX routes, upstreams, and JWT consumer after stack startup.

See [[ARCHITECTURE]] for full technical spec and [[DATABASE]] for schema reference.

---

## Related Nodes

[[PLATFORM_BRAIN]] · [[ARCHITECTURE]] · [[DATABASE]] · [[SECURITY_FINDINGS]] · [[ROADMAP]]
