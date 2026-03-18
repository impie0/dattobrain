"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserOverview, type BrowserOverview } from "@/lib/api";

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: "8px", padding: "1rem" }}>
      <div style={{ fontSize: "0.6875rem", color: "#64748b", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, color: color ?? "#e2e8f0" }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: "0.25rem" }}>{sub}</div>}
    </div>
  );
}

function NavCard({ href, label, desc, count }: { href: string; label: string; desc: string; count?: number }) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1.25rem", cursor: "pointer", transition: "border-color 0.15s" }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = "#2563eb")}
        onMouseLeave={e => (e.currentTarget.style.borderColor = "#1e293b")}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: "0.9375rem" }}>{label}</div>
          {count !== undefined && (
            <div style={{ background: "#1e293b", color: "#94a3b8", fontSize: "0.75rem", fontWeight: 700, padding: "2px 8px", borderRadius: "12px" }}>
              {count.toLocaleString()}
            </div>
          )}
        </div>
        <div style={{ color: "#64748b", fontSize: "0.8125rem", marginTop: "0.375rem" }}>{desc}</div>
      </div>
    </Link>
  );
}

export default function ExplorerPage() {
  const [overview, setOverview] = useState<BrowserOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getBrowserOverview()
      .then(setOverview)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const c = overview?.counts;

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Data Explorer</h2>
        <p style={{ margin: "0.25rem 0 0", color: "#64748b", fontSize: "0.875rem" }}>
          Browse the local Datto RMM cache — sites, devices, audits, alerts.
        </p>
      </div>

      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}

      {overview && c && (
        <>
          {/* Sync status banner */}
          {overview.lastSync && (
            <div style={{
              background: overview.lastSync.status === "completed" ? "#0d2818" : "#1c0a0a",
              border: `1px solid ${overview.lastSync.status === "completed" ? "#166534" : "#7f1d1d"}`,
              borderRadius: "6px", padding: "0.625rem 1rem", marginBottom: "1.5rem",
              display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.8125rem",
            }}>
              <span style={{
                fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                padding: "2px 6px", borderRadius: "4px",
                background: overview.lastSync.status === "completed" ? "#166534" : "#991b1b",
                color: "#fff",
              }}>
                {overview.lastSync.status}
              </span>
              <span style={{ color: "#94a3b8" }}>
                Last sync: {new Date(overview.lastSync.started_at).toLocaleString()}
                {overview.lastSync.audit_errors > 0 && <span style={{ color: "#fb923c", marginLeft: "0.75rem" }}>⚠ {overview.lastSync.audit_errors} audit errors</span>}
              </span>
              <Link href="/admin/data-sync" style={{ marginLeft: "auto", color: "#3b82f6", fontSize: "0.75rem" }}>Sync settings →</Link>
            </div>
          )}

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <StatCard label="Sites" value={c.sites} />
            <StatCard label="Devices" value={c.devices} sub={`${c.devices_online.toLocaleString()} online · ${c.devices_offline.toLocaleString()} offline`} />
            <StatCard label="Online" value={c.devices_online} color="#4ade80" />
            <StatCard label="Offline" value={c.devices_offline} color="#f87171" />
            <StatCard label="Open Alerts" value={c.open_alerts} color={c.open_alerts > 0 ? "#fb923c" : "#e2e8f0"} sub={`${c.critical_alerts} critical · ${c.high_alerts} high`} />
            <StatCard label="Workstations" value={c.workstations} />
            <StatCard label="ESXi Hosts" value={c.esxi_hosts} />
            <StatCard label="Printers" value={c.printers} />
            <StatCard label="Software Records" value={c.software_entries} />
            <StatCard label="Audited Devices" value={c.audited_devices} />
          </div>

          {/* Navigation cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <NavCard href="/admin/explorer/sites" label="Sites" desc="Browse all sites, view devices and alerts per site" count={c.sites} />
            <NavCard href="/admin/explorer/devices" label="Devices" desc="Search and filter all devices, view hardware audits and software" count={c.devices} />
            <NavCard href="/admin/explorer/alerts" label="Alerts" desc="Browse open and resolved alerts, filter by site or priority" count={c.open_alerts} />
          </div>

          {/* Top sites */}
          {overview.topSites.length > 0 && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
                Top Sites by Device Count
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Site", "Devices", "Online", "Offline"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "0.375rem 0.75rem", fontSize: "0.75rem", color: "#64748b", borderBottom: "1px solid #1e293b", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overview.topSites.map(site => (
                    <tr key={site.uid} style={{ cursor: "pointer" }}
                      onClick={() => window.location.href = `/admin/explorer/sites/${site.uid}`}
                      onMouseEnter={e => (e.currentTarget.style.background = "#1e293b")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#3b82f6", borderBottom: "1px solid #0f172a" }}>{site.name}</td>
                      <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#e2e8f0", borderBottom: "1px solid #0f172a" }}>{site.device_count?.toLocaleString() ?? "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#4ade80", borderBottom: "1px solid #0f172a" }}>{site.online_count?.toLocaleString() ?? "—"}</td>
                      <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#f87171", borderBottom: "1px solid #0f172a" }}>{site.offline_count?.toLocaleString() ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
