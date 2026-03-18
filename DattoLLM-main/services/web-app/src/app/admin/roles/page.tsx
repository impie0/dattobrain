"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getAdminRoles,
  saveAdminRole,
  deleteAdminRole,
  getAdminTools,
  AdminRole,
  AdminTool,
} from "@/lib/api";

const PROTECTED = ["admin", "viewer", "helpdesk", "engineer"];

const inputStyle = {
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: "4px",
  padding: "0.375rem 0.5rem",
  fontSize: "0.875rem",
  width: "100%",
};

const btnStyle = (color: string) => ({
  background: color,
  color: "#e2e8f0",
  border: "none",
  borderRadius: "4px",
  padding: "0.375rem 0.875rem",
  cursor: "pointer",
  fontSize: "0.8125rem",
});

export default function AdminRolesPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [allTools, setAllTools] = useState<AdminTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Edit panel
  const [editRole, setEditRole] = useState<AdminRole | null>(null);
  const [editTools, setEditTools] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // New role form
  const [newRoleName, setNewRoleName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }
    Promise.all([getAdminRoles(), getAdminTools()])
      .then(([r, t]) => { setRoles(r); setAllTools(t); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  function openEdit(role: AdminRole) {
    setEditRole(role);
    setEditTools([...role.tools]);
  }

  function toggleTool(toolName: string) {
    setEditTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    );
  }

  async function handleSave() {
    if (!editRole) return;
    setSaving(true);
    try {
      await saveAdminRole(editRole.role, editTools);
      setRoles((prev) => prev.map((r) => r.role === editRole.role ? { ...r, tools: editTools } : r));
      setEditRole(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: string) {
    if (!confirm(`Delete role "${role}"? This cannot be undone.`)) return;
    try {
      await deleteAdminRole(role);
      setRoles((prev) => prev.filter((r) => r.role !== role));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete role");
    }
  }

  async function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    const roleName = newRoleName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!roleName) return;
    setSaving(true);
    try {
      await saveAdminRole(roleName, []);
      setRoles((prev) => [...prev, { role: roleName, tools: [] }]);
      setNewRoleName("");
      setShowCreate(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Role Management</h2>
        <button type="button" onClick={() => setShowCreate((v) => !v)} style={btnStyle("#1d4ed8")}>
          {showCreate ? "Cancel" : "+ New Role"}
        </button>
      </div>

      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <form
          onSubmit={handleCreateRole}
          style={{
            background: "#1e293b", border: "1px solid #334155", borderRadius: "6px",
            padding: "1rem", marginBottom: "1.5rem", display: "flex", gap: "0.75rem", alignItems: "flex-end",
          }}
        >
          <div style={{ flex: 1 }}>
            <label style={{ color: "#94a3b8", fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>
              Role name (lowercase, no spaces)
            </label>
            <input
              required
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="e.g. readonly_helpdesk"
              style={inputStyle}
            />
          </div>
          <button type="submit" disabled={saving} style={btnStyle("#166534")}>
            {saving ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {roles.map((role) => (
          <div
            key={role.role}
            style={{
              background: "#1e293b", border: "1px solid #334155", borderRadius: "6px",
              padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{role.role}</span>
                {PROTECTED.includes(role.role) && (
                  <span style={{
                    fontSize: "0.65rem", background: "#1e3a5f", color: "#93c5fd",
                    borderRadius: "3px", padding: "1px 5px",
                  }}>built-in</span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748b" }}>
                {role.tools.length === 0
                  ? "No tools assigned"
                  : `${role.tools.length} tool${role.tools.length !== 1 ? "s" : ""}: ${role.tools.slice(0, 4).join(", ")}${role.tools.length > 4 ? ` +${role.tools.length - 4} more` : ""}`}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" onClick={() => openEdit(role)} style={btnStyle("#1e3a5f")}>
                Edit Tools
              </button>
              {!PROTECTED.includes(role.role) && (
                <button type="button" onClick={() => handleDelete(role.role)} style={btnStyle("#7f1d1d")}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tool edit side panel */}
      {editRole && (
        <div style={{
          position: "fixed", top: 0, right: 0, width: "360px", height: "100vh",
          background: "#0f172a", borderLeft: "1px solid #334155",
          display: "flex", flexDirection: "column", zIndex: 50,
        }}>
          <div style={{ padding: "1.25rem", borderBottom: "1px solid #334155" }}>
            <p style={{ margin: "0 0 0.25rem", fontSize: "0.75rem", color: "#94a3b8" }}>Editing tools for role</p>
            <p style={{ margin: 0, fontWeight: 600 }}>{editRole.role}</p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#64748b" }}>
              {editTools.length} of {allTools.length} tools selected
            </p>
          </div>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #1e293b", display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setEditTools(allTools.map((t) => t.tool_name))}
              style={{ ...btnStyle("#334155"), fontSize: "0.75rem" }}
            >Select All</button>
            <button
              type="button"
              onClick={() => setEditTools([])}
              style={{ ...btnStyle("#334155"), fontSize: "0.75rem" }}
            >Clear All</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem 1rem" }}>
            {allTools.map((tool) => (
              <label
                key={tool.tool_name}
                style={{
                  display: "flex", alignItems: "flex-start", gap: "0.5rem",
                  padding: "0.4rem 0", cursor: "pointer", borderBottom: "1px solid #1e293b",
                }}
              >
                <input
                  type="checkbox"
                  checked={editTools.includes(tool.tool_name)}
                  onChange={() => toggleTool(tool.tool_name)}
                  style={{ marginTop: "2px", flexShrink: 0 }}
                />
                <span>
                  <span style={{ fontSize: "0.8125rem", color: "#e2e8f0" }}>{tool.tool_name}</span>
                  {tool.risk_level !== "low" && (
                    <span style={{
                      marginLeft: "0.4rem", fontSize: "0.65rem",
                      background: tool.risk_level === "high" ? "#7f1d1d" : "#78350f",
                      color: "#fca5a5", borderRadius: "3px", padding: "1px 4px",
                    }}>{tool.risk_level}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div style={{ padding: "1rem", borderTop: "1px solid #334155", display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={() => setEditRole(null)} style={{ ...btnStyle("#334155"), flex: 1 }}>
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={handleSave} style={{ ...btnStyle("#166534"), flex: 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
