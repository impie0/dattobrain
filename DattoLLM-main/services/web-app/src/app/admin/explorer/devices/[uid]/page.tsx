"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getBrowserDevice, getBrowserDeviceSoftware, type BrowserAlert } from "@/lib/api";

const CELL: React.CSSProperties = { padding: "0.5rem 0.75rem", borderBottom: "1px solid #1e293b", fontSize: "0.875rem", color: "#e2e8f0" };
const HEAD: React.CSSProperties = { ...CELL, color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0f172a" };
const KV_LABEL: React.CSSProperties = { color: "#64748b", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" };
const KV_VALUE: React.CSSProperties = { color: "#e2e8f0", fontSize: "0.875rem", marginTop: "0.125rem" };

function OnlineBadge({ online }: { online: boolean | null }) {
  if (online === null) return <span style={{ color: "#64748b" }}>—</span>;
  return <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "4px", background: online ? "#166534" : "#7f1d1d", color: "#fff" }}>{online ? "Online" : "Offline"}</span>;
}

function PriorityBadge({ priority }: { priority: string | null }) {
  const colors: Record<string, string> = { Critical: "#7f1d1d", High: "#78350f", Medium: "#1e3a5f", Low: "#1e293b" };
  return <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: colors[priority ?? ""] ?? "#1e293b", color: "#fff" }}>{priority ?? "—"}</span>;
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={KV_LABEL}>{label}</div>
      <div style={KV_VALUE}>{value ?? "—"}</div>
    </div>
  );
}

