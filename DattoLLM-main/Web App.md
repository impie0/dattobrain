# Web App

> Part of the [[Datto RMM AI Platform|claude]] knowledge graph · **Service** node

**Purpose:** Next.js frontend. Serves the browser UI — chat interface, history, admin panel, approvals.

**Build:** `./services/web-app`
**Port:** `3000` (internal, behind [[API Gateway]])
**Key env vars:** `NEXT_PUBLIC_API_URL` (empty = same-origin)

## Pages

| Route | Purpose |
|---|---|
| `/login` | Login form → `POST /api/auth/login` |
| `/chat` | Main chat + history sidebar + tools panel |
| `/history` | Conversation list |
| `/history/[id]` | Conversation detail |
| `/trace` | Debug: last 20 chats with tool calls |
| `/approvals` | User approval requests |
| `/admin/users` | User CRUD + tool assignment |
| `/admin/roles` | Role management |
| `/admin/tools` | Tool policies (risk level, approval required) |
| `/admin/approvals` | Admin approval queue |

## API Client

`src/lib/api.ts` — all fetch calls, Bearer token from `document.cookie` (`token=...`)

## Related Nodes

[[API Gateway]] · [[Auth Service]] · [[AI Service]] · [[Authentication Flow]]
