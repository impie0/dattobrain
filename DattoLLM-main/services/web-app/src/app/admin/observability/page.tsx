"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getObsOverview, ObsOverview, ObsSeries } from "@/lib/api";

// ── Shared chart primitives ─────────────────────────────────────────────────

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

function Sparkline({ vals, color = "#3b82f6", h = 44 }: { vals: number[]; color?: string; h?: number }) {
  if (vals.length < 2) return <div style={{ height: h }} />;
  const max = Math.max(...vals, 1);
  const W = 200;
  const pts = vals.map((v, i) =>
    `${(i / (vals.length - 1)) * W},${h - (v / max) * (h - 4) - 2}`
  ).join(" ");
  const fill = `${pts} ${W},${h} 0,${h}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polygon points={fill} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function MultiLineChart({
  series, colors, height = 120,
}: {
  series: { label: string; data: ObsSeries[] }[];
  colors: string[];
  height?: number;
}) {
  if (!series.length || !series[0].data.length) return <div style={{ height }} />;
  const allVals = series.flatMap(s => s.data.map(p => p.v));
  const max = Math.max(...allVals, 1);
  const W = 400;
  const H = height;
  const labels = series[0].data.map(p => new Date(p.t).getHours() + "h");

  return (
    <div style={{ position: "relative" }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        {series.map((s, si) => {
          const pts = s.data.map((p, i) =>
            `${(i / (s.data.length - 1)) * W},${H - (p.v / max) * (H - 8) - 4}`
          ).join(" ");
          return (
            <polyline key={si} points={pts} fill="none"
              stroke={colors[si % colors.length]} strokeWidth="2" strokeLinejoin="round" />
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {labels.filter((_, i) => i % Math.ceil(labels.length / 8) === 0).map((l, i) => (
          <span key={i} style={{ fontSize: "0.625rem", color: "#475569" }}>{l}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        {series.map((s, si) => (
          <span key={si} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.75rem", color: "#94a3b8" }}>
            <span style={{ width: 12, height: 2, background: colors[si % colors.length], display: "inline-block", borderRadius: 1 }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Stat card (clickable or plain) ─────────────────────────────────────────

function StatCard({
  label, value, sub, color = "#3b82f6", href, sparkVals,
}: {
  label: string; value: string | number; sub?: string;
  color?: string; href?: string; sparkVals?: number[];
}) {
  const inner = (
    <div style={{
      background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
      padding: "1rem", height: "100%", boxSizing: "border-box",
      transition: href ? "border-color 0.15s" : undefined,
    }}>
      <div style={{ color: "#94a3b8", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color, fontSize: "1.875rem", fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: "#64748b", fontSize: "0.75rem", marginTop: 4 }}>{sub}</div>}
      {sparkVals && sparkVals.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <Sparkline vals={sparkVals} color={color} h={40} />
        </div>
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", display: "block" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

// ── Drill-down card ─────────────────────────────────────────────────────────

function DrillCard({
  href, title, description, metrics,
}: {
  href: string; title: string; description: string;
  metrics: { label: string; value: string | number }[];
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div style={{
        background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
        padding: "1.25rem", cursor: "pointer", transition: "border-color 0.15s",
      }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = "#3b82f6")}
        onMouseLeave={e => (e.currentTarget.style.borderColor = "#334155")}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
            <div style={{ color: "#94a3b8", fontSize: "0.8125rem" }}>{description}</div>
          </div>
          <span style={{ color: "#475569", fontSize: "1.25rem" }}>→</span>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
          {metrics.map((m, i) => (
            <div key={i}>
              <div style={{ color: "#64748b", fontSize: "0.6875rem", textTransform: "uppercase" }}>{m.label}</div>
              <div style={{ fontWeight: 600, fontSize: "1.125rem" }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function ObservabilityPage() {
  const [data, setData]       = useState<ObsOverview | null>(null);
  const [error, setError]     = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getObsOverview();
      setData(d);
      setLastRefresh(new Date());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { window.location.href = "/login"; return; }
    load();
    const iv = setInterval(load, 10_000);
    return () => clearInterval(iv);
  }, [load]);

  const reqVals  = data ? fillHourly(data.series.requests).map(p => p.v)  : [];
  const tcVals   = data ? fillHourly(data.series.toolCalls).map(p => p.v) : [];
  const errVals  = data ? fillHourly(data.series.errors).map(p => p.v)    : [];
  const filled   = data ? fillHourly(data.series.requests)  : [];

  const totalSessions = data ? Object.values(data.cacheMode).reduce((a, b) => a + b, 0) : 0;
  const cachedPct = totalSessions > 0
    ? Math.round(((data?.cacheMode["cached"] ?? 0) / totalSessions) * 100)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Observability</h2>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginTop: 2 }}>
            System health and usage metrics
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {lastRefresh && (
            <span style={{ color: "#475569", fontSize: "0.75rem" }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.75rem", color: "#22c55e" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            Auto-refresh 10s
          </span>
        </div>
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        <StatCard
          label="Requests (last 1h)" value={data?.requests.last1h ?? "—"}
          sub={`${data?.requests.last5m ?? 0}/5m · ${data?.requests.last24h ?? 0}/24h`}
          color="#3b82f6" sparkVals={reqVals}
        />
        <StatCard
          label="Active Sessions" value={data?.activeSessions ?? "—"}
          sub="Updated in last 15 min" color="#8b5cf6"
        />
        <StatCard
          label="Tokens (24h)" value={data ? (data.tokens.last24h / 1000).toFixed(1) + "k" : "—"}
          sub={`Avg ${data?.tokens.avg ?? 0} per message`} color="#06b6d4"
        />
        <StatCard
          label="Tool Calls (last 1h)" value={data?.toolCalls.last1h ?? "—"}
          sub={`${data?.toolCalls.last5m ?? 0}/5m`}
          color="#f59e0b" sparkVals={tcVals}
        />
        <StatCard
          label="Errors (last 1h)" value={data?.errors.last1h ?? "—"}
          sub={`${data?.errors.last24h ?? 0} in last 24h`}
          color={data && data.errors.last1h > 0 ? "#ef4444" : "#22c55e"}
          sparkVals={errVals}
        />
        <StatCard
          label="Cache Mode (24h)" value={`${cachedPct}% cached`}
          sub={`${data?.cacheMode["live"] ?? 0} live sessions`}
          color="#10b981"
        />
      </div>

      {/* 24h charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Request & Tool Volume — Last 24h</div>
          <MultiLineChart
            series={[
              { label: "Requests", data: filled },
              { label: "Tool Calls", data: data ? fillHourly(data.series.toolCalls) : [] },
            ]}
            colors={["#3b82f6", "#f59e0b"]}
            height={120}
          />
        </div>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Errors — Last 24h</div>
          <MultiLineChart
            series={[{ label: "Errors", data: data ? fillHourly(data.series.errors) : [] }]}
            colors={["#ef4444"]}
            height={120}
          />
        </div>
      </div>

      {/* Drill-down cards */}
      <div style={{ fontWeight: 600, marginBottom: "0.75rem", color: "#94a3b8", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Drill-Down Dashboards
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <DrillCard
          href="/admin/observability/llm"
          title="LLM / Tokens"
          description="Token usage, model breakdown, request logs"
          metrics={[
            { label: "Requests 24h", value: data?.requests.last24h ?? "—" },
            { label: "Tokens 24h", value: data ? Math.round(data.tokens.last24h / 1000) + "k" : "—" },
          ]}
        />
        <DrillCard
          href="/admin/observability/tools"
          title="Tool Calls"
          description="Usage frequency, error rates, recent calls"
          metrics={[
            { label: "Calls 1h", value: data?.toolCalls.last1h ?? "—" },
            { label: "Errors 1h", value: data?.errors.last1h ?? "—" },
          ]}
        />
        <DrillCard
          href="/admin/observability/mcp"
          title="MCP Server"
          description="Bridge health, denied calls, error breakdown"
          metrics={[
            { label: "Errors 1h", value: data?.errors.last1h ?? "—" },
            { label: "Errors 24h", value: data?.errors.last24h ?? "—" },
          ]}
        />
        <DrillCard
          href="/admin/observability/chat"
          title="Chat / Usage"
          description="Active sessions, message volume, session list"
          metrics={[
            { label: "Active", value: data?.activeSessions ?? "—" },
            { label: "Messages 24h", value: "—" },
          ]}
        />
        <DrillCard
          href="/admin/observability/cache"
          title="Cache"
          description="Sync history, table record counts, cache vs live"
          metrics={[
            { label: "Cached (24h)", value: `${data?.cacheMode["cached"] ?? 0}` },
            { label: "Live (24h)", value: `${data?.cacheMode["live"] ?? 0}` },
          ]}
        />
      </div>
    </div>
  );
}
