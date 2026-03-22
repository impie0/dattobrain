#!/usr/bin/env bash
# setup-apisix.sh — Configure APISIX upstreams, consumer, and routes via Admin API.
# Run this once after `docker compose up --build` finishes.
#
# Usage:
#   chmod +x setup-apisix.sh   (first time only)
#   ./setup-apisix.sh
#
# What it does:
#   1. Waits for APISIX Admin API to be ready
#   2. Creates 3 upstreams: auth-service, ai-service, web-app
#   3. Creates JWT consumer (dattoapp, RS256) using your JWT_PUBLIC_KEY from .env
#   4. Creates all 11 routes (auth, chat, history, admin, debug, tools, approvals, proposals, SSE chat, web-app)
#
# Re-running this script is safe — all calls are PUT (idempotent).

set -euo pipefail

ADMIN_URL="http://localhost:9180/apisix/admin"
ADMIN_KEY="edd1c9f034335f136f87ad84b625c8f1"
ENV_FILE="$(dirname "$0")/.env"
CURL_BIN=$(which curl 2>/dev/null || echo "/usr/bin/curl")

# ── Shared Lua one-liner ───────────────────────────────────────────────────────
# Decodes JWT payload → injects X-User-Id, X-User-Role, X-Allowed-Tools headers.
# SEC-002: also checks Redis for revoked JTIs before forwarding.
LUA='return function(conf, ctx) local auth = ngx.req.get_headers()["authorization"]; if not auth then return end; local token = auth:match("Bearer (.+)"); if not token then return end; local parts = {}; for p in token:gmatch("[^%.]+") do parts[#parts+1] = p end; if #parts < 2 then return end; local b64 = parts[2]:gsub("%-","+"):gsub("_","/"); local pad = 4 - #b64 % 4; if pad < 4 then b64 = b64 .. string.rep("=", pad) end; local dec = ngx.decode_base64(b64); if not dec then return end; local cjson = require("cjson.safe"); local pl = cjson.decode(dec); if not pl then return end; local jti = pl.jti; if jti then local redis = require("resty.redis"); local red = redis:new(); red:set_timeouts(500, 500, 500); local ok = red:connect("redis", 6379); if ok then local exists = red:exists("revoked_jtis:" .. jti); red:set_keepalive(10000, 100); if exists == 1 then ngx.status = ngx.HTTP_UNAUTHORIZED; ngx.header["Content-Type"] = "application/json"; ngx.say("{\"error\":\"token_revoked\"}"); return ngx.exit(ngx.HTTP_UNAUTHORIZED) end end end; ngx.req.set_header("X-User-Id", pl.sub or ""); ngx.req.set_header("X-User-Role", pl.role or ""); ngx.req.set_header("X-Allowed-Tools", cjson.encode(pl.allowed_tools or {})) end'

# ── Helpers ────────────────────────────────────────────────────────────────────
header() { echo; echo "──────────────────────────────────────────"; echo "  $1"; echo "──────────────────────────────────────────"; }
ok()     { echo "  ✓ $1"; }
fail()   { echo "  ✗ $1"; exit 1; }

CURL_BIN=$(which curl 2>/dev/null || echo "/usr/bin/curl")

admin_put() {
  local path="$1"
  local body="$2"
  local http_code
  http_code=$("$CURL_BIN" -s -o /dev/null -w "%{http_code}" -X PUT \
    -H "X-API-KEY: $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "$ADMIN_URL$path")
  if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
    return 0
  else
    echo "  HTTP $http_code for PUT $path" >&2
    return 1
  fi
}

# ── Wait for APISIX ────────────────────────────────────────────────────────────
header "Waiting for APISIX Admin API..."
for i in $(seq 1 30); do
  if "$CURL_BIN" -s -o /dev/null -f -H "X-API-KEY: $ADMIN_KEY" "$ADMIN_URL/upstreams" 2>/dev/null; then
    ok "APISIX is ready"
    break
  fi
  echo "  Attempt $i/30 — retrying in 5s..."
  sleep 5
  if [[ $i == 30 ]]; then
    fail "APISIX did not become ready. Is 'docker compose up' running?"
  fi
done

# ── Read JWT public key from .env ──────────────────────────────────────────────
header "Reading JWT_PUBLIC_KEY from .env..."
if [[ ! -f "$ENV_FILE" ]]; then
  fail ".env file not found at $ENV_FILE"
fi

JWT_PUBLIC_KEY_RAW=$(grep '^JWT_PUBLIC_KEY=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"')
if [[ -z "$JWT_PUBLIC_KEY_RAW" ]]; then
  fail "JWT_PUBLIC_KEY not found in .env"
fi

# Decode base64 if needed (tokens.ts pattern: starts with "-----" = raw PEM, else base64)
if [[ "$JWT_PUBLIC_KEY_RAW" == -----* ]]; then
  JWT_PUBLIC_KEY=$(echo "$JWT_PUBLIC_KEY_RAW" | sed 's/\\n/\n/g')
else
  JWT_PUBLIC_KEY=$(echo "$JWT_PUBLIC_KEY_RAW" | base64 -d 2>/dev/null || echo "$JWT_PUBLIC_KEY_RAW" | base64 -D 2>/dev/null)
fi
ok "JWT_PUBLIC_KEY loaded"

# ── Upstreams ──────────────────────────────────────────────────────────────────
header "Creating upstreams..."

admin_put "/upstreams/1" '{
  "id": 1,
  "name": "auth-service",
  "type": "roundrobin",
  "nodes": {"auth-service:5001": 1}
}' && ok "auth-service (id:1)" || fail "auth-service upstream"

