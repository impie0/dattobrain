"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { chat, getHistory, getMyTools, setDataMode, type HistoryItem, type UserTool } from "@/lib/api";
import Link from "next/link";

const LS_MESSAGES_KEY = "chat_messages";
const LS_SESSION_KEY = "chat_session_id";

type Message = { role: "user" | "assistant"; text: string };

function decodeToken(): { role: string | null; userId: string | null } {
  try {
    const match = document.cookie.match(/token=([^;]+)/);
    if (!match) return { role: null, userId: null };
    const payload = match[1].split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return { role: decoded.role ?? null, userId: decoded.sub ?? null };
  } catch {
    return { role: null, userId: null };
  }
}

function riskBadge(level: string) {
  const colors: Record<string, string> = {
    low: "#16a34a",
    medium: "#d97706",
    high: "#dc2626",
  };
  return (
    <span
      style={{
        fontSize: "0.625rem",
        fontWeight: 700,
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: "3px",
        background: colors[level] ?? "#475569",
        color: "#fff",
        letterSpacing: "0.04em",
      }}
    >
      {level}
    </span>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [tools, setTools] = useState<UserTool[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [dataMode, setDataModeState] = useState<"cached" | "live">("cached");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auth check + initial data load
  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }

    const { role } = decodeToken();
    setUserRole(role);

    // Restore messages from localStorage
    try {
      const saved = localStorage.getItem(LS_MESSAGES_KEY);
      const sessionId = localStorage.getItem(LS_SESSION_KEY);
      if (saved) setMessages(JSON.parse(saved));
      if (sessionId) setActiveSession(sessionId);
    } catch { /* ignore */ }

    // Load sidebar data in parallel
    getHistory(30, 0).then((r) => setHistoryItems(r.items)).catch(() => {});
    getMyTools().then(setTools).catch(() => {});
  }, [router]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      localStorage.setItem(LS_MESSAGES_KEY, JSON.stringify(messages));
    } catch { /* ignore */ }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setActiveSession(null);
    setError("");
    setLoading(false);
    setDataModeState("cached");
    try {
      localStorage.removeItem(LS_MESSAGES_KEY);
      localStorage.removeItem(LS_SESSION_KEY);
    } catch { /* ignore */ }
    inputRef.current?.focus();
  }, []);

  const toggleDataMode = useCallback(async () => {
    const next = dataMode === "cached" ? "live" : "cached";
    setDataModeState(next);
    if (activeSession) {
      await setDataMode(activeSession, next).catch(() => {});
    }
  }, [dataMode, activeSession]);

  const loadHistoryItem = useCallback((item: HistoryItem) => {
    const restored: Message[] = [
      { role: "user", text: item.question ?? "Untitled" },
    ];
    if (item.answer) restored.push({ role: "assistant", text: item.answer });
    setMessages(restored);
    setActiveSession(item.id);
    setError("");
    try {
      localStorage.setItem(LS_MESSAGES_KEY, JSON.stringify(restored));
      localStorage.setItem(LS_SESSION_KEY, item.id);
    } catch { /* ignore */ }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    const q = question.trim();
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);
    setError("");
    try {
      const { conversation_id, answer } = await chat(q);
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      setActiveSession(conversation_id);
      // Persist data mode for this session on first message
      setDataMode(conversation_id, dataMode).catch(() => {});
      try { localStorage.setItem(LS_SESSION_KEY, conversation_id); } catch { /* ignore */ }
      // Refresh history sidebar
      getHistory(30, 0).then((r) => setHistoryItems(r.items)).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    document.cookie = "token=; path=/; max-age=0";
    try { localStorage.removeItem(LS_MESSAGES_KEY); localStorage.removeItem(LS_SESSION_KEY); } catch { /* ignore */ }
    router.replace("/login");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Top nav */}
      <header
        style={{
          padding: "0.75rem 1.25rem",
          borderBottom: "1px solid #334155",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.125rem" }}>Datto RMM AI Chat</h1>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Link href="/trace" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "0.875rem" }}>Trace</Link>
          <Link href="/history" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "0.875rem" }}>History</Link>
          <Link href="/approvals" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "0.875rem" }}>Approvals</Link>
          {userRole === "admin" && (
            <Link
              href="/admin/users"
              style={{
                color: "#e2e8f0",
                textDecoration: "none",
                background: "#1e3a5f",
                border: "1px solid #2563eb",
                borderRadius: "5px",
                padding: "0.25rem 0.625rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
              }}
            >
              Admin
            </Link>
          )}
          <button
            type="button"
            onClick={handleLogout}
            style={{
              background: "transparent",
              border: "1px solid #475569",
              color: "#94a3b8",
              padding: "0.375rem 0.75rem",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {/* Three-column body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* LEFT — History sidebar */}
        <aside
          style={{
            width: "220px",
            flexShrink: 0,
            borderRight: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "0.75rem 0.875rem", borderBottom: "1px solid #334155" }}>
            <button
              type="button"
              onClick={startNewChat}
              style={{
                width: "100%",
                padding: "0.5rem",
                background: "#1e40af",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "0.8125rem",
              }}
            >
              + New Chat
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0" }}>
            {historyItems.length === 0 && (
              <p style={{ color: "#475569", fontSize: "0.75rem", padding: "0.75rem", margin: 0 }}>No history yet.</p>
            )}
            {historyItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => loadHistoryItem(item)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.5rem 0.875rem",
                  background: activeSession === item.id ? "#1e293b" : "transparent",
                  border: "none",
                  borderLeft: activeSession === item.id ? "2px solid #3b82f6" : "2px solid transparent",
                  color: activeSession === item.id ? "#e2e8f0" : "#94a3b8",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: activeSession === item.id ? 600 : 400, marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(item.question ?? "Untitled").slice(0, 60)}{(item.question ?? "").length > 60 ? "…" : ""}
                </div>
                <div style={{ color: "#475569", fontSize: "0.6875rem" }}>
                  {new Date(item.created_at).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* MIDDLE — Chat area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.875rem",
            }}
          >
            {messages.length === 0 && (
              <p style={{ color: "#64748b", textAlign: "center", marginTop: "2rem" }}>
                Ask a question about your Datto RMM account (sites, devices, alerts, etc.).
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "0.875rem 1rem",
                  borderRadius: "12px",
                  background: m.role === "user" ? "#1e40af" : "#1e293b",
                  border: "1px solid #334155",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: "0.9375rem",
                  lineHeight: 1.55,
                }}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "0.875rem 1rem",
                  borderRadius: "12px",
                  background: "#1e293b",
                  border: "1px solid #334155",
                  color: "#94a3b8",
                  fontSize: "0.9375rem",
                }}
              >
                Thinking…
              </div>
            )}
            {error && (
              <p style={{ color: "#f87171", fontSize: "0.875rem", margin: 0 }}>{error}</p>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            style={{ padding: "0.875rem 1.25rem", borderTop: "1px solid #334155", flexShrink: 0 }}
          >
            {/* Data mode toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <button
                type="button"
                onClick={toggleDataMode}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.25rem 0.625rem",
                  borderRadius: "999px",
                  border: `1px solid ${dataMode === "live" ? "#16a34a" : "#334155"}`,
                  background: dataMode === "live" ? "#052e16" : "#1e293b",
                  color: dataMode === "live" ? "#4ade80" : "#64748b",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <span style={{
                  width: "7px", height: "7px", borderRadius: "50%",
                  background: dataMode === "live" ? "#4ade80" : "#475569",
                  display: "inline-block",
                }} />
                {dataMode === "live" ? "Live" : "Cached"}
              </button>
              <span style={{ fontSize: "0.6875rem", color: "#475569" }}>
                {dataMode === "live"
                  ? "Querying Datto API directly"
                  : "Using local cache — click for real-time data"}
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.625rem" }}>
              <input
                ref={inputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question…"
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "0.625rem 0.875rem",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  background: "#0f172a",
                  color: "#e2e8f0",
                  fontSize: "0.9375rem",
                }}
              />
              <button
                type="submit"
                disabled={loading || !question.trim()}
                style={{
                  padding: "0.625rem 1rem",
                  background: "#3b82f6",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: "0.9375rem",
                }}
              >
                Send
              </button>
            </div>
          </form>
        </div>

        {/* RIGHT — Tools panel */}
        <aside
          style={{
            width: "240px",
            flexShrink: 0,
            borderLeft: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "0.75rem 0.875rem", borderBottom: "1px solid #334155" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Available Tools
            </span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem 0" }}>
            {tools.length === 0 && (
              <p style={{ color: "#475569", fontSize: "0.75rem", padding: "0.75rem", margin: 0 }}>
                No tools available.
              </p>
            )}
            {tools.map((t) => (
              <div
                key={t.tool_name}
                style={{
                  padding: "0.625rem 0.875rem",
                  borderBottom: "1px solid #1e293b",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#34d399", fontFamily: "monospace" }}>
                    {t.tool_name}
                  </span>
                  {riskBadge(t.risk_level)}
                  {t.approval_required && (
                    <span style={{ fontSize: "0.625rem", color: "#fbbf24" }}>⚠ approval</span>
                  )}
                </div>
                {t.description && (
                  <p style={{ margin: 0, fontSize: "0.6875rem", color: "#64748b", lineHeight: 1.4 }}>
                    {t.description}
                  </p>
                )}
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.6875rem", color: "#475569", fontFamily: "monospace", fontStyle: "italic" }}>
                  e.g. &quot;{toolExample(t.tool_name)}&quot;
                </p>
              </div>
            ))}
          </div>
        </aside>

      </div>
    </div>
  );
}

function toolExample(toolName: string): string {
  const examples: Record<string, string> = {
    get_sites: "List all my sites",
    get_devices: "Show devices at site HQ",
    get_alerts: "What alerts are open?",
    get_agent_audit_history: "Show recent activity for device X",
    get_account_variables: "Show account variables",
    get_site_variables: "Show variables for site HQ",
    get_site_devices: "List devices at site London",
    get_site_alerts: "Any alerts at site Sydney?",
    patch_alert: "Resolve alert ID 123",
    get_device_open_alerts: "Open alerts for device XYZ",
    get_device_resolved_alerts: "Resolved alerts for device XYZ",
  };
  return examples[toolName] ?? `Use ${toolName}`;
}
