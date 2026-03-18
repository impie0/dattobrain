"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getLlmConfig,
  putLlmConfig,
  getLlmModels,
  LlmRoutingConfigItem,
  LlmModel,
} from "@/lib/api";

const SLOT_LABELS: Record<string, string> = {
  orchestrator_default:   "Default (low-risk tools in scope)",
  orchestrator_high_risk: "High-risk tools in scope",
  synthesizer_default:    "Default",
  synthesizer_large_data: "Large data (>8 000 chars)",
  synthesizer_high_risk:  "High-risk tool was called",
  synthesizer_cached:     "Cached-mode query",
};

export default function LlmConfigPage() {
  const router = useRouter();
  const [items, setItems] = useState<LlmRoutingConfigItem[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }
    Promise.all([getLlmConfig(), getLlmModels()])
      .then(([cfg, mdls]) => {
        setItems(cfg.items);
        setModels(mdls.models);
        const init: Record<string, string> = {};
        for (const item of cfg.items) init[item.key] = item.model;
        setPending(init);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updates = Object.entries(pending).map(([key, model]) => ({ key, model }));
      await putLlmConfig(updates);
      setItems((prev) => prev.map((item) => ({ ...item, model: pending[item.key] ?? item.model })));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function currentValue(key: string): string {
    return pending[key] ?? items.find((i) => i.key === key)?.model ?? "";
  }

  function setKey(key: string, value: string) {
    setPending((prev) => ({ ...prev, [key]: value }));
  }

  const orchestratorModels = models.filter((m) => m.canOrchestrate);
  const synthModels = models;

  const dataMode = currentValue("default_data_mode");

  if (loading) {
    return <p style={{ color: "#94a3b8" }}>Loading…</p>;
  }

  const cardStyle: React.CSSProperties = {
    background: "#1e293b",
    borderRadius: "8px",
    padding: "1.5rem",
    marginBottom: "1.5rem",
  };

  const sectionHeadingStyle: React.CSSProperties = {
    margin: "0 0 1rem",
    fontSize: "1rem",
    fontWeight: 600,
    color: "#e2e8f0",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.875rem",
  };

  const labelStyle: React.CSSProperties = {
    color: "#cbd5e1",
    fontSize: "0.875rem",
  };

  const selectStyle: React.CSSProperties = {
    background: "#0f172a",
    color: "#e2e8f0",
    border: "1px solid #334155",
    borderRadius: "6px",
    padding: "0.375rem 0.75rem",
    fontSize: "0.875rem",
    minWidth: "260px",
  };

  return (
    <div style={{ maxWidth: "700px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>LLM Routing Config</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: saving ? "#334155" : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "0.5rem 1.25rem",
            cursor: saving ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#450a0a", color: "#fca5a5", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ background: "#052e16", color: "#86efac", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
          Configuration saved.
        </div>
      )}

      {/* Stage 1 — Orchestrator */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Stage 1 — Orchestrator (Tool Selection)</h3>
        <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: 0, marginBottom: "1rem" }}>
          Must be an Anthropic model (uses tool_use format). Calls tools on behalf of the user.
        </p>
        {(["orchestrator_default", "orchestrator_high_risk"] as const).map((key) => (
          <div key={key} style={rowStyle}>
            <span style={labelStyle}>{SLOT_LABELS[key]}</span>
            <select
              style={selectStyle}
              value={currentValue(key)}
              onChange={(e) => setKey(key, e.target.value)}
            >
              {orchestratorModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Stage 2 — Synthesizer */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Stage 2 — Synthesizer (Response Writing)</h3>
        <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: 0, marginBottom: "1rem" }}>
          Reads tool results and writes the final answer. Can be any model. Priority: high-risk → cached → large-data → default.
        </p>
        {(["synthesizer_default", "synthesizer_large_data", "synthesizer_high_risk", "synthesizer_cached"] as const).map((key) => (
          <div key={key} style={rowStyle}>
            <span style={labelStyle}>{SLOT_LABELS[key]}</span>
            <select
              style={selectStyle}
              value={currentValue(key)}
              onChange={(e) => setKey(key, e.target.value)}
            >
              {synthModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Data Mode Default */}
      <div style={cardStyle}>
        <h3 style={sectionHeadingStyle}>Data Mode Default</h3>
        <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: 0, marginBottom: "1rem" }}>
          Default for new sessions. Individual sessions can still override via the chat UI.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {(["cached", "live"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setKey("default_data_mode", mode)}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "6px",
                border: "1px solid",
                borderColor: dataMode === mode ? "#3b82f6" : "#334155",
                background: dataMode === mode ? "#1d4ed8" : "transparent",
                color: dataMode === mode ? "#fff" : "#94a3b8",
                cursor: "pointer",
                fontWeight: dataMode === mode ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {mode}
            </button>
          ))}
        </div>
        <p style={{ color: "#64748b", fontSize: "0.75rem", marginTop: "0.75rem", marginBottom: 0 }}>
          <strong style={{ color: "#94a3b8" }}>cached</strong> — uses locally synced data (fast, no Datto API calls)
          &nbsp;·&nbsp;
          <strong style={{ color: "#94a3b8" }}>live</strong> — fetches fresh data from Datto API
        </p>
      </div>
    </div>
  );
}
