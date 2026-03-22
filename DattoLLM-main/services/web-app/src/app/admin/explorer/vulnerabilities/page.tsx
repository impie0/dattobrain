"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────

interface VulnSummary {
  totals: { total: number; critical: number; high: number; medium: number; low: number };
  topSoftware: { name: string; cve_count: number; device_count: number; worst_score: string | number | null }[];
  topSites: { site_name: string; device_count: number; critical_count: number; high_count: number }[];
  lastSync: { started_at: string; completed_at: string | null; status: string; cves_added: number; matches_found: number } | null;
}

interface VulnRow {
  hostname: string; device_uid: string; site_name: string | null; site_uid: string | null;
  software_name: string; software_version: string | null;
  cve_id: string; cvss_v3_score: string | number | null; severity: string;
  match_confidence: number; found_at: string; description: string | null;
}

// ── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_URL ?? "") : "";

function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function apiFetch(path: string): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Read URL params once at module level (SSR-safe) ─────────────────────────

function getInitialParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

// ── Styles ───────────────────────────────────────────────────────────────────

const CELL: React.CSSProperties = { padding: "0.5rem 0.75rem", borderBottom: "1px solid #334155", fontSize: "0.8125rem", color: "#e2e8f0" };
const HEAD: React.CSSProperties = { ...CELL, color: "#64748b", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em", background: "#0f172a", position: "sticky" as const, top: 0, zIndex: 1 };
const LINK: React.CSSProperties = { color: "#60a5fa", textDecoration: "none", cursor: "pointer" };
const CARD: React.CSSProperties = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8 };
const INPUT: React.CSSProperties = { background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", padding: "0.35rem 0.6rem", fontSize: "0.8125rem", width: "100%" };
const SELECT: React.CSSProperties = { ...INPUT, cursor: "pointer", appearance: "auto" as const };

const SEV: Record<string, { bg: string; label: string }> = {
  CRITICAL: { bg: "#991b1b", label: "Critical" },
  HIGH: { bg: "#c2410c", label: "High" },
  MEDIUM: { bg: "#a16207", label: "Medium" },
  LOW: { bg: "#1e40af", label: "Low" },
};

function SevBadge({ s }: { s: string }) {
  const c = SEV[s.toUpperCase()] ?? { bg: "#334155", label: s };
  return <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: c.bg, color: "#fff" }}>{c.label}</span>;
}

function CvssBadge({ score }: { score: string | number | null }) {
  const n = typeof score === "string" ? parseFloat(score) : score;
  if (n == null || isNaN(n)) return <span style={{ color: "#475569" }}>—</span>;
  const bg = n >= 9 ? "#991b1b" : n >= 7 ? "#c2410c" : n >= 4 ? "#a16207" : "#1e40af";
  return <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: bg, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{n.toFixed(1)}</span>;
}

