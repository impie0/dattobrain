---
tags:
  - platform/service
  - frontend
  - nextjs
aliases:
  - web-app
  - frontend
  - webapp
type: Service
description: Next.js frontend serving chat, history, approvals, and admin panel — deployed on the public Docker network
---

# Web App

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Next.js frontend. Serves the browser UI — chat interface, history, admin panel, approvals.

> [!info] Service Details
> **Build:** `./services/web-app`
> **Port:** `3000`
> **Networks:** `public` (same network as [[API Gateway]] — NOT on `internal` network)
> **Key env vars:** `NEXT_PUBLIC_API_URL` (empty = same-origin)

> [!note] Network placement
> The web-app container is on the `public` Docker network alongside the [[API Gateway]]. It is **not** on the `internal` bridge network. All external requests still flow through [[API Gateway]] on port 80.

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
| `/admin/llm-config` | LLM routing config — model per slot, data mode default |
| `/admin/llm-logs` | LLM request logs — orchestrator/synthesizer model badges, tools called |
| `/admin/data-sync` | Data sync status, record counts, manual sync trigger |
| `/admin/explorer` | Data Explorer overview — stats, top sites, last sync |
| `/admin/explorer/sites` | Searchable/paginated sites list |
| `/admin/explorer/sites/[uid]` | Site detail — Devices, Open Alerts, Variables tabs |
| `/admin/explorer/devices` | Filtered/paginated devices list |
| `/admin/explorer/devices/[uid]` | Device detail — Overview, Hardware Audit, Software, Alerts tabs |
| `/admin/explorer/alerts` | Alerts browser — open/resolved toggle, priority filter |
| `/admin/observability` | [[Observability Dashboard]] overview — metric cards, 24h charts, drill-down links |
| `/admin/observability/llm` | LLM/Tokens — token chart, model breakdown, last 100 requests |
| `/admin/observability/tools` | Tool Calls — usage frequency, error rates, last 100 events |
| `/admin/observability/mcp` | MCP Server — bridge health, denied calls, error timeline |
| `/admin/observability/chat` | Chat/Usage — message volume, active sessions table |
| `/admin/observability/cache` | Cache — sync history, record counts, cached/live ratio |

## API Client

`src/lib/api.ts` — all fetch calls, Bearer token from `document.cookie` (`token=...`)

## Connections

- [[connections/Browser to Gateway|Browser → Gateway]] — all requests go through APISIX
- [[connections/Gateway to WebApp|Gateway → WebApp]] — `/*` catch-all proxy

## Related Nodes

[[API Gateway]] · [[Auth Service]] · [[AI Service]] · [[Authentication Flow]] · [[Observability Dashboard]] · [[Data Explorer]] · [[ActionProposal]] · [[RBAC System]] · [[Chat Request Flow]] · [[Network Isolation]] · [[JWT Model]]
