"use client";

import { useState, useEffect, useCallback } from "react";
import { getSyncStatus, triggerSync, pauseSync, resumeSync } from "@/lib/api";

interface SyncCounts {
  sites: number;
  devices: number;
  devices_audited: number;
  software_entries: number;
  esxi_hosts: number;
  printers: number;
  open_alerts: number;
  resolved_alerts: number;
  users: number;
  components: number;
  default_filters: number;
  custom_filters: number;
}

interface SyncLog {
  id: string;
  started_at: string;
  completed_at: string | null;
  triggered_by: string;
  status: string;
  error: string | null;
  last_api_error: string | null;
  audit_errors: number;
  sites_synced: number;
  devices_synced: number;
  alerts_open_synced: number;
  alerts_resolved_synced: number;
  device_audits_synced: number;
}

interface SyncStatus {
  lastFull: SyncLog | null;
  lastAlerts: SyncLog | null;
  counts: SyncCounts;
  paused: boolean;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    completed: "#16a34a",
    running: "#2563eb",
    failed: "#dc2626",
  };
  return (
    <span
      style={{
        fontSize: "0.7rem",
        fontWeight: 700,
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: "4px",
        background: colors[status] ?? "#475569",
        color: "#fff",
        letterSpacing: "0.04em",
      }}
    >
      {status}
    </span>
  );
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function duration(log: SyncLog) {
  if (!log.completed_at) return "running…";
  const ms = new Date(log.completed_at).getTime() - new Date(log.started_at).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const CELL: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #1e293b",
  fontSize: "0.875rem",
  color: "#e2e8f0",
};

const LABEL: React.CSSProperties = {
  ...CELL,
  color: "#94a3b8",
  fontWeight: 600,
  width: "180px",
};

