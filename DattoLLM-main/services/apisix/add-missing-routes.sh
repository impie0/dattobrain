#!/bin/bash
# Run this inside the APISIX container to add the /api/tools and /api/approvals/* routes.
# Usage: docker exec -it <apisix-container> sh /tmp/add-missing-routes.sh
# Or copy-paste the curl commands one at a time.

ADMIN_KEY="edd1c9f034335f136f87ad84b625c8f1"
ADMIN_URL="http://127.0.0.1:9180"

LUA_FN='return function(conf, ctx) local auth = ngx.req.get_headers()["authorization"]; if not auth then return end; local token = auth:match("Bearer (.+)"); if not token then return end; local parts = {}; for p in token:gmatch("[^%.]+") do parts[#parts+1] = p end; if #parts < 2 then return end; local b64 = parts[2]:gsub("%-","+"):gsub("_","/"); local pad = 4 - #b64 % 4; if pad < 4 then b64 = b64 .. string.rep("=", pad) end; local dec = ngx.decode_base64(b64); if not dec then return end; local cjson = require("cjson.safe"); local pl = cjson.decode(dec); if not pl then return end; ngx.req.set_header("X-User-Id", pl.sub or ""); ngx.req.set_header("X-User-Role", pl.role or "") end'

# --- /api/tools (GET) ---
cat > /tmp/tools-route.json <<EOF
{
  "name": "tools-route",
  "uri": "/api/tools",
  "methods": ["GET"],
  "upstream": {
    "type": "roundrobin",
    "nodes": { "ai-service:6001": 1 }
  },
  "plugins": {
    "jwt-auth": { "header": "authorization" },
    "serverless-post-function": {
      "phase": "access",
      "functions": ["${LUA_FN}"]
    }
  }
}
EOF

echo "==> Creating /api/tools route..."
curl -s -X PUT "${ADMIN_URL}/apisix/admin/routes/tools-route" \
  -H "X-API-KEY: ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/tools-route.json
echo

# --- /api/approvals/* (GET, POST) ---
cat > /tmp/approvals-route.json <<EOF
{
  "name": "approvals-route",
  "uri": "/api/approvals/*",
  "methods": ["GET", "POST"],
  "upstream": {
    "type": "roundrobin",
    "nodes": { "ai-service:6001": 1 }
  },
  "plugins": {
    "jwt-auth": { "header": "authorization" },
    "serverless-post-function": {
      "phase": "access",
      "functions": ["${LUA_FN}"]
    }
  }
}
EOF

echo "==> Creating /api/approvals/* route..."
curl -s -X PUT "${ADMIN_URL}/apisix/admin/routes/approvals-route" \
  -H "X-API-KEY: ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/approvals-route.json
echo

echo "==> Done. Verify with:"
echo "    curl http://127.0.0.1:9180/apisix/admin/routes -H 'X-API-KEY: ${ADMIN_KEY}' | python3 -m json.tool | grep name"
