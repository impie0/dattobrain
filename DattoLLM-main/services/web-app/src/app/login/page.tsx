"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token } = await login(username, password);
      document.cookie = `token=${encodeURIComponent(token)}; path=/; max-age=${24 * 60 * 60}; SameSite=Strict`;
      router.push("/chat");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "360px",
          background: "#1e293b",
          borderRadius: "12px",
          padding: "2rem",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        <h1 style={{ margin: "0 0 1.5rem", fontSize: "1.5rem" }}>
          Datto RMM AI Chat
        </h1>
        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            style={{
              width: "100%",
              padding: "0.75rem",
              marginBottom: "1rem",
              border: "1px solid #334155",
              borderRadius: "8px",
              background: "#0f172a",
              color: "#e2e8f0",
            }}
          />
          <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{
              width: "100%",
              padding: "0.75rem",
              marginBottom: "1rem",
              border: "1px solid #334155",
              borderRadius: "8px",
              background: "#0f172a",
              color: "#e2e8f0",
            }}
          />
          {error && (
            <p style={{ color: "#f87171", fontSize: "0.875rem", marginBottom: "1rem" }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