export default function DataSyncPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<"full" | "alerts" | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await getSyncStatus() as SyncStatus;
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleTogglePause() {
    if (!status) return;
    setToggling(true);
    setError("");
    try {
      if (status.paused) {
        await resumeSync();
      } else {
        await pauseSync();
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle sync");
    } finally {
      setToggling(false);
    }
  }

  async function handleSync(type: "full" | "alerts") {
    setSyncing(type);
    setError("");
    try {
      await triggerSync(type);
      // Poll until status changes to completed/failed
      const poll = setInterval(async () => {
        const s = await getSyncStatus().catch(() => null) as SyncStatus | null;
        if (s) {
          setStatus(s);
          const last = s.lastFull as SyncLog | null;
          if (last?.status !== "running") {
            clearInterval(poll);
            setSyncing(null);
          }
        }
      }, 3000);
      // Safety timeout after 10 min
      setTimeout(() => { clearInterval(poll); setSyncing(null); }, 600000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setSyncing(null);
    }
  }

  const c = status?.counts;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Data Sync</h2>
          <p style={{ margin: "0.25rem 0 0", color: "#64748b", fontSize: "0.875rem" }}>
            Datto RMM data cached locally. AI uses local cache by default; use Live mode for real-time data.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => handleSync("alerts")}
            disabled={!!syncing || !!status?.paused}
            style={{
              padding: "0.5rem 1rem",
              background: syncing === "alerts" ? "#1e293b" : "#1e3a5f",
              border: "1px solid #2563eb",
              color: "#93c5fd",
              borderRadius: "6px",
              cursor: (syncing || status?.paused) ? "not-allowed" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
              opacity: status?.paused ? 0.4 : 1,
            }}
          >
            {syncing === "alerts" ? "Syncing alerts…" : "⚡ Sync Alerts"}
          </button>
          <button
            type="button"
            onClick={() => handleSync("full")}
            disabled={!!syncing || !!status?.paused}
            style={{
              padding: "0.5rem 1rem",
              background: syncing === "full" ? "#1e293b" : "#1e40af",
              border: "none",
              color: "#fff",
              borderRadius: "6px",
              cursor: (syncing || status?.paused) ? "not-allowed" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
              opacity: status?.paused ? 0.4 : 1,
            }}
          >
            {syncing === "full" ? "Running full sync…" : "↺ Full Sync Now"}
          </button>
          <button
            type="button"
            onClick={handleTogglePause}
            disabled={toggling || !status}
            style={{
              padding: "0.5rem 1rem",
              background: status?.paused ? "#431407" : "#1e293b",
              border: `1px solid ${status?.paused ? "#ea580c" : "#475569"}`,
              color: status?.paused ? "#fb923c" : "#94a3b8",
              borderRadius: "6px",
              cursor: (toggling || !status) ? "not-allowed" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            {status?.paused ? "▶ Resume Sync" : "⏸ Pause Sync"}
          </button>
        </div>
      </div>

      {status?.paused && (
        <div style={{
          background: "#431407",
          border: "1px solid #ea580c",
          borderRadius: "6px",
          padding: "0.625rem 1rem",
          marginBottom: "1rem",
          color: "#fb923c",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}>
          ⏸ Sync is paused — scheduled syncs are skipped until resumed. Manual syncs are also disabled.
        </div>
      )}
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}
      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}

      {status && (
        <>
          {/* Last sync info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            {[
              { label: "Last Full Sync", log: status.lastFull },
              { label: "Last Alert Sync", log: status.lastAlerts },
            ].map(({ label, log }) => (
              <div key={label} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
                  {label}
                </div>
                {log ? (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      <tr><td style={LABEL}>Status</td><td style={CELL}>{statusBadge(log.status)}</td></tr>
                      <tr><td style={LABEL}>Started</td><td style={CELL}>{fmtDate(log.started_at)}</td></tr>
                      <tr><td style={LABEL}>Completed</td><td style={CELL}>{fmtDate(log.completed_at)}</td></tr>
                      <tr><td style={LABEL}>Duration</td><td style={CELL}>{duration(log)}</td></tr>
                      {log.triggered_by && <tr><td style={LABEL}>Triggered by</td><td style={CELL}>{log.triggered_by}</td></tr>}
                      {log.error && <tr><td style={LABEL}>Error</td><td style={{ ...CELL, color: "#f87171", wordBreak: "break-word" }}>{log.error}</td></tr>}
                      {log.audit_errors > 0 && <tr><td style={LABEL}>Audit errors</td><td style={{ ...CELL, color: "#fb923c" }}>{log.audit_errors} device{log.audit_errors !== 1 ? "s" : ""} failed</td></tr>}
                      {log.last_api_error && !log.error && <tr><td style={LABEL}>Last API error</td><td style={{ ...CELL, color: "#fb923c", wordBreak: "break-word", maxWidth: "320px" }}>{log.last_api_error}</td></tr>}
                      {log.devices_synced > 0 && <tr><td style={LABEL}>Devices synced</td><td style={CELL}>{log.devices_synced.toLocaleString()}</td></tr>}
                      {log.alerts_open_synced > 0 && <tr><td style={LABEL}>Open alerts</td><td style={CELL}>{log.alerts_open_synced.toLocaleString()}</td></tr>}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ color: "#475569", fontSize: "0.875rem", margin: 0 }}>No sync run yet.</p>
                )}
              </div>
            ))}
          </div>

          {/* Record counts */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "1rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.875rem" }}>
              Cached Record Counts
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem" }}>
              {c && [
                { label: "Sites", value: c.sites },
                { label: "Devices", value: c.devices },
                { label: "Audited devices", value: c.devices_audited },
                { label: "Software entries", value: c.software_entries },
                { label: "ESXi hosts", value: c.esxi_hosts },
                { label: "Printers", value: c.printers },
                { label: "Open alerts", value: c.open_alerts },
                { label: "Resolved alerts", value: c.resolved_alerts },
                { label: "Datto users", value: c.users },
                { label: "Components", value: c.components },
                { label: "Default filters", value: c.default_filters },
                { label: "Custom filters", value: c.custom_filters },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "#1e293b", borderRadius: "6px", padding: "0.75rem" }}>
                  <div style={{ fontSize: "0.6875rem", color: "#64748b", marginBottom: "0.25rem" }}>{label}</div>
                  <div style={{ fontSize: "1.375rem", fontWeight: 700, color: "#e2e8f0" }}>
                    {value?.toLocaleString() ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#475569" }}>
            Full sync runs automatically daily at 02:00 UTC. Alert sync runs every hour.
          </div>
        </>
      )}
    </div>
  );
}
