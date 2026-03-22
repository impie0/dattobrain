"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getLlmLogs, getLlmLogDetail, type LlmLogSummary, type LlmLogDetail } from "@/lib/api";

function modelColor(model: string | null): { bg: string; text: string; border: string } {
  if (!model) return { bg: "#1e293b", text: "#64748b", border: "#334155" };
  if (model.startsWith("claude-")) return { bg: "#1e3a5f", text: "#93c5fd", border: "#1d4ed8" };
  if (model.includes("deepseek")) return { bg: "#1a2e1a", text: "#86efac", border: "#16a34a" };
  if (model.includes("gemini")) return { bg: "#2d1a1a", text: "#fca5a5", border: "#dc2626" };
  return { bg: "#1e293b", text: "#94a3b8", border: "#475569" };
}

function ModelBadge({ model }: { model: string | null }) {
  if (!model) return <span style={{ color: "#475569", fontSize: "0.75rem" }}>—</span>;
  const c = modelColor(model);
  const label = model.replace("claude-", "").replace("-20251001", "").replace("deepseek/", "").replace("gemini/", "");
  return (
    <span style={{
      display: "inline-block", padding: "0.125rem 0.5rem", borderRadius: "4px",
      fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap",
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }} title={model}>
      {label}
    </span>
  );
}

export default function LlmLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<LlmLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<LlmLogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<"system" | "messages">("system");

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }
    getLlmLogs(50)
      .then(setLogs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  async function openDetail(id: string) {
    setLoadingDetail(true);
    try {
      const detail = await getLlmLogDetail(id);
      setSelected(detail);
      setActiveTab("system");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load detail");
    } finally {
      setLoadingDetail(false);
    }
  }

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading…</p>;

  return (
    <div>
      <h2 style={{ margin: "0 0 1.5rem", fontSize: "1.125rem" }}>LLM Request Logs</h2>

      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155", textAlign: "left" }}>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Time</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>User</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Stage 1 — Orchestrator</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Stage 2 — Synthesizer</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Tools called</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}></th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "2rem 1rem", color: "#475569", textAlign: "center" }}>
                  No logs yet — logs are recorded from the next chat request.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "0.75rem 1rem", color: "#94a3b8", whiteSpace: "nowrap" }}>
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#e2e8f0" }}>
                  {log.username ?? "—"}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <ModelBadge model={log.orchestrator_model} />
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  {log.synthesizer_model
                    ? <ModelBadge model={log.synthesizer_model} />
                    : <span style={{ color: "#475569", fontSize: "0.75rem" }}>— skipped</span>}
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontSize: "0.8125rem" }}>
                  {log.tools_called?.length
                    ? log.tools_called.join(", ")
                    : <span style={{ color: "#475569" }}>none</span>}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <button
                    type="button"
                    disabled={loadingDetail}
                    onClick={() => openDetail(log.id)}
                    style={{
                      background: "#1e3a5f",
                      color: "#93c5fd",
                      border: "1px solid #1d4ed8",
                      borderRadius: "4px",
                      padding: "0.25rem 0.75rem",
                      cursor: "pointer",
                      fontSize: "0.8125rem",
                    }}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {selected && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
        >
          <div
            style={{
              background: "#0f172a", border: "1px solid #334155", borderRadius: "8px",
              width: "min(900px, 95vw)", height: "80vh",
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: "1rem 1.25rem", borderBottom: "1px solid #334155",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>LLM Request</span>
                <span style={{ color: "#64748b", fontSize: "0.8125rem", marginLeft: "0.75rem" }}>
                  {new Date(selected.created_at).toLocaleString()} · {selected.username ?? "unknown"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "1.25rem", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #334155", flexShrink: 0 }}>
              {(["system", "messages"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
                    color: activeTab === tab ? "#e2e8f0" : "#64748b",
                    padding: "0.625rem 1.25rem",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    fontWeight: activeTab === tab ? 600 : 400,
                  }}
                >
                  {tab === "system" ? `System Prompt` : `Messages (${selected.messages?.length ?? 0})`}
                </button>
              ))}
              <div style={{ marginLeft: "auto", padding: "0.5rem 1.25rem", color: "#475569", fontSize: "0.75rem", alignSelf: "center" }}>
                {selected.tool_names?.length ?? 0} tools available
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
              {activeTab === "system" && (
                <pre style={{
                  margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  fontSize: "0.8125rem", color: "#cbd5e1", lineHeight: 1.6,
                  fontFamily: "monospace",
                }}>
                  {selected.system_prompt}
                </pre>
              )}
              {activeTab === "messages" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {((selected.messages ?? []) as { role: string; content: unknown }[]).map((msg, i) => (
                    <div
                      key={i}
                      style={{
                        borderRadius: "6px",
                        border: "1px solid #334155",
                        overflow: "hidden",
                      }}
                    >
                      <div style={{
                        padding: "0.375rem 0.75rem",
                        background: msg.role === "user" ? "#1e3a5f" : "#1e293b",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: msg.role === "user" ? "#93c5fd" : "#34d399",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}>
                        {msg.role}
                      </div>
                      <pre style={{
                        margin: 0, padding: "0.75rem",
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                        fontSize: "0.8125rem", color: "#cbd5e1", lineHeight: 1.6,
                        fontFamily: "monospace",
                      }}>
                        {typeof msg.content === "string"
                          ? msg.content
                          : JSON.stringify(msg.content, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