admin_put "/upstreams/2" '{
  "id": 2,
  "name": "ai-service",
  "type": "roundrobin",
  "nodes": {"ai-service:6001": 1}
}' && ok "ai-service (id:2)" || fail "ai-service upstream"

admin_put "/upstreams/3" '{
  "id": 3,
  "name": "web-app",
  "type": "roundrobin",
  "nodes": {"web-app:3000": 1}
}' && ok "web-app (id:3)" || fail "web-app upstream"

# ── Consumer (JWT) ─────────────────────────────────────────────────────────────
header "Creating JWT consumer (dattoapp, RS256)..."

# Escape the public key for JSON embedding
JWT_KEY_JSON=$(echo "$JWT_PUBLIC_KEY" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null \
  || echo "$JWT_PUBLIC_KEY" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');process.stdout.write(JSON.stringify(s))" 2>/dev/null \
  || fail "Could not JSON-encode JWT_PUBLIC_KEY — requires python3 or node")

admin_put "/consumers/dattoapp" "{
  \"username\": \"dattoapp\",
  \"plugins\": {
    \"jwt-auth\": {
      \"key\": \"dattoapp\",
      \"algorithm\": \"RS256\",
      \"public_key\": $JWT_KEY_JSON,
      \"private_key\": \"\"
    }
  }
}" && ok "consumer dattoapp (RS256)" || fail "consumer dattoapp"

# ── Routes ─────────────────────────────────────────────────────────────────────
header "Creating routes..."

# Route helper: protected route (jwt-auth + Lua inject)
protected_route() {
  local id="$1" name="$2" uri="$3" methods="$4" upstream_id="$5"
  admin_put "/routes/$id" "{
    \"id\": $id,
    \"name\": \"$name\",
    \"uri\": \"$uri\",
    \"methods\": $methods,
    \"upstream_id\": $upstream_id,
    \"plugins\": {
      \"jwt-auth\": {\"header\": \"authorization\"},
      \"serverless-post-function\": {
        \"phase\": \"access\",
        \"functions\": [$(echo "$LUA" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "$LUA" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');process.stdout.write(JSON.stringify(s))" 2>/dev/null)]
      }
    }
  }" && ok "$name ($uri)" || fail "$name route"
}

# 1. Auth — no JWT, rate-limited
admin_put "/routes/1" '{
  "id": 1,
  "name": "auth-route",
  "uri": "/api/auth/*",
  "methods": ["GET","POST"],
  "upstream_id": 1,
  "plugins": {
    "limit-req": {
      "rate": 5,
      "burst": 10,
      "key": "remote_addr",
      "rejected_code": 429
    }
  }
}' && ok "auth-route (/api/auth/*  — no JWT)" || fail "auth-route"

# 2-11. Protected routes
protected_route  2  "chat-route"       "/api/chat"        '["POST"]'                          2
protected_route  3  "chat-mode-route"  "/api/chat/mode"   '["POST"]'                          2
protected_route  4  "history-route"    "/api/history"     '["GET"]'                           2
protected_route  5  "history-id-route" "/api/history/*"   '["GET"]'                           2
protected_route  6  "admin-route"      "/api/admin/*"     '["GET","POST","PUT","PATCH","DELETE"]' 2
protected_route  7  "debug-route"      "/api/debug/*"     '["GET"]'                           2
protected_route  8  "tools-route"      "/api/tools"       '["GET"]'                           2
protected_route  9  "approvals-route"  "/api/approvals/*" '["GET","POST"]'                    2
protected_route 10  "proposals-route"  "/api/proposals/*" '["GET","POST"]'                    2
protected_route 11  "chat-sse-route"   "/chat"            '["POST"]'                          2

# 12. Web-app catch-all — no auth
admin_put "/routes/12" '{
  "id": 12,
  "name": "web-app-route",
  "uri": "/*",
  "upstream_id": 3
}' && ok "web-app-route (/*  — catch-all, no auth)" || fail "web-app-route"

# ── Done ───────────────────────────────────────────────────────────────────────
header "All done!"
echo "  Open http://localhost in your browser."
echo "  Login: admin@example.com / secret"
echo
