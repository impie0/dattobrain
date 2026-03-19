#!/bin/sh
# Pushes all upstreams, consumer, and routes into APISIX via the Admin API.
# Run this ONCE after the stack is up to populate etcd so routes appear in the Dashboard.
# Usage (from WSL or Git Bash): bash services/apisix/init-routes.sh

BASE="http://localhost:9180/apisix/admin"
KEY="edd1c9f034335f136f87ad84b625c8f1"

ok() { printf '  OK  %s\n' "$1"; }
fail() { printf '  FAIL %s: %s\n' "$1" "$2"; }

call() {
  local label="$1" method="$2" path="$3" body="$4"
  local res
  res=$(curl -s -o /tmp/apisix_resp.txt -w "%{http_code}" \
    -X "$method" "$BASE/$path" \
    -H "X-API-KEY: $KEY" \
    -H "Content-Type: application/json" \
    -d "$body")
  if [ "$res" -ge 200 ] && [ "$res" -lt 300 ]; then
    ok "$label"
  else
    fail "$label" "HTTP $res — $(cat /tmp/apisix_resp.txt)"
  fi
}

echo "=== Waiting for APISIX Admin API ==="
until curl -s -o /dev/null -w "%{http_code}" "$BASE/routes" -H "X-API-KEY: $KEY" | grep -q "^2"; do
  printf '.'; sleep 1
done
echo " ready."

# ── Decode the RS256 public key from .env (base64-encoded PEM) ──
# Source .env from the project root (two levels up from this script)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$PROJECT_ROOT/.env" ]; then
  JWT_PUBLIC_KEY_B64=$(grep '^JWT_PUBLIC_KEY=' "$PROJECT_ROOT/.env" | cut -d'=' -f2-)
else
  echo "ERROR: .env not found at $PROJECT_ROOT/.env"
  exit 1
fi

# Decode base64 to get the PEM key
PUB_KEY_PEM=$(echo "$JWT_PUBLIC_KEY_B64" | base64 -d 2>/dev/null || echo "$JWT_PUBLIC_KEY_B64" | base64 --decode 2>/dev/null)

if [ -z "$PUB_KEY_PEM" ]; then
  echo "ERROR: Could not decode JWT_PUBLIC_KEY from .env"
  exit 1
fi

echo ""
echo "=== Upstreams ==="
# Note: use internal Docker-network ports, NOT the host-mapped ports from docker-compose.
call "auth-service"  PUT "upstreams/1" '{"name":"auth-service","type":"roundrobin","nodes":{"auth-service:5001":1}}'
call "ai-service"    PUT "upstreams/2" '{"name":"ai-service","type":"roundrobin","nodes":{"ai-service:6001":1}}'
call "web-app"       PUT "upstreams/3" '{"name":"web-app","type":"roundrobin","nodes":{"web-app:3000":1}}'

