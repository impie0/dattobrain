"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getTraceList, type TraceListItem } from "@/lib/api";

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "completed" ? "#22c55e" :
    status === "error" ? "#ef4444" : "#f59e0b";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: "0.75rem", fontWeight: 500, color,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", background: color,
        display: "inline-block",
        animation: status === "in_progress" ? "pulse 1.5s infinite" : undefined,
      }} />
      {status}
    </span>
  );
}

function DurationBadge({ ms }: { ms: number | null }) {
  if (ms === null) return <span style={{ color: "#475569" }}>—</span>;
  const secs = ms / 1000;
  const color = secs < 3 ? "#22c55e" : secs < 10 ? "#f59e0b" : "#ef4444";
  return <span style={{ color, fontWeight: 500 }}>{secs.toFixed(1)}s</span>;
}

export default function TracesListPage() {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const pageSize = 30;

  const load = useCallback(async () => {
    try {
      const data = await getTraceList({ page, pageSize, search: search || undefined, status: statusFilter || undefined });
      setTraces(data.traces);
      setTotal(data.total);
      setLastRefresh(new Date());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { window.location.href = "/login"; return; }
    load();
    const iv = setInterval(load, 10_000);
    return () => clearInterval(iv);
  }, [load]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Breadcrumb + header */}
      <div style={{ marginBottom: "0.5rem" }}>
        <Link href="/admin/observability" style={{ color: "#3b82f6", textDecoration: "none", fontSize: "0.8125rem" }}>
          Observability
        </Link>
        <span style={{ color: "#475569", margin: "0 0.5rem" }}>/</span>
        <span style={{ color: "#94a3b8", fontSize: "0.8125rem" }}>Request Traces</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Request Traces</h2>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginTop: 2 }}>
            Full request journey through all services — {total} traces
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

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder="Search questions..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{
            flex: 1, background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
            padding: "0.5rem 0.75rem", color: "#e2e8f0", fontSize: "0.875rem",
          }}
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={{
            background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
            padding: "0.5rem 0.75rem", color: "#e2e8f0", fontSize: "0.875rem",
          }}
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="error">Error</option>
          <option value="in_progress">In Progress</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {["Time", "User", "Question", "Tools", "Duration", "Spans", "Status"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "0.75rem 1rem", color: "#64748b", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {traces.map(t => (
              <tr key={t.id} style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }}
                onClick={() => window.location.href = `/admin/observability/traces/${t.id}`}
                onMouseEnter={e => (e.currentTarget.style.background = "#1e293b80")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "0.625rem 1rem", color: "#94a3b8", whiteSpace: "nowrap" }}>
                  {new Date(t.createdAt).toLocaleTimeString()}
                  <div style={{ fontSize: "0.625rem", color: "#475569" }}>
                    {new Date(t.createdAt).toLocaleDateString()}
                  </div>
                </td>
                <td style={{ padding: "0.625rem 1rem", color: "#e2e8f0" }}>
                  {t.username ?? "—"}
                </td>
                <td style={{ padding: "0.625rem 1rem", color: "#e2e8f0", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.question ?? "—"}
                </td>
                <td style={{ padding: "0.625rem 1rem", color: t.toolCount > 0 ? "#f59e0b" : "#475569", fontWeight: 500 }}>
                  {t.toolCount}
                </td>
                <td style={{ padding: "0.625rem 1rem" }}>
                  <DurationBadge ms={t.totalDurationMs} />
                </td>
                <td style={{ padding: "0.625rem 1rem", color: "#94a3b8" }}>
                  {t.spanCount}
                </td>
                <td style={{ padding: "0.625rem 1rem" }}>
                  <StatusBadge status={t.status} />
                </td>
              </tr>
            ))}
            {traces.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>
                  No traces found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: "1rem" }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            style={{
              background: "#1e293b", border: "1px solid #334155", borderRadius: 4,
              padding: "0.375rem 0.75rem", color: page <= 1 ? "#475569" : "#e2e8f0",
              cursor: page <= 1 ? "default" : "pointer", fontSize: "0.8125rem",
            }}
          >
            Prev
          </button>
          <span style={{ color: "#94a3b8", fontSize: "0.8125rem", lineHeight: "2rem" }}>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            style={{
              background: "#1e293b", border: "1px solid #334155", borderRadius: 4,
              padding: "0.375rem 0.75rem", color: page >= totalPages ? "#475569" : "#e2e8f0",
              cursor: page >= totalPages ? "default" : "pointer", fontSize: "0.8125rem",
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
