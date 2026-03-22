---
tags:
  - platform/feature
  - admin
  - data-browser
type: Feature
aliases:
  - Data Browser
  - Admin Explorer
description: Admin-only browser UI for navigating the local Datto RMM cache without LLM involvement
---

# Data Explorer

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Feature** node

**Purpose:** Admin-only browser UI for navigating the local Datto RMM cache without LLM involvement. Provides fast, direct SQL access to sites, devices, audits, software, alerts, and variables.

**Backend:** `ai-service/src/dataBrowser.ts`

## Routes

All routes use `adminOnly` middleware (enforced by [[RBAC System]]).

| Route | Handler | Returns |
|---|---|---|
| `GET /api/admin/browser/overview` | `handleBrowserOverview` | Stats counts + top 10 sites + last sync |
| `GET /api/admin/browser/sites` | `handleBrowserSites` | Paginated + searchable site list |
| `GET /api/admin/browser/sites/:uid` | `handleBrowserSite` | Site + devices + open alerts + variables |
| `GET /api/admin/browser/devices` | `handleBrowserDevices` | Paginated + filtered device list |
| `GET /api/admin/browser/devices/:uid` | `handleBrowserDevice` | Device + audit (hardware/ESXi/printer) + alerts |
| `GET /api/admin/browser/devices/:uid/software` | `handleBrowserDeviceSoftware` | Paginated + searchable software |
| `GET /api/admin/browser/alerts` | `handleBrowserAlerts` | Paginated + filtered alerts |

**Frontend pages:** `/admin/explorer/` subtree (see [[Web App]] pages table)

## Design

> [!success] Zero external dependencies
> Pure read-only SQL against [[PostgreSQL]] cache tables — no MCP calls, no Datto API dependency, instant results even when Datto is unreachable.

All queries join against `datto_cache_*` tables.

## Related Nodes

[[AI Service]] · [[Local Data Cache]] · [[Web App]] · [[RBAC System]] · [[PostgreSQL]] · [[API Gateway]] · [[Observability Dashboard]]
