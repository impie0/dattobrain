---
tags:
  - platform/security
  - write-tools
  - action-staging
type: Security
aliases:
  - Action Proposal
  - Write Tool Staging
description: Write tool staging and confirmation flow — LLM proposals require user approval before execution
---

# ActionProposal

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Security** node

> [!warning] Security invariant
> The LLM can ==never execute a write operation directly==. Every write must be staged as an `ActionProposal` and confirmed by the user before execution.

**Purpose:** Write tool staging and confirmation flow. The LLM can never execute a write operation directly. Instead it stages an `ActionProposal` which the user must confirm before the platform executes it.

**Source file:** `ai-service/src/actionProposals.ts` (in [[AI Service]])
**Migration:** `db/015_action_proposals.sql` (in [[PostgreSQL]])

## State Machine

```
pending  → confirmed (user confirms within 15 min window)
pending  → rejected  (user rejects)
pending  → expired   (15 min TTL — checked on read, never updated)
confirmed → executed (system executes the write tool)
confirmed → rejected (user changes mind before execution starts)
```

## API Routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/proposals` | List user's pending proposals |
| `POST` | `/api/proposals` | Stage a new proposal (called by chat pipeline) |
| `POST` | `/api/proposals/:id/confirm` | User confirms a proposal |
| `POST` | `/api/proposals/:id/reject` | User rejects a proposal |
| `POST` | `/api/proposals/:id/execute` | Execute a confirmed proposal (admin/internal only) |

## SEC-Write-004 — Parameter Masking

Sensitive fields (passwords, API keys, secrets) are replaced with `***` in `tool_args_masked` before the proposal is stored. The unmasked args are never persisted in the DB.

## Current Status

> [!info] Pre-implementation infrastructure
> No write tools exist yet. This infrastructure is in place so the pattern is established before the first write tool is added.

The chat pipeline will be updated to produce proposals instead of executing write tools when write tools arrive. See [[Write Tool State Machine]] for the full two-phase execution spec.

## Related Nodes

[[MCP Bridge]] · [[Datto Credential Isolation]] · [[RBAC System]] · [[AI Service]] · [[Write Tool State Machine]] · [[Tool Router]] · [[Chat Request Flow]] · [[PostgreSQL]] · [[Tool Execution Flow]] · [[JWT Model]]
