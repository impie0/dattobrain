"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getObsTools, ObsTools, ObsSeries } from "@/lib/api";

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

function LineChart({ series, color = "#f59e0b", height = 100 }: {
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

function errorRateBadge(rate: number) {
  const color = rate === 0 ? "#22c55e" : rate < 10 ? "#f59e0b" : "#ef4444";
  const bg    = rate === 0 ? "#14532d" : rate < 10 ? "#78350f" : "#7f1d1d";
  return (
    <span style={{ background: bg, color, padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem", fontWeight: 600 }}>
      {rate}%
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

export default function ToolsPage() {
  const [data, setData]   = useState<ObsTools | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getObsTools());
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

  const callSeries = data ? fillHourly(data.callSeries) : [];
  const totalCalls   = data?.topTools.reduce((a, t) => a + t.calls, 0) ?? 0;
  const totalErrors  = data?.topTools.reduce((a, t) => a + t.errors, 0) ?? 0;
  const overallRate  = totalCalls > 0 ? Math.round((totalErrors / totalCalls) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: 4 }}>
            <Link href="/admin/observability" style={{ color: "#64748b", textDecoration: "none" }}>Observability</Link>
            {" / "}Tools
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Tool Calls</h2>
        </div>
        {lastRefresh && (
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>Updated {lastRefresh.toLocaleTimeString()}</span>
        )}
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>{error}</div>
      )}

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Calls (24h)", value: totalCalls, color: "#f59e0b" },
          { label: "Total Errors (24h)", value: totalErrors, color: totalErrors > 0 ? "#ef4444" : "#22c55e" },
          { label: "Error Rate", value: `${overallRate}%`, color: overallRate > 10 ? "#ef4444" : overallRate > 0 ? "#f59e0b" : "#22c55e" },
        ].map((card, i) => (
          <div key={i} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: "1.875rem", fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Chart + top tools side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Tool Calls Over Time — Last 24h</div>
          <LineChart series={callSeries} color="#f59e0b" height={100} />
        </div>

        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Top Tools (24h)</div>
          <div style={{ overflowY: "auto", maxHeight: 140 }}>
            {data?.topTools.map((tool, i) => {
              const maxCalls = data.topTools[0]?.calls ?? 1;
              return (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ fontSize: "0.75rem", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{tool.tool_name}</span>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>{tool.calls} calls</span>
                  </div>
                  <div style={{ height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(tool.calls / maxCalls) * 100}%`, height: "100%", background: "#f59e0b", borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top tools table */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden", marginBottom: "1.5rem" }}>
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.875rem" }}>
          Tool Usage Breakdown (24h)
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Tool</th>
                <th style={{ ...th, textAlign: "right" }}>Calls</th>
                <th style={{ ...th, textAlign: "right" }}>Errors</th>
                <th style={{ ...th, textAlign: "right" }}>Error Rate</th>
              </tr>
            </thead>
            <tbody>
              {data?.topTools.map((tool, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={td}><code style={{ fontSize: "0.8125rem", color: "#93c5fd" }}>{tool.tool_name}</code></td>
                  <td style={{ ...td, textAlign: "right", color: "#f59e0b" }}>{tool.calls.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: "right", color: tool.errors > 0 ? "#ef4444" : "#22c55e" }}>{tool.errors}</td>
                  <td style={{ ...td, textAlign: "right" }}>{errorRateBadge(tool.error_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.topTools.length && <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No data</div>}
        </div>
      </div>

      {/* Recent calls table */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.875rem" }}>
          Last 100 Tool Events
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>Tool</th>
                <th style={th}>User</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.recent.map((row, i) => (
                <tr key={row.id} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={td}>{new Date(row.created_at).toLocaleString()}</td>
                  <td style={td}><code style={{ fontSize: "0.8125rem", color: "#93c5fd" }}>{row.tool_name ?? "—"}</code></td>
                  <td style={td}>{row.username ?? <span style={{ color: "#475569" }}>—</span>}</td>
                  <td style={td}>
                    {row.event_type === "tool_call"
                      ? <span style={{ background: "#14532d", color: "#22c55e", padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem" }}>ok</span>
                      : <span style={{ background: "#7f1d1d", color: "#f87171", padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem" }}>{row.event_type.replace("tool_", "")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.recent.length && <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No data</div>}
        </div>
      </div>
    </div>
  );
}
