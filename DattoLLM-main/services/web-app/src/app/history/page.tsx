"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getHistory, type HistoryItem } from "@/lib/api";
import Link from "next/link";

export default function HistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) {
      router.replace("/login");
      return;
    }
    getHistory(50, 0)
      .then((res) => setItems(res.items))
      .catch(() => setError("Failed to load history"))
      .finally(() => setLoading(false));
  }, [router]);

  function handleLogout() {
    document.cookie = "token=; path=/; max-age=0";
    router.replace("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", maxWidth: "800px", margin: "0 auto" }}>
      <header
        style={{
          padding: "1rem 1.5rem",
          borderBottom: "1px solid #334155",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Chat History</h1>
        <div style={{ display: "flex", gap: "1rem" }}>
          <Link href="/trace" style={{ color: "#94a3b8", textDecoration: "none" }}>Trace</Link>
          <Link href="/chat" style={{ color: "#94a3b8", textDecoration: "none" }}>
            Chat
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              background: "transparent",
              border: "1px solid #475569",
              color: "#94a3b8",
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <main style={{ padding: "1.5rem" }}>
        {error && (
          <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>
        )}
        {items.length === 0 && !error && (
          <p style={{ color: "#64748b" }}>No conversations yet.</p>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((item) => (
            <li
              key={item.id}
              style={{
                marginBottom: "1rem",
                padding: "1rem",
                background: "#1e293b",
                borderRadius: "8px",
                border: "1px solid #334155",
              }}
            >
              <Link
                href={`/history/${item.id}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <p
                  style={{
                    margin: "0 0 0.5rem",
                    fontWeight: 600,
                    color: "#e2e8f0",
                  }}
                >
                  {(item.question ?? "Untitled conversation").slice(0, 120)}
                  {(item.question ?? "").length > 120 ? "…" : ""}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.875rem",
                    color: "#94a3b8",
                  }}
                >
                  {new Date(item.created_at).toLocaleString()} · {item.status}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
