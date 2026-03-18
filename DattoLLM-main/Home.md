---
tags:
  - home
  - index
type: Index
description: Datto RMM AI Platform — vault home and navigation index
aliases:
  - Index
  - Dashboard
---

# Datto RMM AI Platform

> [!tip] Navigation
> Use the graph view or [[Architecture]] canvas to visually explore the platform. Click any `[[link]]` to jump to that node.

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

## Execution Flows

- [[Authentication Flow]] — Login → JWT with baked-in tool permissions
- [[Chat Request Flow]] — Question → orchestrator → tools → synthesizer → answer
- [[Tool Execution Flow]] — Three-layer permission enforcement

## Code Modules

[[Prompt Builder]] · [[Tool Router]] · [[RBAC System]] · [[Token Manager]]

## Security Model

[[JWT Model]] · [[Network Isolation]] · [[Datto Credential Isolation]]

## Database

[[PostgreSQL]] · [[Users Table]] · [[Roles Table]] · [[Tool Permissions Table]] · [[Chat Messages Table]]

## Views

- [[Platform Overview]] — All nodes by type
- [[Security Overview]] — Security nodes

## Reference Docs

- [[ARCHITECTURE]] — Full technical spec with diagrams
- [[DATABASE]] — Every table, column, index, FK documented
- [[PLATFORM_PLAN]] — Original platform design plan
- [[README_PLATFORM]] — Quick start guide
- [[ROADMAP]] — Implementation roadmap, phases, and architectural decisions
- [[SECURITY_FINDINGS]] — Security review findings and remediation status
- [[Write Tool State Machine]] — Full spec for action staging, approval flow, DB schema, and SSE events
