"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getBrowserAlerts, type BrowserAlert } from "@/lib/api";

const CELL: React.CSSProperties = { padding: "0.5rem 0.75rem", borderBottom: "1px solid #1e293b", fontSize: "0.875rem", color: "#e2e8f0" };
const HEAD: React.CSSProperties = { ...CELL, color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0f172a" };

function PriorityBadge({ priority }: { priority: string | null }) {
  const colors: Record<string, string> = { Critical: "#7f1d1d", High: "#78350f", Medium: "#1e3a5f", Low: "#1e293b" };
  return <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: colors[priority ?? ""] ?? "#1e293b", color: "#fff" }}>{priority ?? "—"}</span>;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<BrowserAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [resolved, setResolved] = useState("false");
  const [priority, setPriority] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await getBrowserAlerts({
        resolved: resolved || undefined,
        priority: priority || undefined,
        search: search || undefined,
        page,
        pageSize,
      });
      setAlerts(r.alerts);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [resolved, priority, search, page]);

  useEffect(() => { load(); }, [load]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <Link href="/admin/explorer" style={{ color: "#64748b", fontSize: "0.875rem", textDecoration: "none" }}>Explorer</Link>
            <span style={{ color: "#334155" }}>/</span>
            <span style={{ color: "#e2e8f0", fontSize: "0.875rem" }}>Alerts</span>
          </div>
          <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Alerts <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.875rem" }}>({total.toLocaleString()})</span></h2>
        </div>
        <form onSubmit={onSearch} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search message…"
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.625rem", fontSize: "0.875rem", width: "200px" }}
          />
          <select value={resolved} onChange={e => { setResolved(e.target.value); setPage(1); }}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.5rem", fontSize: "0.875rem" }}>
            <option value="false">Open</option>
            <option value="true">Resolved</option>
            <option value="">All</option>
          </select>
          <select value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.5rem", fontSize: "0.875rem" }}>
            <option value="">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <button type="submit" style={{ background: "#1e40af", border: "none", color: "#fff", borderRadius: "4px", padding: "0.375rem 0.875rem", cursor: "pointer", fontSize: "0.875rem" }}>
            Search
          </button>
        </form>
      </div>

      {error && <p style={{ color: "#f87171" }}>{error}</p>}

      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={HEAD}>Priority</th>
              <th style={HEAD}>Message</th>
              <th style={HEAD}>Device</th>
              <th style={HEAD}>Site</th>
              <th style={HEAD}>Timestamp</th>
              {resolved === "true" && <th style={HEAD}>Resolved At</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={resolved === "true" ? 6 : 5} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>Loading…</td></tr>
            ) : alerts.length === 0 ? (
              <tr><td colSpan={resolved === "true" ? 6 : 5} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>No alerts found</td></tr>
            ) : alerts.map((a: BrowserAlert) => (
              <tr key={a.alert_uid}
                style={{ cursor: a.device_uid ? "pointer" : "default" }}
                onClick={() => a.device_uid && (window.location.href = `/admin/explorer/devices/${a.device_uid}`)}
                onMouseEnter={e => a.device_uid && (e.currentTarget.style.background = "#1e293b")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={CELL}><PriorityBadge priority={a.priority} /></td>
                <td style={{ ...CELL, maxWidth: "380px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.alert_message}</td>
                <td style={{ ...CELL, color: "#3b82f6" }}>{a.device_name ?? "—"}</td>
                <td style={{ ...CELL, color: "#94a3b8", fontSize: "0.8125rem" }}>{a.site_name ?? "—"}</td>
                <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{a.alert_timestamp ? new Date(a.alert_timestamp).toLocaleString() : "—"}</td>
                {resolved === "true" && <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{a.resolved_at ? new Date(a.resolved_at).toLocaleString() : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1rem" }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", borderRadius: "4px", padding: "0.375rem 0.75rem", cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1 }}>
            ← Prev
          </button>
          <span style={{ color: "#64748b", padding: "0.375rem 0.5rem", fontSize: "0.875rem" }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", borderRadius: "4px", padding: "0.375rem 0.75rem", cursor: page === totalPages ? "not-allowed" : "pointer", opacity: page === totalPages ? 0.5 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
