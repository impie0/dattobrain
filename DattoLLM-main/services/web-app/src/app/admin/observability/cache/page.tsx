"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getObsCache, ObsCache } from "@/lib/api";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    completed: { bg: "#14532d", color: "#22c55e" },
    running:   { bg: "#1e3a5f", color: "#93c5fd" },
    failed:    { bg: "#7f1d1d", color: "#f87171" },
  };
  const style = map[status] ?? { bg: "#1e293b", color: "#94a3b8" };
  return (
    <span style={{ background: style.bg, color: style.color, padding: "2px 7px", borderRadius: 4, fontSize: "0.75rem", fontWeight: 600 }}>
      {status}
    </span>
  );
}

function fmtDuration(secs: number | null): string {
  if (secs == null) return "—";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function fmtDate(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString();
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

export default function CachePage() {
  const [data, setData]   = useState<ObsCache | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getObsCache());
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

  const totalMode   = data ? Object.values(data.modeDistrib).reduce((a, b) => a + b, 0) : 0;
  const cachedCount = data?.modeDistrib["cached"] ?? 0;
  const liveCount   = data?.modeDistrib["live"]   ?? 0;
  const cachedPct   = totalMode > 0 ? Math.round((cachedCount / totalMode) * 100) : 0;

  const lastSync = data?.syncHistory.find(s => s.status === "completed") ?? null;
  const maxCount = data ? Math.max(...data.tableCounts.map(t => t.count), 1) : 1;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: 4 }}>
            <Link href="/admin/observability" style={{ color: "#64748b", textDecoration: "none" }}>Observability</Link>
            {" / "}Cache
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Cache</h2>
        </div>
        {lastRefresh && (
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>Updated {lastRefresh.toLocaleTimeString()}</span>
        )}
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>{error}</div>
      )}

      {/* Top row: last sync status + cache mode ratio */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {/* Last sync */}
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ color: "#94a3b8", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 8 }}>Last Successful Sync</div>
          {lastSync ? (
            <>
              <div style={{ marginBottom: 6 }}>
                <StatusBadge status={lastSync.status} />
              </div>
              <div style={{ color: "#e2e8f0", fontSize: "0.875rem", marginBottom: 4 }}>
                {fmtDate(lastSync.completed_at)}
              </div>
              <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                Duration: {fmtDuration(lastSync.duration_secs)}
              </div>
              <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                {lastSync.sites_synced} sites · {lastSync.devices_synced} devices
              </div>
            </>
          ) : (
            <div style={{ color: "#475569" }}>No completed sync found</div>
          )}
        </div>

        {/* Cache vs Live */}
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ color: "#94a3b8", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 8 }}>Mode Distribution (all sessions)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ color: "#10b981", fontSize: "1.875rem", fontWeight: 700 }}>{cachedPct}%</span>
            <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>cached</span>
          </div>
          {/* Simple bar */}
          <div style={{ height: 8, background: "#0f172a", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ width: `${cachedPct}%`, height: "100%", background: "#10b981", borderRadius: 4 }} />
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: "0.75rem" }}>
            <span style={{ color: "#10b981" }}>{cachedCount} cached</span>
            <span style={{ color: "#fb923c" }}>{liveCount} live</span>
          </div>
        </div>

        {/* Total records */}
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem" }}>
          <div style={{ color: "#94a3b8", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 8 }}>Total Cached Records</div>
          <div style={{ color: "#3b82f6", fontSize: "1.875rem", fontWeight: 700 }}>
            {data ? data.tableCounts.reduce((a, t) => a + t.count, 0).toLocaleString() : "—"}
          </div>
          <div style={{ color: "#64748b", fontSize: "0.75rem", marginTop: 4 }}>
            across {data?.tableCounts.length ?? 0} cache tables
          </div>
        </div>
      </div>

      {/* Table record counts */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: "0.875rem" }}>Cache Table Record Counts</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data?.tableCounts.map((row, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 120, fontSize: "0.8125rem", color: "#93c5fd", flexShrink: 0 }}>{row.name}</div>
              <div style={{ flex: 1, height: 18, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  width: `${(row.count / maxCount) * 100}%`,
                  height: "100%",
                  background: "#3b82f6",
                  borderRadius: 3,
                  transition: "width 0.3s",
                  display: "flex", alignItems: "center",
                }}>
                  {row.count > 0 && <span style={{ fontSize: "0.625rem", color: "#fff", paddingLeft: 4 }}>{row.count.toLocaleString()}</span>}
                </div>
              </div>
              <div style={{ width: 60, fontSize: "0.75rem", color: "#64748b", textAlign: "right" }}>
                {row.count.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sync history table */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.875rem" }}>
          Sync History (last 20)
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Started</th>
                <th style={th}>Status</th>
                <th style={th}>Trigger</th>
                <th style={{ ...th, textAlign: "right" }}>Sites</th>
                <th style={{ ...th, textAlign: "right" }}>Devices</th>
                <th style={{ ...th, textAlign: "right" }}>Alerts</th>
                <th style={{ ...th, textAlign: "right" }}>Audit Errs</th>
                <th style={th}>Duration</th>
                <th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {data?.syncHistory.map((row, i) => (
                <tr key={row.id} style={{ background: i % 2 === 0 ? "transparent" : "#0f172a" }}>
                  <td style={td}>{fmtDate(row.started_at)}</td>
                  <td style={td}><StatusBadge status={row.status} /></td>
                  <td style={td}>
                    <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>{row.triggered_by}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{row.sites_synced}</td>
                  <td style={{ ...td, textAlign: "right" }}>{row.devices_synced}</td>
                  <td style={{ ...td, textAlign: "right" }}>{row.alerts_open_synced}</td>
                  <td style={{ ...td, textAlign: "right", color: row.audit_errors > 0 ? "#f59e0b" : "#22c55e" }}>
                    {row.audit_errors}
                  </td>
                  <td style={td}>{fmtDuration(row.duration_secs)}</td>
                  <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.error
                      ? <span style={{ color: "#f87171", fontSize: "0.75rem" }}>{row.error.slice(0, 60)}</span>
                      : row.last_api_error
                      ? <span style={{ color: "#f59e0b", fontSize: "0.75rem" }}>{row.last_api_error.slice(0, 60)}</span>
                      : <span style={{ color: "#22c55e", fontSize: "0.75rem" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.syncHistory.length && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No sync history</div>
          )}
        </div>
      </div>
    </div>
  );
}
