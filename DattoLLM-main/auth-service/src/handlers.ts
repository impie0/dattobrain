import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from "./tokens.js";
import { trackJti, revokeJti, revokeAllForUser, getRedis } from "./redis.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

// Legacy login: accepts { username, password }, returns { token } for web-app / APISIX compatibility
export async function handleLegacyLogin(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "invalid_request", message: "username and password required" });
    return;
  }

  const client = await pool.connect();
  try {
    const userResult = await client.query(
      "SELECT id, username, email, password_hash, is_active FROM users WHERE username = $1 OR email = $1",
      [username]
    );

    const user = userResult.rows[0] as
      | { id: string; username: string; email: string; password_hash: string; is_active: boolean }
      | undefined;

    if (!user || !user.is_active) {
      await client.query(
        "INSERT INTO audit_logs (user_id, event_type, ip_address) VALUES ($1, $2, $3)",
        [user?.id ?? null, "login_failure", req.ip ?? null]
      ).catch(() => {});
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      await client.query(
        "INSERT INTO audit_logs (user_id, event_type, ip_address) VALUES ($1, $2, $3)",
        [user.id, "login_failure", req.ip ?? null]
      ).catch(() => {});
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const rolesResult = await client.query(
      `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1`,
      [user.id]
    );
    const roles: string[] = rolesResult.rows.map((r: { name: string }) => r.name);
    const primaryRole = roles[0] ?? "readonly";

    const toolsResult = await client.query(
      `SELECT DISTINCT tp.tool_name FROM tool_permissions tp
       JOIN user_roles ur ON ur.role_id = tp.role_id WHERE ur.user_id = $1`,
      [user.id]
    );
    const allowedTools: string[] = toolsResult.rows.map((r: { tool_name: string }) => r.tool_name);

    const privateKey = process.env["JWT_PRIVATE_KEY"]!;
    const key = privateKey.startsWith("-----") ? privateKey : Buffer.from(privateKey, "base64").toString("utf8");

    // SEC-002: embed jti for revocation support
    const legacyJti = randomUUID();
    const token = (await import("jsonwebtoken")).default.sign(
      {
        key: "dattoapp",
        sub: user.id,
        email: user.email,
        role: primaryRole,
        roles,
        allowed_tools: allowedTools,
        jti: legacyJti,
      },
      key,
      { algorithm: "RS256", expiresIn: 86400 }
    );

    // Track JTI for possible forced-revoke (SEC-008) — best-effort
    await trackJti(user.id, legacyJti);

    await client.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
    await client.query(
      "INSERT INTO audit_logs (user_id, event_type, ip_address) VALUES ($1, $2, $3)",
      [user.id, "login_success", req.ip ?? null]
    );

    log("info", "legacy_login_success", { userId: user.id, username: user.username });
    res.json({ token });
  } finally {
    client.release();
  }
}

// Legacy verify: validates JWT and returns { valid, sub, role }
export async function handleLegacyVerify(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ valid: false });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token) as { sub: string; role: string; jti?: string };
    // SEC-002: Check JTI revocation — same check as handleIntrospect
    const jti = payload.jti;
    if (jti) {
      const redis = getRedis();
      if (redis) {
        const revoked = await redis.exists(`revoked_jtis:${jti}`).catch(() => 0);
        if (revoked) {
          res.status(401).json({ valid: false, error: "token_revoked" });
          return;
        }
      }
    }
    res.json({ valid: true, sub: payload.sub, role: payload.role });
  } catch {
    res.status(401).json({ valid: false });
  }
}

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "invalid_request", message: "email and password required" });
    return;
  }

  const client = await pool.connect();
  try {
    const userResult = await client.query(
      "SELECT id, email, password_hash, is_active FROM users WHERE email = $1 OR username = $1",
      [email]
    );

    const user = userResult.rows[0] as
      | { id: string; email: string; password_hash: string; is_active: boolean }
      | undefined;

    if (!user || !user.is_active) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const toolsResult = await client.query(
      `SELECT DISTINCT tp.tool_name
       FROM tool_permissions tp
       JOIN user_roles ur ON ur.role_id = tp.role_id
       WHERE ur.user_id = $1`,
      [user.id]
    );
    const allowedTools: string[] = toolsResult.rows.map((r: { tool_name: string }) => r.tool_name);

    const rolesResult = await client.query(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [user.id]
    );
    const roles: string[] = rolesResult.rows.map((r: { name: string }) => r.name);

    const { token: accessToken, jti } = signAccessToken({
      sub: user.id,
      email: user.email,
      roles,
      allowed_tools: allowedTools,
    });

    // SEC-002: track JTI for forced-revoke (SEC-008) — best-effort
    await trackJti(user.id, jti);

    const rawRefresh = generateRefreshToken();
    const tokenHash = hashRefreshToken(rawRefresh);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await client.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, tokenHash, expiresAt]
    );

    await client.query(
      "INSERT INTO audit_logs (user_id, event_type, ip_address) VALUES ($1, $2, $3)",
      [user.id, "login_success", req.ip ?? null]
    );

    await client.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);

    log("info", "login_success", { userId: user.id, email: user.email });
    res.json({ access_token: accessToken, expires_in: 3600, refresh_token: rawRefresh });
  } finally {
    client.release();
  }
}

