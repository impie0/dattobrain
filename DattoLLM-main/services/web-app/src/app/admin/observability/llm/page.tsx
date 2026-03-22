"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getObsLlm, getLlmLogDetail, ObsLlm, LlmLogDetail } from "@/lib/api";

function abbrev(model: string | null | undefined): string {
  if (!model) return "—";
  return model
    .replace("claude-haiku-4-5-20251001", "Haiku 4.5")
    .replace("claude-sonnet-4-5", "Sonnet 4.5")
    .replace("claude-opus-4-6", "Opus 4.6")
    .replace("deepseek/deepseek-r1", "DeepSeek R1")
    .replace("deepseek/deepseek-chat", "DeepSeek Chat")
    .replace("gemini/gemini-2.0-flash", "Gemini Flash");
}

function modelColor(model: string | null | undefined): string {
  if (!model) return "#475569";
  if (model.includes("opus")) return "#7c3aed";
  if (model.includes("sonnet")) return "#2563eb";
  if (model.includes("haiku")) return "#0891b2";
  if (model.includes("deepseek")) return "#16a34a";
  if (model.includes("gemini")) return "#dc2626";
  if (model.includes("local/")) return "#f59e0b";
  return "#475569";
}

function providerBadge(provider: string | null) {
  if (!provider) return null;
  const color = provider === "ollama" ? "#f59e0b" : "#3b82f6";
  return (
    <span style={{ background: color + "22", color, padding: "1px 5px", borderRadius: 3, fontSize: "0.625rem", marginLeft: 4, textTransform: "uppercase" }}>
      {provider}
    </span>
  );
}

function formatTokens(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.75rem", textAlign: "left", color: "#64748b",
  fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase",
  borderBottom: "1px solid #334155", whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "0.5rem 0.75rem", fontSize: "0.8125rem",
  borderBottom: "1px solid #1e293b", whiteSpace: "nowrap",
};
const card: React.CSSProperties = {
  background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "1rem",
};

