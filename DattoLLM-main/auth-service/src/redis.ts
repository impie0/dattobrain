/**
 * Redis client for JWT revocation (SEC-002).
 *
 * Only activates when REDIS_URL is set. When Redis is unavailable, JTIs are
 * still embedded in tokens (SEC-002 structural change) but revocation is
 * non-operational. Log warnings make this visible at startup.
 *
 * Keys:
 *   revoked_jtis:<jti>          STRING "1"  EX <access_token_ttl>
 *     — Set when a specific JTI is revoked. Checked by APISIX Lua per request.
 *
 *   user_jtis:<userId>          ZSET  score=expiresAt  member=jti
 *     — Sorted set of all active JTIs for a user. Score is Unix expiry (seconds).
 *     — Used by forced-revoke (SEC-008) to revoke all tokens for a user at once.
 */

import Redis from "ioredis";

const ACCESS_TOKEN_TTL_SECONDS = 3600;

function log(level: "info" | "warn" | "error", msg: string) {
  process.stdout.write(JSON.stringify({ level, msg, ts: Date.now() }) + "\n");
}

let _client: Redis | null = null;

export function getRedis(): Redis | null {
  if (_client) return _client;
  const url = process.env["REDIS_URL"];
  if (!url) return null;

  _client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });

  _client.on("error", (err: Error) => {
    log("warn", `Redis error (JTI revocation non-operational): ${err.message}`);
  });

  _client.on("connect", () => {
    log("info", "Redis connected — JWT revocation active");
  });

  _client.connect().catch(() => {
    log("warn", "Redis unavailable at startup — JWT revocation non-operational until reconnect");
  });

  return _client;
}

/** Record a newly issued JTI so it can be bulk-revoked later (SEC-008). */
export async function trackJti(userId: string, jti: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  await redis.zadd(`user_jtis:${userId}`, expiresAt, jti).catch(() => {});
  // Trim expired members from the set (score < now) to prevent unbounded growth
  await redis.zremrangebyscore(`user_jtis:${userId}`, "-inf", Math.floor(Date.now() / 1000) - 1).catch(() => {});
  // Auto-expire the set itself after 2h (generous buffer over 1h token TTL)
  await redis.expire(`user_jtis:${userId}`, ACCESS_TOKEN_TTL_SECONDS * 2).catch(() => {});
}

/** Revoke a single JTI — written to the revocation set checked by APISIX. */
export async function revokeJti(jti: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(`revoked_jtis:${jti}`, "1", "EX", ACCESS_TOKEN_TTL_SECONDS).catch(() => {});
}

/**
 * Revoke all active JTIs for a user (SEC-008 forced-logout).
 * Returns the count of JTIs revoked.
 */
export async function revokeAllForUser(userId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  const now = Math.floor(Date.now() / 1000);
  const jtis = await redis.zrangebyscore(`user_jtis:${userId}`, now, "+inf").catch(() => [] as string[]);

  if (jtis.length === 0) return 0;

  const pipeline = redis.pipeline();
  for (const jti of jtis) {
    pipeline.set(`revoked_jtis:${jti}`, "1", "EX", ACCESS_TOKEN_TTL_SECONDS);
  }
  pipeline.del(`user_jtis:${userId}`);
  await pipeline.exec().catch(() => {});

  return jtis.length;
}
