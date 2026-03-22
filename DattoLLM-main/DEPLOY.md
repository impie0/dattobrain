# DattoLLM — Fresh Deploy Guide

> Follow this exactly. Every step has been tested. Skipping steps causes hours of debugging.

---

## Prerequisites

- Docker Desktop (Mac/Windows) or Docker Engine (Linux)
- `openssl` (for JWT key generation)
- `python3` or `node` (for setup-apisix.sh)
- API keys: OpenRouter, Voyage (or OpenAI for embeddings)
- Optional: Datto RMM API credentials, OpenAI (voice STT), ElevenLabs (voice TTS)

---

## Step 1: Generate .env

```bash
cd DattoLLM-main
cp .env.example .env
```

Now fill in the required values. The sections below tell you exactly what to put.

### 1a. PostgreSQL password

Generate a strong random password:

```bash
openssl rand -hex 32
```

Put it in `.env`:
```
POSTGRES_PASSWORD=<paste the hex string>
```

### 1b. Update PgBouncer to match

> This is the #1 cause of "everything starts but nothing works." PgBouncer has a hardcoded password that MUST match.

Open `services/pgbouncer/pgbouncer.ini` and replace the password on both lines:

```ini
[databases]
datto_rmm = host=postgres port=5432 dbname=datto_rmm user=postgres password=<SAME PASSWORD FROM STEP 1a>
litellm   = host=postgres port=5432 dbname=litellm   user=postgres password=<SAME PASSWORD FROM STEP 1a>
```

### 1c. Generate JWT keys

```bash
# Generate RSA key pair
openssl genrsa -out /tmp/private.pem 2048
openssl rsa -in /tmp/private.pem -pubout -out /tmp/public.pem

# Base64 encode (MUST be single line, no wrapping)
# Linux:
JWT_PRIVATE_KEY=$(base64 -w 0 /tmp/private.pem)
JWT_PUBLIC_KEY=$(base64 -w 0 /tmp/public.pem)

# macOS:
JWT_PRIVATE_KEY=$(base64 -i /tmp/private.pem)
JWT_PUBLIC_KEY=$(base64 -i /tmp/public.pem)

# Print them to paste into .env
echo "JWT_PRIVATE_KEY=$JWT_PRIVATE_KEY"
echo "JWT_PUBLIC_KEY=$JWT_PUBLIC_KEY"
```

Paste both into `.env`. They must be **single-line base64** — no newlines, no `-----BEGIN` prefix.

> **Common mistake:** Using `cat private.pem` (raw PEM with `\n`) instead of base64 encoding. The auth service detects raw PEM by checking for `-----` prefix, but literal `\n` characters (not actual newlines) will break token verification silently — you'll get 401s with no useful error message.

### 1d. LiteLLM master key

```bash
echo "LITELLM_MASTER_KEY=sk-$(openssl rand -hex 16)"
```

Paste into `.env`. **Must start with `sk-`** or LiteLLM won't start.

### 1e. MCP internal secret

```bash
echo "MCP_INTERNAL_SECRET=$(openssl rand -hex 32)"
```

Paste into `.env`. Used between mcp-bridge and mcp-server — must be the same value.

### 1f. OpenRouter API key

Get a key from https://openrouter.ai — this routes all LLM calls (Claude, DeepSeek, Gemini).

```
OPENROUTER_API_KEY=sk-or-...
```

### 1g. Embedding API key

Get a key from https://dash.voyageai.com (default provider) or https://platform.openai.com

```
EMBEDDING_PROVIDER=voyage
EMBEDDING_API_KEY=pa-...
```

### 1h. Datto RMM credentials (optional)

If you have Datto RMM access:

```
DATTO_API_KEY=<from Datto portal: Setup → API>
DATTO_API_SECRET=<from Datto portal>
DATTO_PLATFORM=merlot
```

If you don't have these, MCP tools will fail but the rest of the platform works (chat, auth, admin panel).

### 1i. Voice (optional)

Only needed if using the voice/phone gateway:

```
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
EXTERNAL_IP=<your server's LAN IP>
VOICE_SERVICE_USERNAME=voice-service
VOICE_SERVICE_PASSWORD=<password for voice service account>
DRACHTIO_SECRET=cymru
ASTERISK_AI_PASSWORD=voiceai123
FREESWITCH_SECRET=JambonzR0ck$
```

> `ASTERISK_AI_PASSWORD` must match the passwords in `services/asterisk/pjsip.conf`. If you change one, change both.

> Voice requires a **Linux host** — Docker Desktop Mac can't forward UDP (RTP audio). See `voice/README.md`.