function fmtBytes(mb: number | null) {
  if (mb == null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

type Tab = "overview" | "audit" | "software" | "alerts";

export default function DeviceDetailPage() {
  const { uid } = useParams() as { uid: string };
  const [data, setData] = useState<Awaited<ReturnType<typeof getBrowserDevice>> | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Software tab
  const [software, setSoftware] = useState<{ name: string; version: string | null; publisher: string | null; install_date: string | null; cve_count?: number; max_severity?: string | null }[]>([]);
  const [softwareTotal, setSoftwareTotal] = useState(0);
  const [softwarePage, setSoftwarePage] = useState(1);
  const [softwareSearch, setSoftwareSearch] = useState("");
  const [softwareSearchInput, setSoftwareSearchInput] = useState("");
  const [softwareLoading, setSoftwareLoading] = useState(false);

  useEffect(() => {
    getBrowserDevice(uid)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [uid]);

  const loadSoftware = useCallback(async () => {
    setSoftwareLoading(true);
    try {
      const r = await getBrowserDeviceSoftware(uid, { search: softwareSearch || undefined, page: softwarePage, pageSize: 50 });
      setSoftware(r.software);
      setSoftwareTotal(r.total);
    } finally {
      setSoftwareLoading(false);
    }
  }, [uid, softwareSearch, softwarePage]);

  useEffect(() => {
    if (tab === "software") loadSoftware();
  }, [tab, loadSoftware]);

  const d = data?.device as Record<string, unknown> | undefined;
  const alerts = data?.alerts ?? [];
  const openAlerts = alerts.filter((a: BrowserAlert) => !a.resolved);
  const resolvedAlerts = alerts.filter((a: BrowserAlert) => a.resolved);
  const softwareTotalPages = Math.ceil(softwareTotal / 50);

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link href="/admin/explorer" style={{ color: "#64748b", textDecoration: "none" }}>Explorer</Link>
        <span style={{ color: "#334155" }}>/</span>
        {d?.site_name ? (
          <>
            <Link href={`/admin/explorer/sites/${d.site_uid as string}`} style={{ color: "#64748b", textDecoration: "none" }}>{d.site_name as string}</Link>
            <span style={{ color: "#334155" }}>/</span>
          </>
        ) : (
          <>
            <Link href="/admin/explorer/devices" style={{ color: "#64748b", textDecoration: "none" }}>Devices</Link>
            <span style={{ color: "#334155" }}>/</span>
          </>
        )}
        <span style={{ color: "#e2e8f0" }}>{d ? (d.hostname as string) : uid}</span>
      </div>

      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}

      {d && (
        <>
          {/* Device header */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1.25rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#e2e8f0" }}>{d.hostname as string}</h2>
                  <OnlineBadge online={d.online as boolean | null} />
                  {!!d.reboot_required && <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: "#78350f", color: "#fff" }}>Reboot Required</span>}
                </div>
                <p style={{ margin: "0.25rem 0 0", color: "#64748b", fontSize: "0.875rem" }}>{d.operating_system as string ?? "—"}{d.display_version ? ` (${d.display_version})` : ""}</p>
                {!!d.site_name && <p style={{ margin: "0.25rem 0 0", color: "#94a3b8", fontSize: "0.8125rem" }}>Site: {d.site_name as string}</p>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", textAlign: "center" }}>
                {[
                  { label: "Type", value: (d.device_class as string ?? "—") },
                  { label: "Alerts", value: String(openAlerts.length), color: openAlerts.length > 0 ? "#fb923c" : "#e2e8f0" },
                  { label: "IP", value: (d.int_ip_address as string ?? "—"), mono: true },
                ].map(s => (
                  <div key={s.label} style={{ background: "#1e293b", borderRadius: "6px", padding: "0.5rem 0.75rem" }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: s.color ?? "#e2e8f0", fontFamily: s.mono ? "monospace" : "inherit" }}>{s.value}</div>
                    <div style={{ fontSize: "0.6875rem", color: "#64748b" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #1e293b", marginBottom: "1rem" }}>
            {([["overview", "Overview"], ["audit", "Hardware Audit"], ["software", `Software (${softwareTotal > 0 ? softwareTotal : "…"})`], ["alerts", `Alerts (${alerts.length})`]] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                style={{ background: "none", border: "none", borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent", color: tab === t ? "#e2e8f0" : "#64748b", padding: "0.625rem 1rem", cursor: "pointer", fontSize: "0.875rem", fontWeight: tab === t ? 600 : 400, marginBottom: "-1px" }}>
                {label}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {tab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>Identity</div>
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <KV label="UID" value={<span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{d.uid as string}</span>} />
                  <KV label="Hostname" value={d.hostname as string} />
                  <KV label="Device Class" value={d.device_class as string} />
                  <KV label="Device Type" value={d.device_type as string} />
                  <KV label="Internal IP" value={<span style={{ fontFamily: "monospace" }}>{d.int_ip_address as string}</span>} />
                  <KV label="External IP" value={<span style={{ fontFamily: "monospace" }}>{d.ext_ip_address as string}</span>} />
                  <KV label="Last Seen" value={d.last_seen ? new Date(d.last_seen as string).toLocaleString() : null} />
                </div>
              </div>
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>Status</div>
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <KV label="Online" value={<OnlineBadge online={d.online as boolean | null} />} />
                  <KV label="Reboot Required" value={d.reboot_required ? <span style={{ color: "#fb923c" }}>Yes</span> : "No"} />
                  <KV label="AV Status" value={d.av_status as string} />
                  <KV label="Patch Status" value={d.patch_status as string} />
                  <KV label="OS" value={d.operating_system as string} />
                  <KV label="Version" value={d.display_version as string} />
                </div>
              </div>
            </div>
          )}

          {/* Hardware Audit tab */}
          {tab === "audit" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              {/* CPU */}
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>CPU</div>
                {d.cpu_description ? (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <KV label="Description" value={d.cpu_description as string} />
                    <KV label="Cores" value={d.cpu_cores as number} />
                    <KV label="Processors" value={d.cpu_processors as number} />
                    <KV label="Speed" value={d.cpu_speed_mhz ? `${d.cpu_speed_mhz} MHz` : null} />
                  </div>
                ) : <p style={{ color: "#475569", fontSize: "0.875rem" }}>No audit data</p>}
              </div>
              {/* RAM & Storage */}
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>Memory & Storage</div>
                {d.ram_total_mb ? (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <KV label="RAM" value={fmtBytes(d.ram_total_mb as number)} />
                    <KV label="Drives" value={d.drive_count as number} />
                    <KV label="Total Storage" value={d.total_storage_gb ? `${d.total_storage_gb} GB` : null} />
                    <KV label="Free Storage" value={d.free_storage_gb ? `${d.free_storage_gb} GB` : null} />
                    <KV label="NICs" value={d.nic_count as number} />
                  </div>
                ) : <p style={{ color: "#475569", fontSize: "0.875rem" }}>No audit data</p>}
              </div>
              {/* BIOS */}
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>BIOS</div>
                {d.bios_manufacturer ? (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <KV label="Manufacturer" value={d.bios_manufacturer as string} />
                    <KV label="Version" value={d.bios_version as string} />
                    <KV label="Release Date" value={d.bios_release_date as string} />
                  </div>
                ) : <p style={{ color: "#475569", fontSize: "0.875rem" }}>No audit data</p>}
              </div>
              {/* OS Info */}
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>Operating System</div>
                {d.os_name ? (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <KV label="Name" value={d.os_name as string} />
                    <KV label="Build" value={d.os_build as string} />
                    <KV label="Install Date" value={d.os_install_date as string} />
                  </div>
                ) : <p style={{ color: "#475569", fontSize: "0.875rem" }}>No audit data</p>}
              </div>
              {/* ESXi */}
              {d.vm_count != null && (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>ESXi</div>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <KV label="VMs" value={d.vm_count as number} />
                    <KV label="Datastores" value={d.datastore_count as number} />
                  </div>
                </div>
              )}
              {/* Printer */}
              {d.printer_model != null && (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>Printer</div>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <KV label="Model" value={d.printer_model as string} />
                    <KV label="Pages Printed" value={d.page_count as number} />
                    <KV label="Black Toner" value={d.toner_black_pct != null ? `${d.toner_black_pct}%` : null} />
                    <KV label="Cyan Toner" value={d.toner_cyan_pct != null ? `${d.toner_cyan_pct}%` : null} />
                    <KV label="Magenta Toner" value={d.toner_magenta_pct != null ? `${d.toner_magenta_pct}%` : null} />
                    <KV label="Yellow Toner" value={d.toner_yellow_pct != null ? `${d.toner_yellow_pct}%` : null} />
                    <KV label="Drum" value={d.drum_pct != null ? `${d.drum_pct}%` : null} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Software tab */}
          {tab === "software" && (
            <>
              <form onSubmit={e => { e.preventDefault(); setSoftwareSearch(softwareSearchInput); setSoftwarePage(1); }}
                style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <input value={softwareSearchInput} onChange={e => setSoftwareSearchInput(e.target.value)}
                  placeholder="Search software…"
                  style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "4px", color: "#e2e8f0", padding: "0.375rem 0.625rem", fontSize: "0.875rem", width: "240px" }} />
                <button type="submit" style={{ background: "#1e40af", border: "none", color: "#fff", borderRadius: "4px", padding: "0.375rem 0.875rem", cursor: "pointer", fontSize: "0.875rem" }}>Search</button>
              </form>
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["Name", "Version", "CVEs", "Severity", "Publisher"].map(h => <th key={h} style={HEAD}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {softwareLoading ? (
                      <tr><td colSpan={5} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>Loading…</td></tr>
                    ) : software.length === 0 ? (
                      <tr><td colSpan={5} style={{ ...CELL, textAlign: "center", color: "#64748b" }}>No software records</td></tr>
                    ) : software.map((s, i) => {
                      const cveCount = s.cve_count ?? 0;
                      const sev = (s.max_severity ?? "").toUpperCase();
                      const sevColor = sev === "CRITICAL" ? "#dc2626" : sev === "HIGH" ? "#f97316" : sev === "MEDIUM" ? "#eab308" : cveCount > 0 ? "#3b82f6" : "#334155";
                      const sevLabel = sev === "CRITICAL" ? "Critical" : sev === "HIGH" ? "High" : sev === "MEDIUM" ? "Medium" : sev === "LOW" ? "Low" : "";
                      return (
                        <tr key={i} style={{ background: cveCount > 0 && sev === "CRITICAL" ? "#1a0505" : cveCount > 0 && sev === "HIGH" ? "#1a0f05" : "" }}>
                          <td style={{ ...CELL, fontWeight: 500 }}>
                            {cveCount > 0 ? (
                              <Link href={`/admin/explorer/vulnerabilities?software=${encodeURIComponent(s.name)}`} style={{ color: "#60a5fa", textDecoration: "none" }}>{s.name}</Link>
                            ) : s.name}
                          </td>
                          <td style={{ ...CELL, color: "#94a3b8", fontFamily: "monospace", fontSize: "0.8125rem" }}>{s.version ?? "—"}</td>
                          <td style={{ ...CELL, textAlign: "center" }}>
                            {cveCount > 0 ? (
                              <Link href={`/admin/explorer/vulnerabilities?software=${encodeURIComponent(s.name)}`} style={{ textDecoration: "none" }}>
                                <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: sevColor, color: "#fff" }}>{cveCount}</span>
                              </Link>
                            ) : <span style={{ color: "#334155" }}>—</span>}
                          </td>
                          <td style={CELL}>
                            {sevLabel ? <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: sevColor, color: "#fff" }}>{sevLabel}</span> : <span style={{ color: "#334155" }}>—</span>}
                          </td>
                          <td style={{ ...CELL, color: "#94a3b8" }}>{s.publisher ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {softwareTotalPages > 1 && (
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "1rem" }}>
                  <button onClick={() => setSoftwarePage(p => Math.max(1, p - 1))} disabled={softwarePage === 1}
                    style={{ background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", borderRadius: "4px", padding: "0.375rem 0.75rem", cursor: softwarePage === 1 ? "not-allowed" : "pointer", opacity: softwarePage === 1 ? 0.5 : 1 }}>
                    ← Prev
                  </button>
                  <span style={{ color: "#64748b", padding: "0.375rem 0.5rem", fontSize: "0.875rem" }}>Page {softwarePage} of {softwareTotalPages}</span>
                  <button onClick={() => setSoftwarePage(p => Math.min(softwareTotalPages, p + 1))} disabled={softwarePage === softwareTotalPages}
                    style={{ background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", borderRadius: "4px", padding: "0.375rem 0.75rem", cursor: softwarePage === softwareTotalPages ? "not-allowed" : "pointer", opacity: softwarePage === softwareTotalPages ? 0.5 : 1 }}>
                    Next →
                  </button>
                </div>
              )}
            </>
          )}

          {/* Alerts tab */}
          {tab === "alerts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {openAlerts.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#fb923c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Open Alerts ({openAlerts.length})</div>
                  <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Priority", "Message", "Timestamp"].map(h => <th key={h} style={HEAD}>{h}</th>)}</tr></thead>
                      <tbody>
                        {openAlerts.map((a: BrowserAlert) => (
                          <tr key={a.alert_uid}>
                            <td style={CELL}><PriorityBadge priority={a.priority} /></td>
                            <td style={{ ...CELL, maxWidth: "500px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.alert_message}</td>
                            <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{a.alert_timestamp ? new Date(a.alert_timestamp).toLocaleString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {resolvedAlerts.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Resolved ({resolvedAlerts.length})</div>
                  <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Priority", "Message", "Resolved At"].map(h => <th key={h} style={HEAD}>{h}</th>)}</tr></thead>
                      <tbody>
                        {resolvedAlerts.map((a: BrowserAlert) => (
                          <tr key={a.alert_uid}>
                            <td style={CELL}><PriorityBadge priority={a.priority} /></td>
                            <td style={{ ...CELL, color: "#64748b", maxWidth: "500px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.alert_message}</td>
                            <td style={{ ...CELL, color: "#64748b", fontSize: "0.8125rem" }}>{a.resolved_at ? new Date(a.resolved_at).toLocaleString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {alerts.length === 0 && <p style={{ color: "#64748b" }}>No alerts for this device.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
