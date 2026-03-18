"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getBrowserSite, type BrowserDevice, type BrowserAlert } from "@/lib/api";

const CELL: React.CSSProperties = { padding: "0.5rem 0.75rem", borderBottom: "1px solid #1e293b", fontSize: "0.875rem", color: "#e2e8f0" };
const HEAD: React.CSSProperties = { ...CELL, color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0f172a" };

function OnlineBadge({ online }: { online: boolean | null }) {
  if (online === null) return <span style={{ color: "#64748b" }}>—</span>;
  return <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: online ? "#166534" : "#7f1d1d", color: "#fff" }}>{online ? "Online" : "Offline"}</span>;
}

function PriorityBadge({ priority }: { priority: string | null }) {
  const colors: Record<string, string> = { Critical: "#7f1d1d", High: "#78350f", Medium: "#1e3a5f", Low: "#1e293b" };
  return <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: colors[priority ?? ""] ?? "#1e293b", color: "#fff" }}>{priority ?? "—"}</span>;
}

type Tab = "devices" | "alerts" | "variables";

export default function SiteDetailPage() {
  const { uid } = useParams() as { uid: string };
  const [data, setData] = useState<Awaited<ReturnType<typeof getBrowserSite>> | null>(null);
  const [tab, setTab] = useState<Tab>("devices");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deviceSearch, setDeviceSearch] = useState("");

  useEffect(() => {
    getBrowserSite(uid)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [uid]);

  const filteredDevices = (data?.devices ?? []).filter(d =>
    !deviceSearch || d.hostname.toLowerCase().includes(deviceSearch.toLowerCase())
  );

  const site = data?.site;

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link href="/admin/explorer" style={{ color: "#64748b", textDecoration: "none" }}>Explorer</Link>
        <span style={{ color: "#334155" }}>/</span>
        <Link href="/admin/explorer/sites" style={{ color: "#64748b", textDecoration: "none" }}>Sites</Link>
        <span style={{ color: "#334155" }}>/</span>
        <span style={{ color: "#e2e8f0" }}>{site?.name ?? uid}</span>
      </div>

      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}

      {site && (
        <>
          {/* Site header */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1.25rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#e2e8f0" }}>{site.name as string}</h2>
                {site.description && <p style={{ margin: "0.25rem 0 0", color: "#64748b", fontSize: "0.875rem" }}>{site.description as string}</p>}
                {site.autotask_company_name && <p style={{ margin: "0.25rem 0 0", color: "#94a3b8", fontSize: "0.8125rem" }}>Autotask: {site.autotask_company_name as string}</p>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", textAlign: "center" }}>
                {[
                  { label: "Devices", value: site.device_count as number ?? data.devices.length, color: "#e2e8f0" },
                  { label: "Online", value: site.online_count as number ?? 0, color: "#4ade80" },
                  { label: "Alerts", value: data.alerts.length, color: data.alerts.length > 0 ? "#fb923c" : "#64748b" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#1e293b", borderRadius: "6px", padding: "0.5rem 0.75rem" }}>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: s.color }}>{String(s.value)}</div>
                    <div style={{ fontSize: "0.6875rem", color: "#64748b" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #1e293b", marginBottom: "1rem" }}>
            {([["devices", `Devices (${data.devices.length})`], ["alerts", `Open Alerts (${data.alerts.length})`], ["variables", `Variables (${data.variables.length})`]] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                style={{ background: "none", border: "none", borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent", color: tab === t ? "#e2e8f0" : "#64748b", padding: "0.625rem 1rem", cursor: "pointer", fontSize: "0.875rem", fontWeight: tab === t ? 600 : 400, marginBottom: "-1px" }}>
                {label}
              </button>
            ))}
          </div>

          {/* Devices tab */}
          {tab === "devices" && (
            <>
              <input value={deviceSearch} onChange={e => setDeviceSearch(e.target.value)}
                placeholder="Filter by hostname…"
                style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.625rem", fontSize: "0.875rem", width: "240px", marginBottom: "0.75rem" }} />
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Hostname", "Status", "Type", "OS", "Last Seen", "IP"].map(h => (
                        <th key={h} style={HEAD}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDevices.length === 0 ? (
                      <tr><td colSpan={6} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>No devices</td></tr>
                    ) : filteredDevices.map((d: BrowserDevice) => (
                      <tr key={d.uid} style={{ cursor: "pointer" }}
                        onClick={() => window.location.href = `/admin/explorer/devices/${d.uid}`}
                        onMouseEnter={e => (e.currentTarget.style.background = "#1e293b")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ ...CELL, color: "#3b82f6", fontWeight: 500 }}>{d.hostname}</td>
                        <td style={CELL}><OnlineBadge online={d.online} /></td>
                        <td style={{ ...CELL, color: "#94a3b8" }}>{d.device_class ?? "—"}</td>
                        <td style={{ ...CELL, color: "#94a3b8", fontSize: "0.8125rem" }}>{d.operating_system ?? "—"}</td>
                        <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{d.last_seen ? new Date(d.last_seen).toLocaleString() : "—"}</td>
                        <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem", fontFamily: "monospace" }}>{d.int_ip_address ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Alerts tab */}
          {tab === "alerts" && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Priority", "Message", "Device", "Timestamp"].map(h => (
                      <th key={h} style={HEAD}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.alerts.length === 0 ? (
                    <tr><td colSpan={4} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>No open alerts</td></tr>
                  ) : data.alerts.map((a: BrowserAlert) => (
                    <tr key={a.alert_uid}
                      style={{ cursor: a.device_uid ? "pointer" : "default" }}
                      onClick={() => a.device_uid && (window.location.href = `/admin/explorer/devices/${a.device_uid}`)}
                      onMouseEnter={e => a.device_uid && (e.currentTarget.style.background = "#1e293b")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={CELL}><PriorityBadge priority={a.priority} /></td>
                      <td style={{ ...CELL, maxWidth: "400px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.alert_message}</td>
                      <td style={{ ...CELL, color: "#3b82f6" }}>{a.device_name ?? "—"}</td>
                      <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{a.alert_timestamp ? new Date(a.alert_timestamp).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Variables tab */}
          {tab === "variables" && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={HEAD}>Variable</th>
                    <th style={HEAD}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.variables.length === 0 ? (
                    <tr><td colSpan={2} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>No variables</td></tr>
                  ) : data.variables.map(v => (
                    <tr key={v.name}>
                      <td style={{ ...CELL, color: "#94a3b8", fontWeight: 500, width: "200px" }}>{v.name}</td>
                      <td style={{ ...CELL, fontFamily: v.masked ? "inherit" : "monospace", color: v.masked ? "#475569" : "#e2e8f0" }}>{v.value ?? "—"}</td>
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