> After starting, create a voice service user in the admin panel (`/admin/users`) and add a device mapping:
> ```sql
> INSERT INTO voice_device_mappings (sip_extension, user_id, device_name, is_active)
> VALUES ('9000', (SELECT id FROM users WHERE username = 'voice-service'), 'Main Voice Line', true);
> ```

---

## Step 2: Verify .env

Or use the automated validator:

```bash
./preflight.sh
```

This checks everything below automatically. If it passes, skip to Step 3.

Run this before starting anything:

```bash
# Check all critical vars are set
for var in POSTGRES_PASSWORD JWT_PRIVATE_KEY JWT_PUBLIC_KEY MCP_INTERNAL_SECRET OPENROUTER_API_KEY EMBEDDING_API_KEY LITELLM_MASTER_KEY; do
  val=$(grep "^${var}=" .env | cut -d= -f2-)
  if [ -z "$val" ]; then
    echo "MISSING: $var"
  else
    echo "OK: $var"
  fi
done

# Verify LITELLM_MASTER_KEY starts with sk-
KEY=$(grep "^LITELLM_MASTER_KEY=" .env | cut -d= -f2-)
if [[ "$KEY" != sk-* ]]; then
  echo "ERROR: LITELLM_MASTER_KEY must start with sk-"
fi

# Verify JWT keys are base64 (not raw PEM)
for var in JWT_PRIVATE_KEY JWT_PUBLIC_KEY; do
  val=$(grep "^${var}=" .env | cut -d= -f2-)
  if [[ "$val" == -----* ]]; then
    echo "ERROR: $var looks like raw PEM — must be base64-encoded"
  fi
done

# Verify PgBouncer password matches
PG_PASS=$(grep "^POSTGRES_PASSWORD=" .env | cut -d= -f2-)
PGB_PASS=$(grep "password=" services/pgbouncer/pgbouncer.ini | head -1 | sed 's/.*password=//')
if [ "$PG_PASS" != "$PGB_PASS" ]; then
  echo "ERROR: PgBouncer password doesn't match POSTGRES_PASSWORD"
else
  echo "OK: PgBouncer password matches"
fi
```

**Fix any errors before proceeding.**

---

## Step 3: Start the stack

```bash
docker compose up --build -d
```

Wait for all services to be healthy:

```bash
# Watch until all services show "healthy" or "running"
watch docker ps --format "table {{.Names}}\t{{.Status}}"
```

Expected: ~18 containers, all healthy within 2 minutes. If anything stays "unhealthy" for > 3 minutes, check logs:

```bash
docker compose logs <service-name> | tail -30
```

### Common startup issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| pgbouncer unhealthy | Password mismatch | Fix `pgbouncer.ini`, then `docker compose up -d pgbouncer` |
| auth-service unhealthy | Bad JWT keys | Regenerate keys (Step 1c), then `docker compose up -d auth-service` |
| litellm unhealthy | LITELLM_MASTER_KEY missing or wrong format | Must start with `sk-`, then `docker compose up -d litellm` |
| ai-service exits immediately | LITELLM_URL set without LITELLM_MASTER_KEY | Set LITELLM_MASTER_KEY, then `docker compose up -d ai-service` |
| asterisk restarting | Missing EXTERNAL_IP | Set in `.env`, then `docker compose up -d asterisk` |

---

## Step 4: Push APISIX routes

APISIX routes are stored in etcd, not in config files. They must be pushed after every fresh `docker compose up`:

```bash
./setup-apisix.sh
```

Expected output:
```
✓ auth-service (id:1)
✓ ai-service (id:2)
✓ web-app (id:3)
✓ consumer dattoapp (RS256)
✓ auth-route (/api/auth/*  — no JWT)
✓ chat-route (/api/chat)
... (12 routes total)
All done!
```

If the script hangs at "Waiting for APISIX Admin API...":
- Check APISIX logs: `docker compose logs apisix`
- Check etcd is healthy: `docker compose logs etcd`
- APISIX can take 60+ seconds on first start

---

## Step 5: Verify everything works

Run these checks in order:

### 5a. Health checks

```bash
# Auth service
curl -s http://localhost:5001/health | jq .
# Expected: {"status":"ok"}

# AI service
curl -s http://localhost:6001/health | jq .
# Expected: {"status":"ok"}

# MCP server
curl -s http://localhost:3001/health | jq .
# Expected: {"status":"ok"}

# Voice gateway (if enabled)
curl -s http://localhost:8001/health | jq .
# Expected: {"status":"ok","activeSessions":0}
```

