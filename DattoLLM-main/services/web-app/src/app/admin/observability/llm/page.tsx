"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getObsLlm, ObsLlm, ObsSeries } from "@/lib/api";

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

function abbrev(model: string | null | undefined): string {
  if (!model) return "—";
  return model
    .replace("claude-haiku-4-5-20251001", "Haiku 4.5")
    .replace("claude-sonnet-4-5", "Sonnet 4.5")
    .replace("claude-opus-4-6", "Opus 4.6")
    .replace("deepseek/deepseek-r1", "DeepSeek R1")
    .replace("deepseek/deepseek-chat", "DeepSeek Chat")
    .replace("gemini/gemini-2.0-flash", "Gemini Flash");
}

function modelColor(model: string | null | undefined): string {
  if (!model) return "#475569";
  if (model.includes("opus")) return "#7c3aed";
  if (model.includes("sonnet")) return "#2563eb";
  if (model.includes("haiku")) return "#0891b2";
  if (model.includes("deepseek")) return "#16a34a";
  if (model.includes("gemini")) return "#dc2626";
  return "#475569";
}

function LineChart({ series, color = "#3b82f6", height = 100 }: {
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
          <span key={i} style={{ fontSize: "0.625rem", color: "#475569" }}>
            {new Date(p.t).getHours()}h
          </span>
        ))}
      </div>
    </div>
  );
}

function HBarChart({ items, color = "#3b82f6" }: { items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 120, fontSize: "0.75rem", color: "#94a3b8", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.label}
          </div>
          <div style={{ flex: 1, height: 16, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${(item.value / max) * 100}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <div style={{ width: 40, fontSize: "0.75rem", color: "#64748b", textAlign: "right" }}>{item.value}</div>
        </div>
      ))}
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

export default function LlmPage() {
  const [data, setData]   = useState<ObsLlm | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getObsLlm());
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

  const tokenSeries = data ? fillHourly(data.tokenSeries) : [];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: 4 }}>
            <Link href="/admin/observability" style={{ color: "#64748b", textDecoration: "none" }}>Observability</Link>
            {" / "}LLM
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>LLM / Tokens</h2>
        </div>
        {lastRefresh && (
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Requests", value: data?.summary.total ?? "—", color: "#3b82f6" },
          { label: "Requests (24h)", value: data?.summary.total24h ?? "—", color: "#8b5cf6" },
          { label: "Tokens (24h)", value: data ? Math.round(tokenSeries.reduce((a, b) => a + b.v, 0) / 1000) + "k" : "—", color: "#06b6d4" },
        ].map((card, i) => (
          <div key={i} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{card.label}</div>
            <div style={{ color: card.color, fontSize: "1.875rem", fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Token chart */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Token Usage — Last 24h</div>
        <LineChart series={tokenSeries} color="#06b6d4" height={100} />
      </div>

      {/* Model breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Orchestrator Models (24h)</div>
          {data?.byOrchModel.length ? (
            <HBarChart
              items={data.byOrchModel.map(m => ({ label: abbrev(m.model), value: m.count }))}
              color="#3b82f6"
            />
          ) : <div style={{ color: "#475569", fontSize: "0.875rem" }}>No data</div>}
        </div>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Synthesizer Models (24h)</div>
          {data?.bySynthModel.length ? (
            <HBarChart
              items={data.bySynthModel.map(m => ({ label: abbrev(m.model), value: m.count }))}
              color="#8b5cf6"
            />
          ) : <div style={{ color: "#475569", fontSize: "0.875rem" }}>No data</div>}
        </div>
      </div>

      {/* Recent table */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.875rem" }}>
          Last 100 LLM Requests
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>User</th>
                <th style={th}>Orchestrator</th>
                <th style={th}>Synthesizer</th>
                <th style={th}>Tools Called</th>
                <th style={th}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {data?.recent.map((row, i) => (
                <tr key={row.id} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={td}>{new Date(row.created_at).toLocaleString()}</td>
                  <td style={td}>{row.username ?? <span style={{ color: "#475569" }}>—</span>}</td>
                  <td style={td}>
                    <span style={{ background: modelColor(row.orchestrator_model) + "22", color: modelColor(row.orchestrator_model), padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem" }}>
                      {abbrev(row.orchestrator_model)}
                    </span>
                  </td>
                  <td style={td}>
                    {row.synthesizer_model ? (
                      <span style={{ background: modelColor(row.synthesizer_model) + "22", color: modelColor(row.synthesizer_model), padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem" }}>
                        {abbrev(row.synthesizer_model)}
                      </span>
                    ) : <span style={{ color: "#475569" }}>—</span>}
                  </td>
                  <td style={td}>
                    {row.tools_called?.length
                      ? <span style={{ color: "#f59e0b" }}>{row.tools_called.length}</span>
                      : <span style={{ color: "#475569" }}>0</span>}
                  </td>
                  <td style={td}>
                    {row.tokens != null
                      ? <span style={{ color: "#06b6d4" }}>{row.tokens.toLocaleString()}</span>
                      : <span style={{ color: "#475569" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.recent.length && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No data</div>
          )}
        </div>
      </div>
    </div>
  );
}
