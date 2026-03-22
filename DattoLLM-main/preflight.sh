#!/usr/bin/env bash
# preflight.sh — Validate everything before docker compose up.
# Run this after filling in .env to catch config errors early.
#
# Usage: ./preflight.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

pass()    { echo -e "  ${GREEN}✓${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; ERRORS=$((ERRORS + 1)); }
warn()    { echo -e "  ${YELLOW}!${NC} $1"; WARNINGS=$((WARNINGS + 1)); }

ENV_FILE=".env"

echo ""
echo "══════════════════════════════════════════════════"
echo "  DattoLLM Pre-flight Check"
echo "══════════════════════════════════════════════════"
echo ""

# ── .env file ────────────────────────────────────────────────────────────────
echo "1. Environment file"

if [ ! -f "$ENV_FILE" ]; then
  fail ".env file not found — copy .env.example to .env and fill in values"
  echo ""
  echo "Run: cp .env.example .env"
  exit 1
fi
pass ".env file exists"

get_env() {
  grep "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//'
}

# ── Required variables ───────────────────────────────────────────────────────
echo ""
echo "2. Required environment variables"

for var in POSTGRES_PASSWORD JWT_PRIVATE_KEY JWT_PUBLIC_KEY MCP_INTERNAL_SECRET OPENROUTER_API_KEY EMBEDDING_API_KEY; do
  val=$(get_env "$var")
  if [ -z "$val" ]; then
    fail "$var is empty or missing"
  else
    pass "$var is set"
  fi
done

# ── LITELLM_MASTER_KEY format ────────────────────────────────────────────────
echo ""
echo "3. LiteLLM master key"

LMK=$(get_env "LITELLM_MASTER_KEY")
if [ -z "$LMK" ]; then
  fail "LITELLM_MASTER_KEY is empty — LiteLLM and AI service will fail"
elif [[ "$LMK" != sk-* ]]; then
  fail "LITELLM_MASTER_KEY must start with 'sk-' (current: '${LMK:0:5}...')"
else
  pass "LITELLM_MASTER_KEY format OK (starts with sk-)"
fi

# ── JWT key format ───────────────────────────────────────────────────────────
echo ""
echo "4. JWT key format"

for var in JWT_PRIVATE_KEY JWT_PUBLIC_KEY; do
  val=$(get_env "$var")
  if [ -z "$val" ]; then
    continue  # Already reported above
  fi
  if [[ "$val" == -----* ]]; then
    fail "$var looks like raw PEM — must be base64-encoded (see DEPLOY.md Step 1c)"
  else
    # Try to decode and check it's valid PEM
    decoded=$(echo "$val" | base64 -d 2>/dev/null || echo "$val" | base64 -D 2>/dev/null || echo "DECODE_FAIL")
    if [[ "$decoded" == "DECODE_FAIL" ]]; then
      fail "$var could not be base64-decoded"
    elif [[ "$decoded" == -----* ]]; then
      pass "$var is valid base64-encoded PEM"
    else
      fail "$var decoded but doesn't look like a PEM key"
    fi
  fi
done

# ── PgBouncer password match ─────────────────────────────────────────────────
echo ""
echo "5. PgBouncer password"

PG_PASS=$(get_env "POSTGRES_PASSWORD")
if [ -f "services/pgbouncer/pgbouncer.ini" ]; then
  PGB_PASS=$(grep "password=" services/pgbouncer/pgbouncer.ini | head -1 | sed 's/.*password=//')
  if [ -z "$PGB_PASS" ]; then
    fail "No password found in pgbouncer.ini"
  elif [ "$PG_PASS" = "$PGB_PASS" ]; then
    pass "PgBouncer password matches POSTGRES_PASSWORD"
  else
    fail "PgBouncer password doesn't match POSTGRES_PASSWORD"
    echo "       Fix: edit services/pgbouncer/pgbouncer.ini and set password=$PG_PASS"
  fi
else
  fail "services/pgbouncer/pgbouncer.ini not found"
fi

# ── Optional: Datto credentials ──────────────────────────────────────────────
echo ""
echo "6. Datto RMM credentials (optional)"

DATTO_KEY=$(get_env "DATTO_API_KEY")
DATTO_SECRET=$(get_env "DATTO_API_SECRET")
if [ -z "$DATTO_KEY" ] || [ -z "$DATTO_SECRET" ]; then
  warn "Datto credentials not set — MCP tools will fail but platform still works"
else
  pass "Datto API credentials set"
  PLATFORM=$(get_env "DATTO_PLATFORM")
  if [ -z "$PLATFORM" ]; then
    warn "DATTO_PLATFORM not set — defaults to 'merlot'"
  else
    pass "DATTO_PLATFORM=$PLATFORM"
  fi
fi

# ── Optional: Voice ──────────────────────────────────────────────────────────
echo ""
echo "7. Voice gateway (optional)"

VOICE_USER=$(get_env "VOICE_SERVICE_USERNAME")
EXT_IP=$(get_env "EXTERNAL_IP")
if [ -z "$VOICE_USER" ] && [ -z "$EXT_IP" ]; then
  warn "Voice not configured (VOICE_SERVICE_USERNAME and EXTERNAL_IP not set)"
else
  for var in OPENAI_API_KEY ELEVENLABS_API_KEY EXTERNAL_IP VOICE_SERVICE_USERNAME VOICE_SERVICE_PASSWORD DRACHTIO_SECRET; do
    val=$(get_env "$var")
    if [ -z "$val" ]; then
      fail "Voice enabled but $var is missing"
    else
      pass "$var is set"
    fi
  done
fi

# ── Port conflicts ───────────────────────────────────────────────────────────
echo ""
echo "8. Port availability"

for port in 80 5060 5080 9180; do
  if lsof -i ":$port" > /dev/null 2>&1; then
    pid=$(lsof -t -i ":$port" 2>/dev/null | head -1)
    proc=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
    if [[ "$proc" == *docker* ]] || [[ "$proc" == *com.docke* ]]; then
      pass "Port $port (used by Docker — probably from previous run)"
    else
      warn "Port $port in use by $proc (PID $pid) — may conflict"
    fi
  else
    pass "Port $port available"
  fi
done

# ── Required files ───────────────────────────────────────────────────────────
echo ""
echo "9. Required config files"

for f in services/pgbouncer/pgbouncer.ini services/litellm/config.yaml services/apisix/config.yaml setup-apisix.sh docker-compose.yml; do
  if [ -f "$f" ]; then
    pass "$f exists"
  else
    fail "$f missing"
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
  echo -e "  ${GREEN}All checks passed!${NC} ($WARNINGS warnings)"
  echo ""
  echo "  Next steps:"
  echo "    docker compose up --build -d"
  echo "    ./setup-apisix.sh"
  echo "    Open http://localhost"
else
  echo -e "  ${RED}$ERRORS errors${NC}, $WARNINGS warnings"
  echo ""
  echo "  Fix the errors above, then run ./preflight.sh again."
fi
echo "══════════════════════════════════════════════════"
echo ""

exit $ERRORS
