"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getAdminUsers,
  updateAdminUser,
  createAdminUser,
  changeUserPassword,
  getAdminRoles,
  getAdminTools,
  getUserTools,
  setUserTools,
  AdminUser,
  AdminTool,
  AdminRole,
} from "@/lib/api";

const ROLES = ["viewer", "helpdesk", "engineer", "admin"];

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

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [allTools, setAllTools] = useState<AdminTool[]>([]);
  const [allRoles, setAllRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", email: "", password: "", role: "viewer" });
  const [creating, setCreating] = useState(false);

  // Password change
  const [pwUser, setPwUser] = useState<AdminUser | null>(null);
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Tool assignment panel
  const [editToolsFor, setEditToolsFor] = useState<AdminUser | null>(null);
  const [userTools, setUserToolsState] = useState<string[]>([]);
  const [savingTools, setSavingTools] = useState(false);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }
    Promise.all([getAdminUsers(), getAdminTools(), getAdminRoles()])
      .then(([u, t, r]) => { setUsers(u); setAllTools(t); setAllRoles(r); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleAuthorityToggle(id: string, level: string, current: string[]) {
    const next = current.includes(level)
      ? current.filter((l) => l !== level)
      : [...current, level];
    setSaving(id);
    try {
      await updateAdminUser(id, { approval_authority: next });
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, approval_authority: next } : u));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setSaving(null);
    }
  }

  async function handleRoleChange(id: string, role: string) {
    setSaving(id);
    try {
      await updateAdminUser(id, { role });
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, role } : u));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setSaving(null);
    }
  }

  async function handleToggleActive(id: string, is_active: boolean) {
    setSaving(id);
    try {
      await updateAdminUser(id, { is_active: !is_active });
      setUsers((prev) => prev.map((u) => u.id === id ? { ...u, is_active: !is_active } : u));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setSaving(null);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const { id } = await createAdminUser(newUser);
      const created: AdminUser = {
        id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        is_active: true,
        approval_authority: [],
        created_at: new Date().toISOString(),
      };
      setUsers((prev) => [created, ...prev]);
      setNewUser({ username: "", email: "", password: "", role: "viewer" });
      setShowCreate(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwUser) return;
    setSavingPw(true);
    try {
      await changeUserPassword(pwUser.id, newPw);
      setPwUser(null);
      setNewPw("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setSavingPw(false);
    }
  }

  async function openToolsPanel(user: AdminUser) {
    setEditToolsFor(user);
    try {
      const tools = await getUserTools(user.id);
      setUserToolsState(tools);
    } catch {
      setUserToolsState([]);
    }
  }

  function toggleTool(toolName: string) {
    setUserToolsState((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    );
  }

  async function handleSaveTools() {
    if (!editToolsFor) return;
    setSavingTools(true);
    try {
      await setUserTools(editToolsFor.id, userTools);
      setEditToolsFor(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save tools");
    } finally {
      setSavingTools(false);
    }
  }

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem" }}>User Management</h2>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          style={btnStyle("#1d4ed8")}
        >
          {showCreate ? "Cancel" : "+ New User"}
        </button>
      </div>

      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <form
          onSubmit={handleCreateUser}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: "6px",
            padding: "1.25rem",
            marginBottom: "1.5rem",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.75rem",
          }}
        >
          <div>
            <label style={{ color: "#94a3b8", fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>Username</label>
            <input
              required
              value={newUser.username}
              onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ color: "#94a3b8", fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>Email</label>
            <input
              required
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ color: "#94a3b8", fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>Password</label>
            <input
              required
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ color: "#94a3b8", fontSize: "0.75rem", display: "block", marginBottom: "0.25rem" }}>Role</label>
            <select
              value={newUser.role}
              onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
              style={inputStyle}
            >
              {allRoles.map((r) => <option key={r.role} value={r.role}>{r.role}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button type="button" onClick={() => setShowCreate(false)} style={btnStyle("#334155")}>
              Cancel
            </button>
            <button type="submit" disabled={creating} style={btnStyle("#166534")}>
              {creating ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155", textAlign: "left" }}>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Username</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Email</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Role</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Active</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Approval Authority</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Created</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Password</th>
              <th style={{ padding: "0.75rem 1rem", color: "#94a3b8", fontWeight: 600 }}>Tools</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "0.75rem 1rem", color: "#e2e8f0" }}>{user.username}</td>
                <td style={{ padding: "0.75rem 1rem", color: "#e2e8f0" }}>{user.email}</td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <select
                    value={user.role}
                    disabled={saving === user.id}
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                    style={{
                      background: "#0f172a",
                      color: "#e2e8f0",
                      border: "1px solid #334155",
                      borderRadius: "4px",
                      padding: "0.25rem 0.5rem",
                    }}
                  >
                    {allRoles.map((r) => (
                      <option key={r.role} value={r.role}>{r.role}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <button
                    type="button"
                    disabled={saving === user.id}
                    onClick={() => handleToggleActive(user.id, user.is_active)}
                    style={{
                      background: user.is_active ? "#166534" : "#7f1d1d",
                      color: "#e2e8f0",
                      border: "none",
                      borderRadius: "4px",
                      padding: "0.25rem 0.75rem",
                      cursor: saving === user.id ? "not-allowed" : "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    {user.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <div style={{ display: "flex", gap: "0.625rem" }}>
                    {(["low", "medium", "high"] as const).map((level) => {
                      const checked = (user.approval_authority ?? []).includes(level);
                      const color = level === "low" ? "#166534" : level === "medium" ? "#78350f" : "#7f1d1d";
                      return (
                        <label
                          key={level}
                          title={`${checked ? "Remove" : "Grant"} ${level} approval authority`}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.25rem",
                            cursor: saving === user.id ? "not-allowed" : "pointer",
                            fontSize: "0.75rem",
                            background: checked ? color : "#1e293b",
                            border: `1px solid ${checked ? color : "#334155"}`,
                            borderRadius: "4px", padding: "2px 6px",
                            opacity: saving === user.id ? 0.5 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={saving === user.id}
                            onChange={() => handleAuthorityToggle(user.id, level, user.approval_authority ?? [])}
                            style={{ display: "none" }}
                          />
                          {level}
                        </label>
                      );
                    })}
                  </div>
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#94a3b8" }}>
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <button
                    type="button"
                    onClick={() => { setPwUser(user); setNewPw(""); }}
                    style={btnStyle("#4c1d95")}
                  >
                    Change
                  </button>
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <button
                    type="button"
                    onClick={() => openToolsPanel(user)}
                    style={btnStyle("#1e3a5f")}
                  >
                    Assign Tools
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Password change modal */}
      {pwUser && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60,
        }}>
          <form
            onSubmit={handleSavePassword}
            style={{
              background: "#1e293b", border: "1px solid #334155", borderRadius: "8px",
              padding: "1.5rem", width: "320px", display: "flex", flexDirection: "column", gap: "1rem",
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Change password</p>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "#94a3b8" }}>{pwUser.username}</p>
            <input
              required
              type="password"
              minLength={6}
              placeholder="New password (min 6 chars)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setPwUser(null)} style={btnStyle("#334155")}>Cancel</button>
              <button type="submit" disabled={savingPw} style={btnStyle("#6d28d9")}>
                {savingPw ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tool assignment side panel */}
      {editToolsFor && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "360px",
            height: "100vh",
            background: "#0f172a",
            borderLeft: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            zIndex: 50,
          }}
        >
          <div style={{ padding: "1.25rem", borderBottom: "1px solid #334155" }}>
            <p style={{ margin: "0 0 0.25rem", fontSize: "0.75rem", color: "#94a3b8" }}>Tool overrides for</p>
            <p style={{ margin: 0, fontWeight: 600 }}>{editToolsFor.username}</p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#64748b" }}>
              Leave all unchecked to use role defaults ({editToolsFor.role})
            </p>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
            {allTools.map((tool) => (
              <label
                key={tool.tool_name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  padding: "0.4rem 0",
                  cursor: "pointer",
                  borderBottom: "1px solid #1e293b",
                }}
              >
                <input
                  type="checkbox"
                  checked={userTools.includes(tool.tool_name)}
                  onChange={() => toggleTool(tool.tool_name)}
                  style={{ marginTop: "2px", flexShrink: 0 }}
                />
                <span>
                  <span style={{ fontSize: "0.8125rem", color: "#e2e8f0" }}>{tool.tool_name}</span>
                  {tool.risk_level !== "low" && (
                    <span
                      style={{
                        marginLeft: "0.4rem",
                        fontSize: "0.65rem",
                        background: tool.risk_level === "high" ? "#7f1d1d" : "#78350f",
                        color: "#fca5a5",
                        borderRadius: "3px",
                        padding: "1px 4px",
                      }}
                    >
                      {tool.risk_level}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div style={{ padding: "1rem", borderTop: "1px solid #334155", display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setEditToolsFor(null)}
              style={{ ...btnStyle("#334155"), flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingTools}
              onClick={handleSaveTools}
              style={{ ...btnStyle("#166534"), flex: 1 }}
            >
              {savingTools ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
