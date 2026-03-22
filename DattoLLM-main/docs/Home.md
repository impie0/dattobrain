---
tags:
  - home
  - index
type: Index
description: Datto RMM AI Platform — vault home and navigation index
aliases:
  - Index
  - Dashboard
  - DattoLLM
---

# Datto RMM AI Platform

> [!tip] How to navigate this vault
> Use the **graph view** or the [[Architecture]] canvas to visually explore the platform. Click any `[[wikilink]]` to jump to that node.
> - **New here?** Start with [[PLATFORM_BRAIN]] for the full system reference.
> - **Setting up?** See [[README_PLATFORM]] for the quick-start guide.
> - **Security review?** See [[SECURITY_FINDINGS]] for all findings and their status.

---

## Quick Links

| | |
|---|---|
| [[PLATFORM_BRAIN]] | System map, all services, security, deployment, LLM routing |
| [[ARCHITECTURE]] | Full technical spec with diagrams and code examples |
| [[SECURITY_FINDINGS]] | Security review — severity-ranked findings and status |
| [[Chat Request Flow]] | End-to-end trace of a user question through the system |
| [[ROADMAP]] | Implementation phases, gates, and architecture decisions |

---

## Platform Map

![[Architecture.canvas]]

## Services

| Service | Purpose |
|---|---|
| [[API Gateway]] | Single public entry point — JWT validation, routing, rate limits |
| [[Auth Service]] | RS256 JWT issuance, RBAC, refresh tokens |
| [[AI Service]] | Two-stage LLM pipeline, tool routing, vector search |
| [[Web App]] | Next.js UI — chat, history, admin panel |
| [[MCP Bridge]] | Permission gate between AI Service and MCP Server |
| [[MCP Server]] | Only container with Datto credentials — 37 read-only tools |
| [[Embedding Service]] | Text → vector embeddings (Voyage-3, 1024 dims) |
| [[Voice Gateway]] | Phone interface — Asterisk PBX, Whisper STT, ElevenLabs TTS |
| [[CVE Scanner]] | NVD-based CVE vulnerability scanner for device software inventory |

## Execution Flows

- [[Authentication Flow]] — Login → JWT with baked-in tool permissions
- [[Chat Request Flow]] — Question → orchestrator → tools → synthesizer → answer
- [[Tool Execution Flow]] — Four-layer permission enforcement

## Code Modules

[[Prompt Builder]] · [[Tool Router]] · [[RBAC System]] · [[Token Manager]] · [[Write Tool State Machine]]

## Features

- [[Data Explorer]] — Admin browser for cached Datto data (sites, devices, alerts)
- [[Observability Dashboard]] — System health, LLM usage, tool call patterns, cache status
- [[CVE Scanner]] — NVD-based vulnerability scanner matching CVEs against device software inventory
- [[ActionProposal]] — Write tool staging and user confirmation flow

## Security Model

[[JWT Model]] · [[Network Isolation]] · [[Datto Credential Isolation]] · [[SECURITY_FINDINGS]]

## Database

[[PostgreSQL]] · [[DATABASE]] (full schema) · [[Users Table]] · [[Roles Table]] · [[Tool Permissions Table]] · [[Chat Messages Table]]

## Deep Dives

| Topic | File |
|-------|------|
| Cache sync pipeline | [[local-data]] |
| LLM routing + models | [[local-llm]] |
| Write tool state machine | [[Write Tool State Machine]] |
| Voice gateway setup | `voice/README.md` |

## Reference Docs

- [[PLATFORM_BRAIN]] — **Platform brain** — system map, all services, security, deployment, LLM routing (start here)
- [[ARCHITECTURE]] — Full technical spec with diagrams and code examples
- [[DATABASE]] — Every table, column, index, FK documented
- [[README_PLATFORM]] — Quick start guide

## Planning / Historical

- [[ROADMAP]] — Implementation phases, gates, and architectural decisions
- [[PLATFORM_PLAN]] — Original architecture design (historical)
- [[FUZZY-SEARCH-PLAN]] — Fuzzy search design decisions (historical)
- [[SEC-CACHE-001-PLAN]] — Permission gate design decisions (historical)
- [[SECURITY_FINDINGS]] — Security review findings and remediation status

## Service Connections

Detailed interface docs for each service-to-service call:

[[connections/Browser to Gateway|Browser → Gateway]] · [[connections/Gateway to Auth|Gateway → Auth]] · [[connections/Gateway to AI|Gateway → AI]] · [[connections/Gateway to WebApp|Gateway → WebApp]] · [[connections/AI to MCP Bridge|AI → MCP Bridge]] · [[connections/AI to Embedding|AI → Embedding]] · [[connections/AI to PostgreSQL|AI → PostgreSQL]] · [[connections/Auth to PostgreSQL|Auth → PostgreSQL]] · [[connections/MCP Bridge to MCP Server|MCP Bridge → MCP Server]] · [[connections/MCP Server to Datto|MCP Server → Datto]]

---

## Vault Structure

```
docs/
├── Home.md                  ← You are here
├── PLATFORM_BRAIN.md        ← Full system reference
├── ARCHITECTURE.md          ← Technical spec
├── DATABASE.md              ← Schema reference
├── README_PLATFORM.md       ← Quick start guide
├── services/                ← One node per service
├── flows/                   ← Execution flow traces
├── modules/                 ← Code module docs
├── database/                ← Table-level docs
├── security/                ← Security model nodes
├── connections/             ← Service-to-service interfaces
├── deep-dives/              ← Detailed topic analyses
└── planning/                ← Design history & roadmap
```
