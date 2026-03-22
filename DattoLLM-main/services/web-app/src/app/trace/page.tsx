"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getTraces, type ChatTrace } from "@/lib/api";
import Link from "next/link";

export default function TracePage() {
  const router = useRouter();
  const [traces, setTraces] = useState<ChatTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) {
      router.replace("/login");
      return;
    }
    getTraces()
      .then(setTraces)
      .catch(() => setError("Failed to load traces"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div style={{ padding: "2rem", textAlign: "center" }}>Loading traces…</div>;
  if (error) return <div style={{ padding: "2rem", color: "#f87171" }}>{error}</div>;

  return (
    <div style={{ minHeight: "100vh", maxWidth: "960px", margin: "0 auto", padding: "1.5rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Call trace (last 20 chats)</h1>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <Link href="/chat" style={{ color: "#94a3b8", textDecoration: "none" }}>Chat</Link>
          <Link href="/history" style={{ color: "#94a3b8", textDecoration: "none" }}>History</Link>
        </div>
      </header>

      <p style={{ color: "#64748b", marginBottom: "1rem", fontSize: "0.875rem" }}>
        Each row is one chat request. You see the question, role, allowed tools, each MCP tool call (name, args, result snippet), and the answer. Use <strong>MOCK_MCP</strong> and <strong>MOCK_CLAUDE</strong> to test without Datto/Anthropic.
      </p>

      {traces.length === 0 && <p style={{ color: "#64748b" }}>No traces yet. Send a message from Chat to see calls here.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {traces.map((t) => (
          <section
            key={t.id}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "8px",
              padding: "1rem 1.25rem",
              fontFamily: "monospace",
              fontSize: "0.8125rem",
            }}
          >
            <div style={{ marginBottom: "0.75rem", color: "#94a3b8" }}>
              {t.timestamp} · role={t.role} · userId={(t.userId ?? "unknown").slice(0, 8)}… {t.mockMode && <span style={{ color: "#fbbf24" }}>· MOCK</span>}
            </div>
            <div style={{ marginBottom: "0.5rem" }}><strong>Question:</strong> {t.question}</div>
            <div style={{ marginBottom: "0.5rem" }}><strong>Allowed tools:</strong> {t.allowedTools.length ? t.allowedTools.join(", ") : "(none)"}</div>
            {t.toolCalls.length > 0 && (
              <div style={{ marginBottom: "0.5rem" }}>
                <strong>Tool calls:</strong>
                {t.toolCalls.map((c, i) => (
                  <div key={i} style={{ marginLeft: "1rem", marginTop: "0.25rem", padding: "0.5rem", background: "#0f172a", borderRadius: "4px" }}>
                    <span style={{ color: "#34d399" }}>{c.name}</span>({JSON.stringify(c.args)}) → {c.durationMs}ms
                    <pre style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#94a3b8" }}>{c.resultPreview.slice(0, 300)}{c.resultPreview.length > 300 ? "…" : ""}</pre>
                  </div>
                ))}
              </div>
            )}
            <div><strong>Answer:</strong> <span style={{ color: "#e2e8f0" }}>{t.answer.slice(0, 200)}{t.answer.length > 200 ? "…" : ""}</span></div>
          </section>
        ))}
      </div>
    </div>
  );
}