### 5b. Login test

```bash
curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin_user","password":"secret"}' | jq .
```

Expected: `{"token":"eyJ..."}`. If you get 401, check JWT keys. If you get connection refused, run `setup-apisix.sh`.

### 5c. Chat test

```bash
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin_user","password":"secret"}' | jq -r .token)

curl -s -X POST http://localhost/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"question":"What is Datto RMM?"}' | jq .answer
```

Expected: An AI-generated response. If you get a timeout, check LiteLLM and OpenRouter API key.

### 5d. APISIX routes

```bash
curl -s -H "X-API-KEY: edd1c9f034335f136f87ad84b625c8f1" \
  http://localhost:9180/apisix/admin/routes | python3 -c "
import sys,json
data = json.load(sys.stdin)
routes = data.get('list', data.get('node', {}).get('nodes', []))
print(f'{len(routes)} routes configured')
for r in routes:
  v = r.get('value', r)
  print(f'  {v.get(\"id\")}: {v.get(\"name\", \"unnamed\")} → {v.get(\"uri\", \"?\")}')"
```

Expected: 12 routes listed.

### 5e. Web UI

Open http://localhost in your browser. Login with `admin_user` / `secret`.

---

## Step 6: Change default passwords

The seed data creates 4 users with password `secret`. Change them in the admin panel (`/admin/users`) before exposing to any network.

| Username | Default password | Role |
|----------|-----------------|------|
| admin_user | secret | admin (all 37 tools) |
| analyst_user | secret | analyst (9 tools) |
| helpdesk_user | secret | helpdesk (5 tools) |
| readonly_user | secret | readonly (4 tools) |

---

## After .env Changes

**Never use `docker compose restart`** — it doesn't reload env vars. Always use:

```bash
docker compose up -d <service>
```

If you changed `POSTGRES_PASSWORD`, you must also update `pgbouncer.ini` and restart pgbouncer.

---

## Redeploying / Updating Code

```bash
git pull
docker compose up --build -d
./setup-apisix.sh
```

Database migrations run automatically on first PostgreSQL start. If you're updating an existing deployment (postgres volume exists), new migrations won't auto-run. Run them manually:

```bash
docker exec -i <postgres-container> psql -U postgres -d datto_rmm < db/019_voice_device_mappings.sql
```

---

## CVE Scanner Setup

The CVE Scanner is a separate container that downloads NVD vulnerability data and matches it against device software inventory.

### Prerequisites

Migration 022 must be run on existing deployments:

```bash
docker exec -i <postgres-container> psql -U postgres -d datto_rmm < db/022_cve_scanner.sql
```

### First boot

The container auto-starts and downloads NVD feeds on first boot (~500MB download into `cve_cache` volume). This takes several minutes on first run.

### Scan schedule

Scans run daily at 4 AM by default (configurable via `SCAN_CRON` env var).

### Manual scan

Trigger a manual scan via the admin UI: `/admin/explorer/vulnerabilities` → "Scan Now" button.

### Health check

```bash
curl http://localhost:8500/health
# Expected: {"status":"ok"}
```

---

## Quick Diagnostics

```bash
# Which services are unhealthy?
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -v healthy

# Check a specific service's logs
docker compose logs --tail 50 <service>

# Check LiteLLM can reach OpenRouter
docker exec <litellm-container> python3 -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:4000/health').status)"

# Check AI service can reach LiteLLM
docker exec <ai-service-container> wget -qO- http://litellm:4000/health

# Check which LLM models are configured
docker exec <postgres-container> \
  psql -U postgres -d datto_rmm -c "SELECT key, model FROM llm_routing_config ORDER BY key;"

# Check APISIX is routing correctly
curl -v http://localhost/api/auth/login 2>&1 | grep "< HTTP"
# Should show: < HTTP/1.1 405 (or 400, not 404 or 502)

# Force LLM routing cache refresh
curl -X PUT http://localhost:6001/api/admin/llm-config \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -d '{"updates":[]}'
```

---

## Architecture Quick Reference

```
Browser → APISIX (:80) → Auth Service (:5001)
                        → AI Service (:6001) → LiteLLM (:4000) → OpenRouter
                                             → MCP Bridge (:4001) → MCP Server (:3001) → Datto API
                                             → Embedding Service (:7001) → Voyage/OpenAI
                        → Web App (:3000)

All services connect to PostgreSQL via PgBouncer (:5432)
Redis (:6379) handles JWT revocation
etcd (:2379) stores APISIX config
```

See `docs/PLATFORM_BRAIN.md` for the full system reference.
