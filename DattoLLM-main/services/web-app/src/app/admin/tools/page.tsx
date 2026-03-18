"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAdminTools, updateAdminTool, AdminTool } from "@/lib/api";

const RISK_LEVELS = ["low", "medium", "high"];

export default function AdminToolsPage() {
  const router = useRouter();
  const [tools, setTools] = useState<AdminTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }
    getAdminTools()
      .then(setTools)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load tools"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleToggleApproval(toolName: string, current: boolean) {
    setSaving(toolName);
    try {
      await updateAdminTool(toolName, { approval_required: !current });
      setTools((prev) =>
        prev.map((t) => t.tool_name === toolName ? { ...t, approval_required: !current } : t)
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update tool policy");
    } finally {
      setSaving(null);
    }
  }

  async function handleRiskLevelChange(toolName: string, risk_level: string) {
    setSaving(toolName);
    try {
      await updateAdminTool(toolName, { risk_level });
      setTools((prev) =>
        prev.map((t) => t.tool_name === toolName ? { ...t, risk_level } : t)
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update tool policy");
    } finally {
      setSaving(null);
    }
  }

  const riskColor: Record<string, string> = {
    low: "#166534",
    medium: "#92400e",
    high: "#7f1d1d",
  };

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading…</p>;

  return (
    <div>
      <h2 style={{ margin: "0 0 1.5rem", fontSize: "1.125rem" }}>Tool Policies</h2>
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155", textAlign: "left" }}>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Tool Name</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Permission</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Risk Level</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Approval Required</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.tool_name} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "0.75rem 1rem", color: "#e2e8f0", fontFamily: "monospace" }}>
                  {tool.tool_name}
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontFamily: "monospace", fontSize: "0.8rem" }}>
                  {tool.permission}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <select
                    value={tool.risk_level}
                    disabled={saving === tool.tool_name}
                    onChange={(e) => handleRiskLevelChange(tool.tool_name, e.target.value)}
                    style={{
                      background: riskColor[tool.risk_level] ?? "#1e293b",
                      color: "#e2e8f0",
                      border: "1px solid #334155",
                      borderRadius: "4px",
                      padding: "0.25rem 0.5rem",
                    }}
                  >
                    {RISK_LEVELS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <button
                    type="button"
                    disabled={saving === tool.tool_name}
                    onClick={() => handleToggleApproval(tool.tool_name, tool.approval_required)}
                    style={{
                      background: tool.approval_required ? "#1d4ed8" : "#1e293b",
                      color: "#e2e8f0",
                      border: "1px solid #334155",
                      borderRadius: "4px",
                      padding: "0.25rem 0.75rem",
                      cursor: saving === tool.tool_name ? "not-allowed" : "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    {tool.approval_required ? "Yes" : "No"}
                  </button>
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#94a3b8" }}>
                  {tool.description ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
