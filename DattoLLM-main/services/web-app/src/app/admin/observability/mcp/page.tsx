"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getObsMcp, ObsMcp, ObsSeries } from "@/lib/api";

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

function LineChart({ series, color = "#ef4444", height = 100 }: {
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    up:       { bg: "#14532d", color: "#22c55e" },
    degraded: { bg: "#78350f", color: "#fb923c" },
    down:     { bg: "#7f1d1d", color: "#f87171" },
    unknown:  { bg: "#1e293b", color: "#94a3b8" },
  };
  const style = map[status] ?? map.unknown;
  return (
    <span style={{ background: style.bg, color: style.color, padding: "3px 10px", borderRadius: 4, fontSize: "0.8125rem", fontWeight: 600 }}>
      {status.toUpperCase()}
    </span>
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

export default function McpPage() {
  const [data, setData]   = useState<ObsMcp | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getObsMcp());
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

  const errSeries = data ? fillHourly(data.errSeries) : [];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: 4 }}>
            <Link href="/admin/observability" style={{ color: "#64748b", textDecoration: "none" }}>Observability</Link>
            {" / "}MCP
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>MCP Server</h2>
        </div>
        {lastRefresh && (
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>Updated {lastRefresh.toLocaleTimeString()}</span>
        )}
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>{error}</div>
      )}

      {/* Status panel + stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Health status */}
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1.25rem", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>Bridge Status</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <StatusBadge status={data?.health.status ?? "unknown"} />
            {data?.health.status === "up" && (
              <span style={{ fontSize: "0.75rem", color: "#22c55e" }}>MCP Bridge reachable</span>
            )}
            {data?.health.status === "down" && (
              <span style={{ fontSize: "0.75rem", color: "#f87171" }}>Bridge not responding</span>
            )}
          </div>
          {data?.health.checked_at && (
            <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
              Checked: {new Date(data.health.checked_at).toLocaleTimeString()}
            </div>
          )}
          <div style={{ borderTop: "1px solid #334155", paddingTop: 12 }}>
            <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: 4 }}>Calls / 5 min</div>
            <div style={{ fontWeight: 700, fontSize: "1.5rem", color: "#3b82f6" }}>{data?.stats.calls5m ?? "—"}</div>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          {[
            { label: "Calls (1h)", value: data?.stats.calls1h ?? "—", color: "#3b82f6" },
            { label: "Errors (1h)", value: data?.stats.errors1h ?? "—", color: data?.stats.errors1h ? "#ef4444" : "#22c55e" },
            { label: "Denied (1h)", value: data?.stats.denied1h ?? "—", color: data?.stats.denied1h ? "#f59e0b" : "#22c55e" },
            { label: "Error Rate", value: `${data?.stats.errorRate ?? 0}%`, color: (data?.stats.errorRate ?? 0) > 10 ? "#ef4444" : (data?.stats.errorRate ?? 0) > 0 ? "#f59e0b" : "#22c55e" },
            { label: "Unique Denied Tools", value: data?.topDenied.length ?? "—", color: "#94a3b8" },
          ].map((card, i) => (
            <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "0.75rem" }}>
              <div style={{ color: "#64748b", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 4 }}>{card.label}</div>
              <div style={{ color: card.color, fontSize: "1.5rem", fontWeight: 700 }}>{card.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Error chart + denied tools */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Errors Over Time — Last 24h</div>
          <LineChart series={errSeries} color="#ef4444" height={100} />
        </div>

        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Top Denied Tools (24h)</div>
          {data?.topDenied.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.topDenied.map((item, i) => {
                const max = data.topDenied[0]?.count ?? 1;
                return (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: "0.75rem", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "70%" }}>{item.tool_name}</span>
                      <span style={{ fontSize: "0.75rem", color: "#f59e0b" }}>{item.count}</span>
                    </div>
                    <div style={{ height: 4, background: "#0f172a", borderRadius: 2 }}>
                      <div style={{ width: `${(item.count / max) * 100}%`, height: "100%", background: "#f59e0b", borderRadius: 2 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div style={{ color: "#475569", fontSize: "0.875rem" }}>No denied calls</div>}
        </div>
      </div>

      {/* Recent errors */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.875rem" }}>
          Recent Errors &amp; Denied Calls (last 50)
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>Tool</th>
                <th style={th}>Type</th>
                <th style={th}>User</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentErrors.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={td}>{new Date(row.created_at).toLocaleString()}</td>
                  <td style={td}><code style={{ fontSize: "0.8125rem", color: "#93c5fd" }}>{row.tool_name ?? "—"}</code></td>
                  <td style={td}>
                    <span style={{
                      background: row.event_type === "tool_error" ? "#7f1d1d" : "#78350f",
                      color: row.event_type === "tool_error" ? "#f87171" : "#fb923c",
                      padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem",
                    }}>
                      {row.event_type.replace("tool_", "")}
                    </span>
                  </td>
                  <td style={td}>{row.username ?? <span style={{ color: "#475569" }}>—</span>}</td>
                  <td style={{ ...td, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.metadata && Object.keys(row.metadata).length > 0
                      ? <span style={{ color: "#64748b", fontSize: "0.75rem" }}>{JSON.stringify(row.metadata).slice(0, 80)}</span>
                      : <span style={{ color: "#475569" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.recentErrors.length && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#22c55e" }}>No errors</div>
          )}
        </div>
      </div>
    </div>
  );
}
