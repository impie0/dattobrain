# Datto RMM AI Chat Platform

Layered platform on top of the read-only MCP server: Web UI, AI service, API gateway, and PostgreSQL. Datto credentials exist only inside the MCP subprocess spawned by the AI service.

## Quick start

1. Copy environment file and set secrets:
   ```bash
   cp .env.example .env
   # Edit .env: set JWT_SECRET, DATTO_API_KEY, DATTO_API_SECRET, ANTHROPIC_API_KEY
   ```

2. Seed users (in `.env` set `RUN_SEED=true` for first run):
   - Usernames: `readonly_user`, `helpdesk_user`, `analyst_user`, `admin_user`
   - Password: `secret` (or `SEED_PASSWORD`)

3. Start the stack:
   ```bash
   docker compose up --build
   ```

4. Open **http://localhost** (via APISIX). Log in with one of the seed users.

5. After first successful login, set `RUN_SEED=false` in `.env` to avoid overwriting passwords.

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

Routes, consumers, and upstreams are defined in `services/apisix/apisix.yaml` (APISIX reloads this file automatically; no GUI dashboard in standalone mode).

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

- **Web App** (Next.js) → login, chat, history; all API calls go to APISIX.
- **APISIX** → JWT validation, injects `X-User-Id` / `X-User-Role`, routes to auth and AI service.
- **Auth Service** → POST `/api/auth/login`, GET `/api/auth/verify`; issues JWT with `key`, `sub`, `role`.
- **AI Service** → POST `/api/chat`, GET `/api/history`; RBAC-filtered tools, Claude + MCP tool loop, persists to PostgreSQL.
- **MCP Server** → Spawned as subprocess by AI service; only component that holds `DATTO_*` env vars.
- **PostgreSQL** → users, roles, role_tool_permissions, chat_history, audit_logs.
- **Redis** → reserved for rate limiting / token blacklist (optional).

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

- `read-only-mcp/` — existing MCP server (unchanged).
- `services/postgres/init/` — schema and seed (roles, role_tool_permissions; users created by auth-service seed).
- `services/auth-service/` — login, JWT, verify.
- `services/apisix/` — config.yaml, apisix.yaml (routes, JWT, upstreams).
- `services/ai-service/` — MCP client, RBAC, Claude loop, chat/history API.
- `services/web-app/` — Next.js login, chat, history.
- `services/redis/` — redis.conf.

See `PLATFORM_PLAN.md` for full architecture and security rules.
