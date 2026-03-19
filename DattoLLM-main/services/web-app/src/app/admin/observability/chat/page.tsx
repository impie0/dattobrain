"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getObsChat, ObsChat, ObsSeries } from "@/lib/api";

function fillHourly(series: ObsSeries[], hours = 24): ObsSeries[] {
  const now = new Date();
  const buckets: ObsSeries[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const t = new Date(now);
    t.setMinutes(0, 0, 0);
    t.setHours(t.getHours() - i);
    buckets.push({ t: t.toISOString(), v: 0 });
  }
  for (const pt of series) {
    const d = new Date(pt.t);
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    const idx = buckets.findIndex(b => new Date(b.t).toISOString() === key);
    if (idx >= 0) buckets[idx].v = pt.v;
  }
  return buckets;
}

function LineChart({ series, color = "#8b5cf6", height = 100 }: {
  series: ObsSeries[]; color?: string; height?: number;
}) {
  if (series.length < 2) return <div style={{ height }} />;
  const max = Math.max(...series.map(p => p.v), 1);
  const W = 400; const H = height;
  const pts = series.map((p, i) =>
    `${(i / (series.length - 1)) * W},${H - (p.v / max) * (H - 8) - 4}`
  ).join(" ");
  const fill = `${pts} ${W},${H} 0,${H}`;
  const labels = series.filter((_, i) => i % Math.ceil(series.length / 8) === 0);
  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <polygon points={fill} fill={color} opacity="0.1" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {labels.map((p, i) => (
          <span key={i} style={{ fontSize: "0.625rem", color: "#475569" }}>{new Date(p.t).getHours()}h</span>
        ))}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.75rem", textAlign: "left", color: "#64748b",
  fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase",
  borderBottom: "1px solid #334155", whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "0.5rem 0.75rem", fontSize: "0.8125rem",
  borderBottom: "1px solid #1e293b", whiteSpace: "nowrap",
};

function dateBadge(dt: string) {
  const diff = (Date.now() - new Date(dt).getTime()) / 1000;
  if (diff < 60)  return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return new Date(dt).toLocaleTimeString();
}

export default function ChatPage() {
  const [data, setData]   = useState<ObsChat | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getObsChat());
      setLastRefresh(new Date());
      setError("");
    } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { window.location.href = "/login"; return; }
    load();
    const iv = setInterval(load, 10_000);
    return () => clearInterval(iv);
  }, [load]);

  const msgSeries = data ? fillHourly(data.msgSeries) : [];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: 4 }}>
            <Link href="/admin/observability" style={{ color: "#64748b", textDecoration: "none" }}>Observability</Link>
            {" / "}Chat
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Chat / Usage</h2>
        </div>
        {lastRefresh && (
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>Updated {lastRefresh.toLocaleTimeString()}</span>
        )}
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>{error}</div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Sessions (24h)", value: data?.summary.sessions24h ?? "—", color: "#8b5cf6" },
          { label: "Messages (24h)", value: data?.summary.messages24h ?? "—", color: "#3b82f6" },
          { label: "Active Now (15m)", value: data?.summary.active15m ?? "—", color: "#22c55e" },
          { label: "Avg Msgs / Session", value: data?.summary.avgMsgsPerSession ?? "—", color: "#94a3b8" },
        ].map((card, i) => (
          <div key={i} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: "1.875rem", fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Message volume chart */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Message Volume — Last 24h</div>
        <LineChart series={msgSeries} color="#8b5cf6" height={100} />
      </div>

      {/* Active sessions table */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Active Sessions (last 15 min)</span>
          <span style={{ background: "#1e3a5f", color: "#93c5fd", padding: "2px 8px", borderRadius: 4, fontSize: "0.75rem" }}>
            {data?.activeSessions.length ?? 0} sessions
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Session ID</th>
                <th style={th}>User</th>
                <th style={th}>Mode</th>
                <th style={{ ...th, textAlign: "right" }}>Messages</th>
                <th style={th}>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {data?.activeSessions.map((session, i) => (
                <tr key={session.id} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={td}>
                    <code style={{ fontSize: "0.75rem", color: "#475569" }}>{session.id.slice(0, 8)}…</code>
                  </td>
                  <td style={td}>{session.username ?? <span style={{ color: "#475569" }}>—</span>}</td>
                  <td style={td}>
                    <span style={{
                      background: session.data_mode === "live" ? "#78350f" : "#1e3a5f",
                      color: session.data_mode === "live" ? "#fb923c" : "#93c5fd",
                      padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem",
                    }}>
                      {session.data_mode}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "#e2e8f0" }}>{session.message_count}</td>
                  <td style={{ ...td, color: "#94a3b8" }}>{dateBadge(session.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.activeSessions.length && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No active sessions</div>
          )}
        </div>
      </div>
    </div>
  );
}