function SeverityCard({ label, count, color, active, onClick }: { label: string; count: number; color: string; active?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...CARD, padding: "1rem", position: "relative", cursor: onClick ? "pointer" : "default", outline: active ? `2px solid ${color}` : "none" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: color }} />
      <div style={{ color: "#94a3b8", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, paddingLeft: 8 }}>{label}</div>
      <div style={{ color, fontSize: "1.75rem", fontWeight: 700, lineHeight: 1, paddingLeft: 8 }}>{count.toLocaleString()}</div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function VulnerabilitiesPage() {
  const [data, setData] = useState<VulnSummary | null>(null);
  const [vulns, setVulns] = useState<VulnRow[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // FIX #1: Initialize filters from URL params BEFORE first render
  const [sevFilter, setSevFilter] = useState<string>(() => getInitialParam("severity"));
  const [swFilter, setSwFilter] = useState(() => getInitialParam("software"));
  const [siteFilter, setSiteFilter] = useState(() => getInitialParam("site"));
  const [searchFilter, setSearchFilter] = useState(() => getInitialParam("search"));
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Filter input states (for controlled inputs that submit on Enter/button)
  const [swInput, setSwInput] = useState(() => getInitialParam("software"));
  const [siteInput, setSiteInput] = useState(() => getInitialParam("site"));
  const [searchInput, setSearchInput] = useState(() => getInitialParam("search"));

  // Software autocomplete
  const [swSuggestions, setSwSuggestions] = useState<{ name: string; cves: number; devices: number; vendor: string }[]>([]);
  const [showSwDropdown, setShowSwDropdown] = useState(false);

  const hasFilters = !!(sevFilter || swFilter || siteFilter || searchFilter);

  const loadSummary = useCallback(async () => {
    try {
      const summary = await apiFetch("/api/admin/browser/vulnerabilities/summary") as VulnSummary;
      setData(summary);
      setLastRefresh(new Date());
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, []);

  const loadVulns = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (sevFilter) params.set("severity", sevFilter);
      if (swFilter) params.set("software", swFilter);
      if (siteFilter) params.set("site", siteFilter);
      if (searchFilter) params.set("search", searchFilter);
      const r = await apiFetch(`/api/admin/browser/vulnerabilities?${params}`) as { vulnerabilities: VulnRow[]; total: number };
      setVulns(r.vulnerabilities);
      setVulnTotal(r.total);
    } catch { /* summary already shows error */ }
  }, [page, sevFilter, swFilter, siteFilter, searchFilter]);

  // Software autocomplete — debounced fetch
  useEffect(() => {
    if (swInput.length < 2) { setSwSuggestions([]); setShowSwDropdown(false); return; }
    // Don't search if input exactly matches current filter (user selected from dropdown)
    if (swInput === swFilter) { setShowSwDropdown(false); return; }
    const timer = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/admin/browser/vulnerabilities/software?q=${encodeURIComponent(swInput)}`) as { results: { name: string; cves: number; devices: number; vendor: string }[] };
        setSwSuggestions(r.results);
        setShowSwDropdown(r.results.length > 0);
      } catch { setSwSuggestions([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [swInput, swFilter]);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { window.location.href = "/login"; return; }
    loadSummary();
    const iv = setInterval(loadSummary, 30_000);
    return () => clearInterval(iv);
  }, [loadSummary]);

  useEffect(() => { loadVulns(); }, [loadVulns]);

  async function handleScan() {
    setScanning(true);
    try {
      await fetch(`${API_BASE}/api/admin/cve-scan`, { method: "POST", headers: { Authorization: `Bearer ${getToken()}` } });
      setTimeout(loadSummary, 3000);
    } catch { setScanning(false); }
  }

  function filterBySoftware(name: string) { setSwFilter(name); setSwInput(name); setPage(1); }
  function filterBySite(name: string) { setSiteFilter(name); setSiteInput(name); setPage(1); }
  function filterBySeverity(sev: string) { setSevFilter(prev => prev === sev ? "" : sev); setPage(1); }
  function clearFilters() { setSevFilter(""); setSwFilter(""); setSiteFilter(""); setSearchFilter(""); setSwInput(""); setSiteInput(""); setSearchInput(""); setPage(1); }

  function applyInputFilters() {
    setSwFilter(swInput);
    setSiteFilter(siteInput);
    setSearchFilter(searchInput);
    setPage(1);
  }

  const totalPages = Math.ceil(vulnTotal / pageSize);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: 2 }}>
            <Link href="/admin/explorer" style={{ color: "#64748b", fontSize: "0.8125rem", textDecoration: "none" }}>Explorer</Link>
            <span style={{ color: "#334155" }}>/</span>
            <span style={{ color: "#e2e8f0", fontSize: "0.8125rem" }}>Vulnerabilities</span>
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>CVE Vulnerability Dashboard</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastRefresh && <span style={{ color: "#475569", fontSize: "0.7rem" }}>Updated {lastRefresh.toLocaleTimeString()}</span>}
          <button onClick={handleScan} disabled={scanning} style={{
            background: scanning ? "#334155" : "#1e40af", border: "none", color: "#fff",
            borderRadius: 6, padding: "0.4rem 0.75rem", cursor: scanning ? "not-allowed" : "pointer",
            fontSize: "0.8125rem", fontWeight: 600, opacity: scanning ? 0.6 : 1,
          }}>{scanning ? "Scanning..." : "Scan Now"}</button>
        </div>
      </div>

      {error && <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.8125rem" }}>{error}</div>}

      {/* Severity cards — clickable to toggle filter */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <SeverityCard label="Critical" count={data?.totals.critical ?? 0} color="#dc2626" active={sevFilter === "CRITICAL"} onClick={() => filterBySeverity("CRITICAL")} />
        <SeverityCard label="High" count={data?.totals.high ?? 0} color="#f97316" active={sevFilter === "HIGH"} onClick={() => filterBySeverity("HIGH")} />
        <SeverityCard label="Medium" count={data?.totals.medium ?? 0} color="#eab308" active={sevFilter === "MEDIUM"} onClick={() => filterBySeverity("MEDIUM")} />
        <SeverityCard label="Low" count={data?.totals.low ?? 0} color="#3b82f6" active={sevFilter === "LOW"} onClick={() => filterBySeverity("LOW")} />
      </div>

      {/* FIX #2: Two columns with scrollable tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.25rem" }}>
        {/* Top Software — clickable rows to filter */}
        <div style={CARD}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.8125rem" }}>Top Vulnerable Software</div>
          <div style={{ maxHeight: 350, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={HEAD}>Software</th><th style={{ ...HEAD, textAlign: "right" }}>CVEs</th><th style={{ ...HEAD, textAlign: "right" }}>Devices</th><th style={{ ...HEAD, textAlign: "right" }}>CVSS</th></tr></thead>
              <tbody>
                {(data?.topSoftware ?? []).map((sw, i) => (
                  <tr key={i} style={{ cursor: "pointer" }} onClick={() => filterBySoftware(sw.name)}
                    onMouseEnter={e => (e.currentTarget.style.background = "#273347")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <td style={{ ...CELL, color: "#60a5fa" }}>{sw.name}</td>
                    <td style={{ ...CELL, textAlign: "right" }}>{sw.cve_count.toLocaleString()}</td>
                    <td style={{ ...CELL, textAlign: "right" }}>{sw.device_count.toLocaleString()}</td>
                    <td style={{ ...CELL, textAlign: "right" }}><CvssBadge score={sw.worst_score} /></td>
                  </tr>
                ))}
                {!data && <tr><td colSpan={4} style={{ ...CELL, textAlign: "center", color: "#475569" }}>Loading...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* FIX #3: Top Sites — clickable rows to FILTER (not navigate) */}
        <div style={CARD}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.8125rem" }}>Top Affected Sites</div>
          <div style={{ maxHeight: 350, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={HEAD}>Site</th><th style={{ ...HEAD, textAlign: "right" }}>Devices</th><th style={{ ...HEAD, textAlign: "right" }}>Critical</th><th style={{ ...HEAD, textAlign: "right" }}>High</th></tr></thead>
              <tbody>
                {(data?.topSites ?? []).map((site, i) => (
                  <tr key={i} style={{ cursor: "pointer" }} onClick={() => filterBySite(site.site_name)}
                    onMouseEnter={e => (e.currentTarget.style.background = "#273347")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}>
                    <td style={{ ...CELL, color: "#60a5fa" }}>{site.site_name}</td>
                    <td style={{ ...CELL, textAlign: "right" }}>{site.device_count.toLocaleString()}</td>
                    <td style={{ ...CELL, textAlign: "right" }}>{site.critical_count > 0 && <SevBadge s="CRITICAL" />} <span style={{ marginLeft: 4 }}>{site.critical_count.toLocaleString()}</span></td>
                    <td style={{ ...CELL, textAlign: "right" }}>{site.high_count > 0 && <SevBadge s="HIGH" />} <span style={{ marginLeft: 4 }}>{site.high_count.toLocaleString()}</span></td>
                  </tr>
                ))}
                {!data && <tr><td colSpan={4} style={{ ...CELL, textAlign: "center", color: "#475569" }}>Loading...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Last scan info */}
      {data?.lastSync && (
        <div style={{ ...CARD, padding: "0.75rem 1rem", marginBottom: "1.25rem", display: "flex", gap: "2rem", fontSize: "0.8125rem" }}>
          <span><span style={{ color: "#64748b" }}>Status:</span> <span style={{ color: data.lastSync.status === "completed" ? "#22c55e" : "#eab308", fontWeight: 600 }}>{data.lastSync.status}</span></span>
          <span><span style={{ color: "#64748b" }}>Last scan:</span> {new Date(data.lastSync.started_at).toLocaleString()}</span>
          <span><span style={{ color: "#64748b" }}>CVEs:</span> {data.lastSync.cves_added.toLocaleString()}</span>
          <span><span style={{ color: "#64748b" }}>Matches:</span> <span style={{ color: "#f97316", fontWeight: 600 }}>{data.lastSync.matches_found.toLocaleString()}</span></span>
        </div>
      )}

      {/* FIX #4: Filter bar */}
      <div style={{ ...CARD, padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
        <form onSubmit={e => { e.preventDefault(); applyInputFilters(); }} style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr 1fr auto auto", gap: "0.5rem", alignItems: "center" }}>
          <select value={sevFilter} onChange={e => { setSevFilter(e.target.value); setPage(1); }} style={SELECT}>
            <option value="">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <input value={siteInput} onChange={e => setSiteInput(e.target.value)} placeholder="Filter by site..." style={INPUT} />
          <div style={{ position: "relative" }}>
            <input value={swInput} onChange={e => { setSwInput(e.target.value); setShowSwDropdown(true); }} onFocus={() => swSuggestions.length > 0 && setShowSwDropdown(true)} placeholder="Filter by software..." style={INPUT} />
            {showSwDropdown && swSuggestions.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#1e293b", border: "1px solid #475569", borderRadius: "0 0 4px 4px", maxHeight: 250, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                {swSuggestions.map((s, i) => (
                  <div key={i} onClick={() => { setSwInput(s.name); setSwFilter(s.name); setShowSwDropdown(false); setPage(1); }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#273347")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                    style={{ padding: "0.4rem 0.6rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #334155", fontSize: "0.8125rem" }}>
                    <span style={{ color: "#e2e8f0" }}>{s.name}</span>
                    <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <span style={{ color: "#64748b", fontSize: "0.7rem" }}>{s.vendor}</span>
                      <span style={{ color: "#f97316", fontSize: "0.7rem", fontWeight: 600 }}>{s.cves} CVEs</span>
                      <span style={{ color: "#64748b", fontSize: "0.7rem" }}>{s.devices} dev</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search CVE ID or description..." style={INPUT} />
          <button type="submit" style={{ background: "#1e40af", border: "none", color: "#fff", borderRadius: 4, padding: "0.35rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem", fontWeight: 600, whiteSpace: "nowrap" }}>Filter</button>
          {hasFilters && (
            <button type="button" onClick={clearFilters} style={{ background: "none", border: "1px solid #475569", color: "#94a3b8", borderRadius: 4, padding: "0.35rem 0.6rem", cursor: "pointer", fontSize: "0.75rem", whiteSpace: "nowrap" }}>Clear All</button>
          )}
        </form>
      </div>

      {/* Active filters display */}
      {hasFilters && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#64748b", fontSize: "0.75rem" }}>Active filters:</span>
          {sevFilter && <span onClick={() => setSevFilter("")} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><SevBadge s={sevFilter} /><span style={{ color: "#475569", fontSize: "0.7rem" }}>×</span></span>}
          {siteFilter && <span onClick={() => { setSiteFilter(""); setSiteInput(""); }} style={{ cursor: "pointer", fontSize: "0.75rem", background: "#1e3a5f", color: "#60a5fa", padding: "2px 8px", borderRadius: 3 }}>Site: {siteFilter} ×</span>}
          {swFilter && <span onClick={() => { setSwFilter(""); setSwInput(""); }} style={{ cursor: "pointer", fontSize: "0.75rem", background: "#1e3a5f", color: "#60a5fa", padding: "2px 8px", borderRadius: 3 }}>Software: {swFilter} ×</span>}
          {searchFilter && <span onClick={() => { setSearchFilter(""); setSearchInput(""); }} style={{ cursor: "pointer", fontSize: "0.75rem", background: "#1e3a5f", color: "#60a5fa", padding: "2px 8px", borderRadius: 3 }}>Search: {searchFilter} ×</span>}
        </div>
      )}

      {/* Vulnerability list */}
      <div style={CARD}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: "0.8125rem" }}>Vulnerability List</span>
          <span style={{ color: "#64748b", fontSize: "0.75rem" }}>{vulnTotal.toLocaleString()} results</span>
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={HEAD}>Severity</th>
                <th style={HEAD}>CVSS</th>
                <th style={HEAD}>CVE</th>
                <th style={HEAD}>Software</th>
                <th style={HEAD}>Device</th>
                <th style={HEAD}>Site</th>
                <th style={HEAD}>Description</th>
              </tr>
            </thead>
            <tbody>
              {vulns.length === 0 ? (
                <tr><td colSpan={7} style={{ ...CELL, textAlign: "center", color: "#475569", padding: "2rem" }}>{data ? "No vulnerabilities match the filter" : "Loading..."}</td></tr>
              ) : vulns.map((v, i) => (
                <tr key={i} onMouseEnter={e => (e.currentTarget.style.background = "#273347")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td style={CELL}><SevBadge s={v.severity} /></td>
                  <td style={CELL}><CvssBadge score={v.cvss_v3_score} /></td>
                  <td style={{ ...CELL, whiteSpace: "nowrap" }}>
                    <a href={`https://nvd.nist.gov/vuln/detail/${v.cve_id}`} target="_blank" rel="noopener noreferrer" style={LINK}>{v.cve_id}</a>
                  </td>
                  <td style={{ ...CELL, cursor: "pointer", color: "#60a5fa" }} onClick={() => filterBySoftware(v.software_name)}>
                    {v.software_name} {v.software_version && <span style={{ color: "#64748b" }}>{v.software_version}</span>}
                  </td>
                  <td style={CELL}>
                    <Link href={`/admin/explorer/devices/${v.device_uid}`} style={LINK}>{v.hostname}</Link>
                  </td>
                  <td style={{ ...CELL, cursor: "pointer", color: "#94a3b8" }} onClick={() => v.site_name && filterBySite(v.site_name)}>
                    {v.site_name ?? "—"}
                  </td>
                  <td style={{ ...CELL, color: "#94a3b8", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem" }}>
                    {v.description ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #334155" }}>
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ background: "#0f172a", border: "1px solid #334155", color: page <= 1 ? "#334155" : "#e2e8f0", borderRadius: 4, padding: "0.3rem 0.75rem", cursor: page <= 1 ? "default" : "pointer", fontSize: "0.8125rem" }}>Previous</button>
            <span style={{ color: "#64748b", fontSize: "0.8125rem" }}>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ background: "#0f172a", border: "1px solid #334155", color: page >= totalPages ? "#334155" : "#e2e8f0", borderRadius: 4, padding: "0.3rem 0.75rem", cursor: page >= totalPages ? "default" : "pointer", fontSize: "0.8125rem" }}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
