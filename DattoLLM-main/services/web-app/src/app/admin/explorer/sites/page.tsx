"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getBrowserSites, type BrowserSite } from "@/lib/api";

const CELL: React.CSSProperties = { padding: "0.5rem 0.75rem", borderBottom: "1px solid #1e293b", fontSize: "0.875rem", color: "#e2e8f0" };
const HEAD: React.CSSProperties = { ...CELL, color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0f172a" };

export default function SitesPage() {
  const [sites, setSites] = useState<BrowserSite[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await getBrowserSites({ search, page, pageSize });
      setSites(r.sites);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sites");
    } finally {
      setLoading(false);
    }
  }, [search, page]);

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
            <span style={{ color: "#e2e8f0", fontSize: "0.875rem" }}>Sites</span>
          </div>
          <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Sites <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.875rem" }}>({total.toLocaleString()})</span></h2>
        </div>
        <form onSubmit={onSearch} style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search sites…"
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.625rem", fontSize: "0.875rem", width: "200px" }}
          />
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
              <th style={HEAD}>Site Name</th>
              <th style={{ ...HEAD, textAlign: "right" }}>Devices</th>
              <th style={{ ...HEAD, textAlign: "right" }}>Online</th>
              <th style={{ ...HEAD, textAlign: "right" }}>Offline</th>
              <th style={HEAD}>Autotask Company</th>
              <th style={HEAD}>Last Synced</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>Loading…</td></tr>
            ) : sites.length === 0 ? (
              <tr><td colSpan={6} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>No sites found</td></tr>
            ) : sites.map(site => (
              <tr key={site.uid}
                style={{ cursor: "pointer" }}
                onClick={() => window.location.href = `/admin/explorer/sites/${site.uid}`}
                onMouseEnter={e => (e.currentTarget.style.background = "#1e293b")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={{ ...CELL, color: "#3b82f6", fontWeight: 500 }}>{site.name}</td>
                <td style={{ ...CELL, textAlign: "right" }}>{site.device_count?.toLocaleString() ?? "—"}</td>
                <td style={{ ...CELL, textAlign: "right", color: "#4ade80" }}>{site.online_count?.toLocaleString() ?? "—"}</td>
                <td style={{ ...CELL, textAlign: "right", color: site.offline_count ? "#f87171" : "#64748b" }}>{site.offline_count?.toLocaleString() ?? "—"}</td>
                <td style={{ ...CELL, color: "#94a3b8" }}>{site.autotask_company_name ?? "—"}</td>
                <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{new Date(site.synced_at).toLocaleString()}</td>
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
