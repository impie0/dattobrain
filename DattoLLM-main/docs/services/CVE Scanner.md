---
tags:
  - platform/service
  - security
  - cve
aliases:
  - cve-scanner
  - vulnerability-scanner
type: Service
description: Local NVD-based CVE vulnerability scanner — downloads CVE feeds, indexes in PostgreSQL, matches against device software inventory
---

# CVE Scanner

> Part of the [[Datto RMM AI Platform|PLATFORM_BRAIN]] knowledge graph · **Service** node

**Purpose:** Local NVD-based CVE vulnerability scanner. Downloads CVE feeds from FKIE, indexes 194K CVEs + 1M CPE entries in PostgreSQL, matches against device software inventory with version range filtering. 99.7% accuracy on top 50 products.

## Architecture

```
cve-scanner container
  → Download NVD JSON feeds from FKIE (daily)
  → Parse + index CVEs into PostgreSQL
    → cve_database (194K entries)
    → cpe_dictionary (1M entries)
  → Match against datto_cache_device_software
    → device_vulnerabilities (results)
    → cve_sync_log (run history)
```

## Source Files

| File | Role |
|---|---|
| `cve-scanner/index.ts` | Entry point + scheduler |
| `cve-scanner/nvdFetcher.ts` | FKIE NVD feed download |
| `cve-scanner/cveIndexer.ts` | Parse + index CVE/CPE data into PostgreSQL |
| `cve-scanner/matcher.ts` | Fuzzy match + version range filtering |
| `cve-scanner/db.ts` | Database connection + query helpers |
| `cve-scanner/log.ts` | Structured logging |

## Matching Algorithm

1. **PRODUCT_MAP direct mapping** — known software names mapped to NVD vendor/product pairs
2. **Vendor extraction** — heuristic extraction of vendor from software name
3. **Fuzzy matching** — fallback for unrecognized software names
4. **Version filtering** — range checks against CPE version constraints (versionStartIncluding, versionEndExcluding, etc.)
5. **Wildcard blocklist** — M365/Office products excluded from wildcard version matches to avoid false positives

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `NVD_CACHE_DIR` | `/data/nvd-cache` | Local cache for downloaded NVD JSON feeds (~500MB) |
| `SCAN_CRON` | `0 4 * * *` | Cron schedule for daily scan (default: 4 AM) |
| `MIN_CONFIDENCE` | `0.7` | Minimum confidence threshold for fuzzy matches |

## Docker

- **Image:** built from `./cve-scanner`
- **Port:** `8500` (HTTP health + API)
- **Volume:** `cve_cache` → `NVD_CACHE_DIR`
- **Network:** `internal` only

## Database Tables

| Table | Purpose |
|---|---|
| `cve_database` | Indexed CVE entries from NVD (CVE ID, description, severity, CVSS scores) |
| `cpe_dictionary` | CPE entries linked to CVEs (vendor, product, version ranges) |
| `device_vulnerabilities` | Match results — device software ↔ CVE matches with confidence scores |
| `cve_sync_log` | Sync run history — timestamps, counts, errors |

**Migration:** `db/022_cve_scanner.sql`

**Views:** Aggregated vulnerability summaries for the admin dashboard.

## Validation

- **99.7% accuracy** on top 50 products by install count
- **97.7% accuracy** on top 62 products
- Validated against manual CVE lookups for each product

## Known Limitations

- **M365 wildcard matching** — Microsoft 365 / Office products use wildcard version entries in NVD that cause false positives; blocked via explicit blocklist
- **NVD feed lag** — FKIE mirrors may lag behind official NVD by up to 24 hours
- **Adobe version schemes** — Adobe uses non-standard version numbering that causes edge cases in version range filtering

## Key Dependencies

- [[PostgreSQL]] — stores all CVE data, CPE dictionary, and match results
- [[AI Service]] — vulnerability data available for AI queries
- [[Web App]] — admin vulnerability dashboard at `/admin/explorer/vulnerabilities`

## Related Nodes

[[PostgreSQL]] · [[AI Service]] · [[Web App]] · [[Network Isolation]]
