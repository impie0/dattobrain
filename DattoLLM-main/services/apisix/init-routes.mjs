#!/usr/bin/env node
/**
 * Push all APISIX routes, upstreams, and consumer config into etcd via the Admin API.
 * Run ONCE after the stack is up.
 * Usage: node services/apisix/init-routes.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost:9180/apisix/admin";
const KEY = "edd1c9f034335f136f87ad84b625c8f1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

// ── Load public key from .env ──
const envFile = readFileSync(resolve(PROJECT_ROOT, ".env"), "utf8");
const pubKeyB64 = envFile.match(/^JWT_PUBLIC_KEY=(.+)$/m)?.[1]?.trim();
const privKeyB64 = envFile.match(/^JWT_PRIVATE_KEY=(.+)$/m)?.[1]?.trim();
if (!pubKeyB64 || !privKeyB64) { console.error("ERROR: JWT_PUBLIC_KEY or JWT_PRIVATE_KEY not found in .env"); process.exit(1); }
const pubKeyPem = Buffer.from(pubKeyB64, "base64").toString("utf8");
const privKeyPem = Buffer.from(privKeyB64, "base64").toString("utf8");

// ── Helpers ──
async function call(label, method, path, body) {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: { "X-API-KEY": KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      console.log(`  OK   ${label}`);
    } else {
      const text = await res.text();
      console.log(`  FAIL ${label}: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  FAIL ${label}: ${err.message}`);
  }
}

// ── Wait for APISIX Admin API ──
console.log("=== Waiting for APISIX Admin API ===");
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${BASE}/routes`, { headers: { "X-API-KEY": KEY } });
    if (r.ok) break;
  } catch {}
  process.stdout.write(".");
  await new Promise(r => setTimeout(r, 1000));
}
console.log(" ready.");

// ── Upstreams ──
console.log("\n=== Upstreams ===");
await call("auth-service", "PUT", "upstreams/1", { name: "auth-service", type: "roundrobin", nodes: { "auth-service:5001": 1 } });
await call("ai-service",   "PUT", "upstreams/2", { name: "ai-service",   type: "roundrobin", nodes: { "ai-service:6001": 1 } });
await call("web-app",      "PUT", "upstreams/3", { name: "web-app",      type: "roundrobin", nodes: { "web-app:3000": 1 } });

// ── Consumer (RS256) ──
console.log("\n=== Consumer (RS256) ===");
await call("dattoapp (jwt-auth RS256)", "PUT", "consumers/dattoapp", {
  username: "dattoapp",
  plugins: {
    "jwt-auth": {
      key: "dattoapp",
      public_key: pubKeyPem,
      private_key: privKeyPem,
      algorithm: "RS256",
    },
  },
});

// ── Lua function: decode JWT, inject headers, check JTI revocation ──
const luaFn = `return function(conf, ctx) local auth = ngx.req.get_headers()["authorization"]; if not auth then return end; local token = auth:match("Bearer (.+)"); if not token then return end; local parts = {}; for p in token:gmatch("[^%.]+") do parts[#parts+1] = p end; if #parts < 2 then return end; local b64 = parts[2]:gsub("%-","+"):gsub("_","/"); local pad = 4 - #b64 % 4; if pad < 4 then b64 = b64 .. string.rep("=", pad) end; local dec = ngx.decode_base64(b64); if not dec then return end; local cjson = require("cjson.safe"); local pl = cjson.decode(dec); if not pl then return end; ngx.req.set_header("X-User-Id", pl.sub or ""); ngx.req.set_header("X-User-Role", pl.role or ""); ngx.req.set_header("X-Allowed-Tools", cjson.encode(pl.allowed_tools or {})); if pl.jti then local redis = require("resty.redis"); local red = redis:new(); red:set_timeouts(300, 0, 300); local ok = red:connect("redis", 6379); if ok then local res = red:exists("revoked_jtis:" .. pl.jti); red:set_keepalive(10000, 100); if res == 1 then ngx.status = 401; ngx.header.content_type = "application/json"; ngx.say('{"error":"token_revoked","message":"This session has been revoked. Please log in again."}'); return ngx.exit(401) end end end end`;

const protectedPlugins = {
  "jwt-auth": { header: "authorization" },
  "serverless-post-function": { phase: "access", functions: [luaFn] },
};

// ── Routes ──
console.log("\n=== Routes ===");

// 1. Auth — no JWT, rate-limited
await call("auth-route", "PUT", "routes/1", {
  name: "auth-route",
  uri: "/api/auth/*",
  methods: ["GET", "POST"],
  upstream_id: "1",
  plugins: { "limit-req": { rate: 5, burst: 10, key: "remote_addr", rejected_code: 429 } },
});

// Protected routes (all go to ai-service upstream 2)
const protectedRoutes = [
  { id: 2,  name: "chat-sync-route",    uri: "/api/chat",        methods: ["POST"] },
  { id: 3,  name: "chat-sse-route",     uri: "/chat",            methods: ["POST"] },
  { id: 4,  name: "chat-mode-route",    uri: "/api/chat/mode",   methods: ["POST"] },
  { id: 5,  name: "history-route",      uri: "/api/history",     methods: ["GET"] },
  { id: 6,  name: "history-id-route",   uri: "/api/history/*",   methods: ["GET"] },
  { id: 7,  name: "admin-route",        uri: "/api/admin/*",     methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
  { id: 8,  name: "debug-route",        uri: "/api/debug/*",     methods: ["GET"] },
  { id: 9,  name: "tools-route",        uri: "/api/tools",       methods: ["GET"] },
  { id: 10, name: "approvals-route",    uri: "/api/approvals/*", methods: ["GET", "POST"] },
  { id: 11, name: "proposals-route",    uri: "/api/proposals/*", methods: ["GET", "POST"] },
];

for (const route of protectedRoutes) {
  await call(route.name, "PUT", `routes/${route.id}`, {
    name: route.name,
    uri: route.uri,
    methods: route.methods,
    upstream_id: "2",
    plugins: protectedPlugins,
  });
}

// 20. Web-app catch-all — no auth
await call("web-app-route", "PUT", "routes/20", {
  name: "web-app-route",
  uri: "/*",
  upstream_id: "3",
  priority: 0,
});

console.log("\n=== Done ===");
console.log("  Frontend:  http://localhost");
console.log("  Dashboard: http://localhost:9000 (admin/admin)");
console.log("  Login:     admin_user / secret");
