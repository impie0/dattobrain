import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";

const ACCESS_TOKEN_TTL = 3600;

function getPrivateKey(): string {
  const raw = process.env["JWT_PRIVATE_KEY"]!;
  // Accept either raw PEM or base64-encoded PEM
  return raw.startsWith("-----") ? raw : Buffer.from(raw, "base64").toString("utf8");
}

function getPublicKey(): string {
  const raw = process.env["JWT_PUBLIC_KEY"]!;
  return raw.startsWith("-----") ? raw : Buffer.from(raw, "base64").toString("utf8");
}

export function signAccessToken(payload: object): string {
  return jwt.sign(payload, getPrivateKey(), { algorithm: "RS256", expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): object {
  return jwt.verify(token, getPublicKey(), { algorithms: ["RS256"] }) as object;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