function DetailPanel({ detail, onClose }: { detail: LlmLogDetail; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"overview" | "messages" | "tools" | "system">("overview");
  const tabs = ["overview", "messages", "tools", "system"] as const;

  return (
    <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>
          Request Detail — {new Date(detail.created_at).toLocaleString()}
          <span style={{ color: "#64748b", fontWeight: 400, marginLeft: 8 }}>{detail.username}</span>
        </div>
        <button onClick={onClose} style={{ background: "#334155", border: "none", color: "#94a3b8", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: "0.75rem" }}>Close</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #334155", paddingBottom: 8 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            background: activeTab === t ? "#334155" : "transparent", border: "none", color: activeTab === t ? "#e2e8f0" : "#64748b",
            borderRadius: 4, padding: "4px 12px", cursor: "pointer", fontSize: "0.75rem", textTransform: "capitalize",
          }}>{t}</button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={card}>
            <div style={{ color: "#64748b", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 6 }}>Orchestrator</div>
            <div style={{ fontSize: "0.875rem" }}>{abbrev(detail.orchestrator_model)} {providerBadge(detail.data_mode === "cached" ? "cloud" : "cloud")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8, fontSize: "0.75rem" }}>
              <div><span style={{ color: "#64748b" }}>Prompt:</span> <span style={{ color: "#3b82f6" }}>{formatTokens(detail.orch_prompt_tokens)}</span></div>
              <div><span style={{ color: "#64748b" }}>Completion:</span> <span style={{ color: "#8b5cf6" }}>{formatTokens(detail.orch_completion_tokens)}</span></div>
              <div><span style={{ color: "#64748b" }}>Total:</span> <span style={{ color: "#06b6d4" }}>{formatTokens(detail.orch_total_tokens)}</span></div>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 4 }}>Iterations: {detail.orch_iterations ?? "—"}</div>
          </div>
          <div style={card}>
            <div style={{ color: "#64748b", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 6 }}>Synthesizer</div>
            <div style={{ fontSize: "0.875rem" }}>{abbrev(detail.synthesizer_model)} {providerBadge(detail.synthesizer_model?.startsWith("local/") ? "ollama" : "cloud")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8, fontSize: "0.75rem" }}>
              <div><span style={{ color: "#64748b" }}>Prompt:</span> <span style={{ color: "#3b82f6" }}>{formatTokens(detail.synth_prompt_tokens)}</span></div>
              <div><span style={{ color: "#64748b" }}>Completion:</span> <span style={{ color: "#8b5cf6" }}>{formatTokens(detail.synth_completion_tokens)}</span></div>
              <div><span style={{ color: "#64748b" }}>Total:</span> <span style={{ color: "#06b6d4" }}>{formatTokens(detail.synth_total_tokens)}</span></div>
            </div>
          </div>
          <div style={card}>
            <div style={{ color: "#64748b", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 6 }}>Totals</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#06b6d4" }}>{formatTokens(detail.total_tokens)}</div>
            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 4 }}>
              Data mode: <span style={{ color: detail.data_mode === "live" ? "#22c55e" : "#f59e0b" }}>{detail.data_mode ?? "—"}</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Tool result size: {detail.tool_result_chars?.toLocaleString() ?? "—"} chars</div>
          </div>
          <div style={card}>
            <div style={{ color: "#64748b", fontSize: "0.7rem", textTransform: "uppercase", marginBottom: 6 }}>Tools</div>
            <div style={{ fontSize: "0.75rem" }}>
              <div style={{ color: "#94a3b8" }}>Available: {detail.tool_names?.length ?? 0}</div>
              <div style={{ color: "#f59e0b", marginTop: 4 }}>Called: {detail.tools_called?.join(", ") || "none"}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "messages" && (
        <div style={{ maxHeight: 500, overflow: "auto" }}>
          {Array.isArray(detail.messages) && (detail.messages as Record<string, unknown>[]).map((msg, i) => {
            const role = String(msg.role ?? "unknown");
            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
            const toolCalls = msg.tool_calls as { function: { name: string; arguments: string } }[] | undefined;
            const roleColor = role === "user" ? "#3b82f6" : role === "assistant" ? "#8b5cf6" : role === "tool" ? "#f59e0b" : "#64748b";
            return (
              <div key={i} style={{ marginBottom: 8, background: "#1e293b", borderRadius: 6, padding: "8px 12px", border: `1px solid ${roleColor}33` }}>
                <div style={{ fontSize: "0.625rem", color: roleColor, textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>{role}</div>
                {content && <pre style={{ margin: 0, fontSize: "0.75rem", color: "#e2e8f0", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflow: "auto" }}>{content}</pre>}
                {toolCalls && toolCalls.map((tc, j) => (
                  <div key={j} style={{ marginTop: 4, background: "#0f172a", borderRadius: 4, padding: "4px 8px" }}>
                    <div style={{ fontSize: "0.625rem", color: "#f59e0b" }}>TOOL CALL: {tc.function?.name}</div>
                    <pre style={{ margin: 0, fontSize: "0.7rem", color: "#94a3b8", whiteSpace: "pre-wrap" }}>{tc.function?.arguments}</pre>
                  </div>
                ))}
              </div>
            );
          })}
          {(!detail.messages || !Array.isArray(detail.messages) || detail.messages.length === 0) && (
            <div style={{ color: "#475569", fontSize: "0.875rem" }}>No messages recorded</div>
          )}
        </div>
      )}

      {activeTab === "tools" && (
        <div style={{ maxHeight: 500, overflow: "auto" }}>
          {Array.isArray(detail.tools_payload) && (detail.tools_payload as Record<string, unknown>[]).map((tool, i) => {
            const fn = tool.function as { name: string; description: string; parameters: unknown } | undefined;
            return (
              <div key={i} style={{ marginBottom: 6, background: "#1e293b", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: detail.tools_called?.includes(fn?.name ?? "") ? "#f59e0b" : "#64748b" }}>
                  {fn?.name ?? "unknown"} {detail.tools_called?.includes(fn?.name ?? "") && <span style={{ color: "#22c55e", fontSize: "0.625rem" }}>CALLED</span>}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: 2 }}>{fn?.description}</div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "system" && (
        <div style={{ maxHeight: 500, overflow: "auto" }}>
          <pre style={{ margin: 0, fontSize: "0.75rem", color: "#e2e8f0", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#1e293b", borderRadius: 6, padding: 12 }}>
            {detail.system_prompt ?? "No system prompt"}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function LlmPage() {
  const [data, setData] = useState<ObsLlm | null>(null);
  const [detail, setDetail] = useState<LlmLogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getObsLlm());
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

  async function openDetail(id: string) {
    setLoadingDetail(true);
    try {
      const d = await getLlmLogDetail(id);
      setDetail(d);
    } catch { setDetail(null); }
    setLoadingDetail(false);
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: "0.8125rem", marginBottom: 4 }}>
            <Link href="/admin/observability" style={{ color: "#64748b", textDecoration: "none" }}>Observability</Link>
            {" / "}LLM
          </div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>LLM / Tokens</h2>
        </div>
        {lastRefresh && (
          <span style={{ color: "#475569", fontSize: "0.75rem" }}>
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Requests (24h)", value: data?.summary.total24h ?? "—", color: "#3b82f6" },
          { label: "Total Tokens (24h)", value: data ? formatTokens(data.summary.tokens24h) : "—", color: "#06b6d4" },
          { label: "Orch Tokens (24h)", value: data ? formatTokens(data.summary.orchTokens24h) : "—", sub: "cloud", color: "#3b82f6" },
          { label: "Synth Tokens (24h)", value: data ? formatTokens(data.summary.synthTokens24h) : "—", sub: "ollama/cloud", color: "#8b5cf6" },
          { label: "Pre-query Hits", value: data?.summary.prequeryHits24h ?? "—", sub: "0 tokens", color: "#22c55e" },
        ].map((c, i) => (
          <div key={i} style={card}>
            <div style={{ color: "#94a3b8", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{c.label}</div>
            <div style={{ color: c.color, fontSize: "1.5rem", fontWeight: 700 }}>{c.value}</div>
            {"sub" in c && <div style={{ color: "#475569", fontSize: "0.625rem", marginTop: 2 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Avg tokens */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Avg Tokens / Request", value: data?.summary.avgTokens ?? 0, color: "#06b6d4" },
          { label: "Avg Orch Tokens", value: data?.summary.avgOrchTokens ?? 0, color: "#3b82f6" },
          { label: "Avg Synth Tokens", value: data?.summary.avgSynthTokens ?? 0, color: "#8b5cf6" },
        ].map((c, i) => (
          <div key={i} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>{c.label}</div>
            <div style={{ color: c.color, fontSize: "1.125rem", fontWeight: 600 }}>{formatTokens(c.value)}</div>
          </div>
        ))}
      </div>

      {/* Model breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: "0.875rem" }}>Orchestrator Models (24h)</div>
          {data?.byOrchModel.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "0.75rem", borderBottom: "1px solid #1e293b" }}>
              <span style={{ color: modelColor(m.model) }}>{abbrev(m.model)}</span>
              <span><span style={{ color: "#64748b" }}>{m.count} calls</span> <span style={{ color: "#06b6d4", marginLeft: 8 }}>{formatTokens(m.tokens)} tok</span></span>
            </div>
          ))}
        </div>
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: "0.875rem" }}>Synthesizer Models (24h)</div>
          {data?.bySynthModel.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: "0.75rem", borderBottom: "1px solid #1e293b" }}>
              <span style={{ color: modelColor(m.model) }}>{abbrev(m.model)}</span>
              <span><span style={{ color: "#64748b" }}>{m.count} calls</span> <span style={{ color: "#06b6d4", marginLeft: 8 }}>{formatTokens(m.tokens)} tok</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {loadingDetail && <div style={{ ...card, marginBottom: "1rem", color: "#64748b" }}>Loading detail...</div>}
      {detail && <DetailPanel detail={detail} onClose={() => setDetail(null)} />}

      {/* Recent table */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "0.875rem 1rem", borderBottom: "1px solid #334155", fontWeight: 600, fontSize: "0.875rem" }}>
          Last 100 LLM Requests <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.75rem" }}>Click a row to inspect</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>User</th>
                <th style={th}>Mode</th>
                <th style={th}>Orchestrator</th>
                <th style={th}>Synthesizer</th>
                <th style={th}>Tools</th>
                <th style={th}>Orch Tok</th>
                <th style={th}>Synth Tok</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data?.recent.map((row, i) => (
                <tr key={row.id}
                  onClick={() => openDetail(row.id)}
                  style={{
                    background: detail?.id === row.id ? "#334155" : i % 2 === 0 ? "transparent" : "#0f172a",
                    cursor: "pointer",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#1e293b")}
                  onMouseLeave={e => (e.currentTarget.style.background = detail?.id === row.id ? "#334155" : i % 2 === 0 ? "transparent" : "#0f172a")}
                >
                  <td style={td}>{new Date(row.created_at).toLocaleString()}</td>
                  <td style={td}>{row.username ?? <span style={{ color: "#475569" }}>—</span>}</td>
                  <td style={td}>
                    {row.prequery_hit ? (
                      <span style={{ background: "#22c55e22", color: "#22c55e", padding: "2px 6px", borderRadius: 4, fontSize: "0.625rem" }}>PRE-QUERY</span>
                    ) : row.data_mode ? (
                      <span style={{ background: row.data_mode === "live" ? "#22c55e22" : "#f59e0b22", color: row.data_mode === "live" ? "#22c55e" : "#f59e0b", padding: "2px 6px", borderRadius: 4, fontSize: "0.625rem" }}>
                        {row.data_mode.toUpperCase()}
                      </span>
                    ) : <span style={{ color: "#475569" }}>—</span>}
                  </td>
                  <td style={td}>
                    <span style={{ background: modelColor(row.orchestrator_model) + "22", color: modelColor(row.orchestrator_model), padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem" }}>
                      {abbrev(row.orchestrator_model)}
                    </span>
                  </td>
                  <td style={td}>
                    {row.synthesizer_model ? (
                      <span style={{ background: modelColor(row.synthesizer_model) + "22", color: modelColor(row.synthesizer_model), padding: "2px 6px", borderRadius: 4, fontSize: "0.75rem" }}>
                        {abbrev(row.synthesizer_model)}
                      </span>
                    ) : <span style={{ color: "#475569" }}>—</span>}
                  </td>
                  <td style={td}>
                    {row.tools_called?.length
                      ? <span style={{ color: "#f59e0b" }}>{row.tools_called.length}</span>
                      : <span style={{ color: "#475569" }}>0</span>}
                  </td>
                  <td style={td}><span style={{ color: "#3b82f6" }}>{formatTokens(row.orch_total_tokens)}</span></td>
                  <td style={td}><span style={{ color: "#8b5cf6" }}>{formatTokens(row.synth_total_tokens)}</span></td>
                  <td style={td}><span style={{ color: "#06b6d4", fontWeight: 600 }}>{formatTokens(row.total_tokens)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.recent.length && (
            <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>No data</div>
          )}
        </div>
      </div>
    </div>
  );
}
