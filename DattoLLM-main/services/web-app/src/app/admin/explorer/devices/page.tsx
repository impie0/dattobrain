"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getBrowserDevices, type BrowserDevice } from "@/lib/api";

const CELL: React.CSSProperties = { padding: "0.5rem 0.75rem", borderBottom: "1px solid #1e293b", fontSize: "0.875rem", color: "#e2e8f0" };
const HEAD: React.CSSProperties = { ...CELL, color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0f172a" };

function OnlineBadge({ online }: { online: boolean | null }) {
  if (online === null) return <span style={{ color: "#64748b" }}>—</span>;
  return <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: online ? "#166534" : "#7f1d1d", color: "#fff" }}>{online ? "Online" : "Offline"}</span>;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<BrowserDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter state
  const [hostnameInput, setHostnameInput] = useState("");
  const [hostname, setHostname] = useState("");
  const [online, setOnline] = useState("");
  const [deviceClass, setDeviceClass] = useState("");

  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await getBrowserDevices({
        hostname: hostname || undefined,
        online: online || undefined,
        deviceClass: deviceClass || undefined,
        page,
        pageSize,
      });
      setDevices(r.devices);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, [hostname, online, deviceClass, page]);

  useEffect(() => { load(); }, [load]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setHostname(hostnameInput);
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
            <span style={{ color: "#e2e8f0", fontSize: "0.875rem" }}>Devices</span>
          </div>
          <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Devices <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.875rem" }}>({total.toLocaleString()})</span></h2>
        </div>
        <form onSubmit={onSearch} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            value={hostnameInput}
            onChange={e => setHostnameInput(e.target.value)}
            placeholder="Search hostname…"
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.625rem", fontSize: "0.875rem", width: "180px" }}
          />
          <select value={online} onChange={e => { setOnline(e.target.value); setPage(1); }}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.5rem", fontSize: "0.875rem" }}>
            <option value="">All Status</option>
            <option value="true">Online</option>
            <option value="false">Offline</option>
          </select>
          <select value={deviceClass} onChange={e => { setDeviceClass(e.target.value); setPage(1); }}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.5rem", fontSize: "0.875rem" }}>
            <option value="">All Types</option>
            <option value="Desktop">Desktop</option>
            <option value="Laptop">Laptop</option>
            <option value="Server">Server</option>
            <option value="ESXi">ESXi</option>
            <option value="Printer">Printer</option>
            <option value="Workstation">Workstation</option>
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
              <th style={HEAD}>Hostname</th>
              <th style={HEAD}>Status</th>
              <th style={HEAD}>Type</th>
              <th style={HEAD}>OS</th>
              <th style={HEAD}>Site</th>
              <th style={HEAD}>Last Seen</th>
              <th style={HEAD}>IP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>Loading…</td></tr>
            ) : devices.length === 0 ? (
              <tr><td colSpan={7} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>No devices found</td></tr>
            ) : devices.map((d: BrowserDevice) => (
              <tr key={d.uid}
                style={{ cursor: "pointer" }}
                onClick={() => window.location.href = `/admin/explorer/devices/${d.uid}`}
                onMouseEnter={e => (e.currentTarget.style.background = "#1e293b")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={{ ...CELL, color: "#3b82f6", fontWeight: 500 }}>{d.hostname}</td>
                <td style={CELL}><OnlineBadge online={d.online} /></td>
                <td style={{ ...CELL, color: "#94a3b8" }}>{d.device_class ?? "—"}</td>
                <td style={{ ...CELL, color: "#94a3b8", fontSize: "0.8125rem" }}>{d.operating_system ?? "—"}</td>
                <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{d.site_name ?? "—"}</td>
                <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{d.last_seen ? new Date(d.last_seen).toLocaleString() : "—"}</td>
                <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem", fontFamily: "monospace" }}>{d.int_ip_address ?? "—"}</td>
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