export async function handleRefresh(req: Request, res: Response): Promise<void> {
  const { refresh_token } = req.body as { refresh_token?: string };

  if (!refresh_token) {
    res.status(400).json({ error: "invalid_request", message: "refresh_token required" });
    return;
  }

  const tokenHash = hashRefreshToken(refresh_token);

  const client = await pool.connect();
  try {
    const tokenResult = await client.query(
      `SELECT rt.user_id, rt.expires_at, rt.revoked
       FROM refresh_tokens rt
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );

    const tokenRow = tokenResult.rows[0] as
      | { user_id: string; expires_at: Date; revoked: boolean }
      | undefined;

    if (!tokenRow || tokenRow.revoked || tokenRow.expires_at < new Date()) {
      res.status(401).json({ error: "invalid_refresh_token" });
      return;
    }

    const toolsResult = await client.query(
      `SELECT DISTINCT tp.tool_name
       FROM tool_permissions tp
       JOIN user_roles ur ON ur.role_id = tp.role_id
       WHERE ur.user_id = $1`,
      [tokenRow.user_id]
    );
    const allowedTools: string[] = toolsResult.rows.map((r: { tool_name: string }) => r.tool_name);

    const rolesResult = await client.query(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [tokenRow.user_id]
    );
    const roles: string[] = rolesResult.rows.map((r: { name: string }) => r.name);

    const userResult = await client.query("SELECT email FROM users WHERE id = $1", [tokenRow.user_id]);
    const email = (userResult.rows[0] as { email: string } | undefined)?.email ?? "";

    const { token: accessToken, jti } = signAccessToken({
      sub: tokenRow.user_id,
      email,
      roles,
      allowed_tools: allowedTools,
    });

    // SEC-002: track JTI for forced-revoke (SEC-008) — best-effort
    await trackJti(tokenRow.user_id, jti);

    res.json({ access_token: accessToken, expires_in: 3600 });
  } finally {
    client.release();
  }
}

// SEC-002: Revoke a single JTI (e.g., user-initiated logout)
// SEC-008: Revoke all tokens for a user (admin forced-logout)
export async function handleRevoke(req: Request, res: Response): Promise<void> {
  const { jti, user_id } = req.body as { jti?: string; user_id?: string };

  if (!jti && !user_id) {
    res.status(400).json({ error: "provide jti (single token) or user_id (all tokens for user)" });
    return;
  }

  if (jti) {
    await revokeJti(jti);
    log("info", "jti_revoked", { jti });
    res.json({ revoked: true, jti });
    return;
  }

  // user_id path — SEC-008 forced-revoke
  const count = await revokeAllForUser(user_id!);
  // Also revoke all refresh tokens for the user in DB
  await pool.query(
    "UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false",
    [user_id]
  ).catch(() => {});
  await pool.query(
    "INSERT INTO audit_logs (user_id, event_type) VALUES ($1, $2)",
    [user_id, "forced_logout"]
  ).catch(() => {});
  log("info", "user_tokens_revoked", { userId: user_id, count });
  res.json({ revoked: true, user_id, jtis_revoked: count });
}

export async function handleIntrospect(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token) as {
      sub: string;
      roles: string[];
      allowed_tools: string[];
      jti?: string;
    };

    // SEC-002: Check JTI revocation in Redis — defense-in-depth even after APISIX check
    const jti = payload.jti;
    if (jti) {
      const redis = getRedis();
      if (redis) {
        const revoked = await redis.exists(`revoked_jtis:${jti}`).catch(() => 0);
        if (revoked) {
          res.status(401).json({ valid: false, error: "token_revoked" });
          return;
        }
      }
    }

    res.json({
      valid: true,
      user_id: payload.sub,
      roles: payload.roles,
      allowed_tools: payload.allowed_tools,
    });
  } catch {
    res.status(401).json({ valid: false, error: "invalid_token" });
  }
}