echo ""
echo "=== Consumer (RS256) ==="
# Build consumer JSON with the RS256 public key using Python for safe escaping.
CONSUMER_JSON=$(python3 -c "
import json, sys
pub_key = '''$PUB_KEY_PEM'''
consumer = {
  'username': 'dattoapp',
  'plugins': {
    'jwt-auth': {
      'key': 'dattoapp',
      'public_key': pub_key,
      'algorithm': 'RS256'
    }
  }
}
print(json.dumps(consumer))
")
call "dattoapp (jwt-auth RS256)" PUT "consumers/dattoapp" "$CONSUMER_JSON"

# Lua function that decodes the JWT payload and injects X-User-Id / X-User-Role / X-Allowed-Tools headers.
# Also checks Redis for JTI revocation (SEC-002).
cat > /tmp/lua_func.txt << 'LUAEOF'
return function(conf, ctx) local auth = ngx.req.get_headers()["authorization"]; if not auth then return end; local token = auth:match("Bearer (.+)"); if not token then return end; local parts = {}; for p in token:gmatch("[^%.]+") do parts[#parts+1] = p end; if #parts < 2 then return end; local b64 = parts[2]:gsub("%-","+"):gsub("_","/"); local pad = 4 - #b64 % 4; if pad < 4 then b64 = b64 .. string.rep("=", pad) end; local dec = ngx.decode_base64(b64); if not dec then return end; local cjson = require("cjson.safe"); local pl = cjson.decode(dec); if not pl then return end; ngx.req.set_header("X-User-Id", pl.sub or ""); ngx.req.set_header("X-User-Role", pl.role or ""); ngx.req.set_header("X-Allowed-Tools", cjson.encode(pl.allowed_tools or {})); if pl.jti then local redis = require("resty.redis"); local red = redis:new(); red:set_timeouts(300, 0, 300); local ok = red:connect("redis", 6379); if ok then local res = red:exists("revoked_jtis:" .. pl.jti); red:set_keepalive(10000, 100); if res == 1 then ngx.status = 401; ngx.header.content_type = "application/json"; ngx.say("{\"error\":\"token_revoked\",\"message\":\"This session has been revoked. Please log in again.\"}"); return ngx.exit(401) end end end end
LUAEOF

# Build the plugins JSON with the Lua function using Python (handles escaping safely).
PLUGINS_JSON=$(python3 -c "
import json, sys
lua = open('/tmp/lua_func.txt').read().strip()
plugins = {
  'jwt-auth': {'header': 'authorization'},
  'serverless-post-function': {'phase': 'access', 'functions': [lua]}
}
print(json.dumps(plugins))
")

echo ""
echo "=== Routes ==="

# 1. Auth — no JWT required, but rate-limited (SEC-006: prevent brute-force on login)
call "auth-route" PUT "routes/1" \
'{
  "name": "auth-route",
  "uri": "/api/auth/*",
  "methods": ["GET","POST"],
  "upstream_id": "1",
  "plugins": {
    "limit-req": {
      "rate": 5,
      "burst": 10,
      "key": "remote_addr",
      "rejected_code": 429
    }
  }
}'

# 2-10. Protected routes — jwt-auth + header injection + JTI revocation
for SPEC in \
  "2|chat-sync-route|/api/chat|POST" \
  "3|chat-sse-route|/chat|POST" \
  "4|chat-mode-route|/api/chat/mode|POST" \
  "5|history-route|/api/history|GET" \
  "6|history-id-route|/api/history/*|GET" \
  "7|admin-route|/api/admin/*|GET,POST,PUT,PATCH,DELETE" \
  "8|debug-route|/api/debug/*|GET" \
  "9|tools-route|/api/tools|GET" \
  "10|approvals-route|/api/approvals/*|GET,POST" \
  "11|proposals-route|/api/proposals/*|GET,POST"
do
  ID=$(echo "$SPEC" | cut -d'|' -f1)
  NAME=$(echo "$SPEC" | cut -d'|' -f2)
  URI=$(echo "$SPEC" | cut -d'|' -f3)
  METHODS=$(echo "$SPEC" | cut -d'|' -f4)

  BODY=$(python3 -c "
import json
plugins = $PLUGINS_JSON
methods = '${METHODS}'.split(',')
route = {
  'name': '${NAME}',
  'uri': '${URI}',
  'methods': methods,
  'upstream_id': '2',
  'plugins': plugins
}
print(json.dumps(route))
")
  call "$NAME" PUT "routes/$ID" "$BODY"
done

# 20. Web-app catch-all — no auth (serves the Next.js frontend)
# High route ID so it doesn't conflict with future protected routes
call "web-app-route" PUT "routes/20" \
'{
  "name": "web-app-route",
  "uri": "/*",
  "upstream_id": "3",
  "priority": 0
}'

echo ""
echo "=== Done ==="
echo "  Frontend:  http://localhost"
echo "  Dashboard: http://localhost:9000 (admin/admin)"
echo "  Login:     admin_user / secret"
