import express from "express";
import cors from "cors";
import { handleLogin, handleRefresh, handleIntrospect, handleLegacyLogin, handleLegacyVerify, handleRevoke } from "./handlers.js";
import { getRedis } from "./redis.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function validateEnv() {
  for (const key of ["DATABASE_URL", "JWT_PRIVATE_KEY", "JWT_PUBLIC_KEY"]) {
    if (!process.env[key]) {
      log("error", `Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
}

validateEnv();

// SEC-002: Initialise Redis client at startup (connects lazily, warns if unavailable)
getRedis();

const app = express();
app.use(cors());
app.use(express.json());

// Legacy routes — web-app + APISIX expect /api/auth/*
app.post("/api/auth/login", handleLegacyLogin);
app.get("/api/auth/verify", handleLegacyVerify);

// Platform routes
app.post("/auth/login", handleLogin);
app.post("/auth/refresh", handleRefresh);
app.get("/auth/introspect", handleIntrospect);
// SEC-002/SEC-008: Token revocation — POST { jti } or { user_id }
// Called by admin panel (ai-service proxy) for forced-logout, or client for self-logout
app.post("/auth/revoke", handleRevoke);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = Number(process.env["PORT"] ?? 5001);
app.listen(port, () => {
  log("info", `auth-service listening on :${port}`);
});
