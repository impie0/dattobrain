"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getTraceDetail, type TraceDetail, type TraceSpanNode } from "@/lib/api";

/* ── Service colour map ──────────────────────────────────────────────────── */

const SERVICE_COLORS: Record<string, string> = {
  "ai-service":        "#3b82f6",
  "mcp-bridge":        "#8b5cf6",
  "mcp-server":        "#f59e0b",
  "datto-api":         "#22c55e",
  "litellm":           "#06b6d4",
  "auth-service":      "#ec4899",
  "embedding-service": "#a855f7",
};

function serviceColor(s: string): string {
  return SERVICE_COLORS[s] ?? "#94a3b8";
}

/* ── JSON code viewer ────────────────────────────────────────────────────── */

function JsonViewer({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  if (data === null || data === undefined) return null;

  let text: string;
  try {
    text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none", border: "none", color: "#3b82f6",
          cursor: "pointer", padding: 0, fontSize: "0.75rem", fontWeight: 500,
        }}
      >
        {open ? "Hide" : "Show"} {label} ({text.length > 1000 ? `${Math.round(text.length / 1024)}KB` : `${text.length}ch`})
      </button>
      {open && (
        <pre style={{
          background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6,
          padding: "0.75rem", marginTop: 4, maxHeight: 400, overflow: "auto",
          fontSize: "0.6875rem", lineHeight: 1.5, color: "#e2e8f0",
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {text}
        </pre>
      )}
    </div>
  );
}

/* ── Single span row ─────────────────────────────────────────────────────── */

function SpanRow({ span, traceStartMs, traceDurationMs, depth }: {
  span: TraceSpanNode;
  traceStartMs: number;
  traceDurationMs: number;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const spanStartMs = new Date(span.startedAt).getTime();
  const spanDur = span.durationMs ?? 0;
  const offsetPct = traceDurationMs > 0 ? ((spanStartMs - traceStartMs) / traceDurationMs) * 100 : 0;
  const widthPct = traceDurationMs > 0 ? Math.max((spanDur / traceDurationMs) * 100, 0.5) : 100;
  const sColor = serviceColor(span.service);
  const isError = span.status === "error";

  return (
    <>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0.5rem 0.75rem", paddingLeft: `${0.75 + depth * 1.5}rem`,
          borderLeft: `3px solid ${isError ? "#ef4444" : sColor}`,
          borderBottom: "1px solid #1e293b",
          cursor: "pointer",
          background: expanded ? "#1e293b40" : "transparent",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = "#1e293b20"; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
      >
        {/* Service badge */}
        <span style={{
          background: sColor + "20", color: sColor, border: `1px solid ${sColor}40`,
          borderRadius: 4, padding: "1px 6px", fontSize: "0.625rem", fontWeight: 600,
          whiteSpace: "nowrap", minWidth: 70, textAlign: "center",
        }}>
          {span.service}
        </span>

        {/* Operation name */}
        <span style={{ color: "#e2e8f0", fontSize: "0.8125rem", fontWeight: 500, minWidth: 160 }}>
          {span.operation}
        </span>

        {/* Timeline bar */}
        <div style={{ flex: 1, height: 14, background: "#0f172a", borderRadius: 3, position: "relative", overflow: "hidden" }}>
          <div style={{
            position: "absolute", left: `${Math.min(offsetPct, 99)}%`, width: `${Math.min(widthPct, 100 - offsetPct)}%`,
            height: "100%", background: sColor, borderRadius: 3, opacity: 0.7,
          }} />
        </div>

        {/* Duration */}
        <span style={{
          color: spanDur > 2000 ? "#f59e0b" : "#94a3b8",
          fontSize: "0.75rem", fontWeight: 500, minWidth: 55, textAlign: "right",
        }}>
          {spanDur >= 1000 ? `${(spanDur / 1000).toFixed(1)}s` : `${spanDur}ms`}
        </span>

        {/* Error indicator */}
        {isError && (
          <span style={{ color: "#ef4444", fontSize: "0.625rem", fontWeight: 600 }}>ERR</span>
        )}

        {/* Expand arrow */}
        <span style={{ color: "#475569", fontSize: "0.75rem", transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "none" }}>
          ▶
        </span>
      </div>

      {/* Expanded payload view */}
      {expanded && (
        <div style={{
          paddingLeft: `${0.75 + depth * 1.5 + 1.5}rem`, paddingRight: "1rem",
          paddingTop: "0.5rem", paddingBottom: "0.75rem",
          borderLeft: `3px solid ${isError ? "#ef4444" : sColor}`,
          borderBottom: "1px solid #1e293b",
          background: "#0f172a30",
        }}>
          {/* Metadata badges */}
          {span.metadata && Object.keys(span.metadata).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {Object.entries(span.metadata).map(([k, v]) => (
                <span key={k} style={{
                  background: "#1e293b", border: "1px solid #334155", borderRadius: 4,
                  padding: "2px 8px", fontSize: "0.6875rem", color: "#94a3b8",
                }}>
                  <span style={{ color: "#64748b" }}>{k}:</span>{" "}
                  <span style={{ color: "#e2e8f0" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                </span>
              ))}
            </div>
          )}

          {/* Error message */}
          {span.errorMessage && (
            <div style={{
              background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6,
              padding: "0.5rem 0.75rem", marginBottom: 8, color: "#f87171", fontSize: "0.75rem",
            }}>
              {span.errorMessage}
            </div>
          )}

          {/* Payload viewers */}
          <JsonViewer data={span.requestPayload} label="Request Payload" />
          <JsonViewer data={span.responsePayload} label="Response Payload" />

          {/* Timing info */}
          <div style={{ marginTop: 8, fontSize: "0.6875rem", color: "#475569" }}>
            Started: {new Date(span.startedAt).toISOString()}{" "}
            {span.endedAt && `| Ended: ${new Date(span.endedAt).toISOString()}`}{" "}
            | Duration: {spanDur}ms
          </div>
        </div>
      )}

      {/* Recursive children */}
      {span.children.map(child => (
        <SpanRow key={child.id} span={child} traceStartMs={traceStartMs} traceDurationMs={traceDurationMs} depth={depth + 1} />
      ))}
    </>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export default function TraceDetailPage() {
  const params = useParams();
  const traceId = params.id as string;
  const [data, setData] = useState<TraceDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await getTraceDetail(traceId);
      setData(d);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [traceId]);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { window.location.href = "/login"; return; }
    load();
    // Auto-refresh for in-progress traces
    const iv = setInterval(load, 5_000);
    return () => clearInterval(iv);
  }, [load]);

  const trace = data?.trace;
  const spans = data?.spans ?? [];

  // Compute timeline bounds
  const allSpanTimes = flattenSpans(spans);
  const traceStartMs = allSpanTimes.length > 0
    ? Math.min(...allSpanTimes.map(s => new Date(s.startedAt).getTime()))
    : 0;
  const traceEndMs = allSpanTimes.length > 0
    ? Math.max(...allSpanTimes.map(s => s.endedAt ? new Date(s.endedAt).getTime() : new Date(s.startedAt).getTime() + (s.durationMs ?? 0)))
    : 0;
  const traceDurationMs = traceEndMs - traceStartMs;

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: "0.5rem" }}>
        <Link href="/admin/observability" style={{ color: "#3b82f6", textDecoration: "none", fontSize: "0.8125rem" }}>
          Observability
        </Link>
        <span style={{ color: "#475569", margin: "0 0.5rem" }}>/</span>
        <Link href="/admin/observability/traces" style={{ color: "#3b82f6", textDecoration: "none", fontSize: "0.8125rem" }}>
          Traces
        </Link>
        <span style={{ color: "#475569", margin: "0 0.5rem" }}>/</span>
        <span style={{ color: "#94a3b8", fontSize: "0.8125rem" }}>{traceId.slice(0, 8)}...</span>
      </div>

      {error && (
        <div style={{ background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", color: "#f87171", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {trace && (
        <>
          {/* Header card */}
          <div style={{
            background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
            padding: "1.25rem", marginBottom: "1rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.125rem" }}>
                  {trace.question ?? "No question"}
                </h2>
                <div style={{ color: "#64748b", fontSize: "0.8125rem", marginTop: 4 }}>
                  by {trace.username ?? "unknown"} &middot; {new Date(trace.createdAt).toLocaleString()}
                </div>
              </div>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 12px", borderRadius: 9999,
                background: trace.status === "completed" ? "#22c55e15" : trace.status === "error" ? "#ef444415" : "#f59e0b15",
                color: trace.status === "completed" ? "#22c55e" : trace.status === "error" ? "#ef4444" : "#f59e0b",
                fontSize: "0.75rem", fontWeight: 600,
              }}>
                {trace.status}
              </span>
            </div>

            <div style={{ display: "flex", gap: "2rem" }}>
              <div>
                <div style={{ color: "#64748b", fontSize: "0.6875rem", textTransform: "uppercase" }}>Duration</div>
                <div style={{ fontWeight: 600, fontSize: "1.125rem", color: trace.totalDurationMs && trace.totalDurationMs > 10000 ? "#f59e0b" : "#e2e8f0" }}>
                  {trace.totalDurationMs ? `${(trace.totalDurationMs / 1000).toFixed(2)}s` : "—"}
                </div>
              </div>
              <div>
                <div style={{ color: "#64748b", fontSize: "0.6875rem", textTransform: "uppercase" }}>Tools Called</div>
                <div style={{ fontWeight: 600, fontSize: "1.125rem", color: trace.toolCount > 0 ? "#f59e0b" : "#e2e8f0" }}>
                  {trace.toolCount}
                </div>
              </div>
              <div>
                <div style={{ color: "#64748b", fontSize: "0.6875rem", textTransform: "uppercase" }}>Spans</div>
                <div style={{ fontWeight: 600, fontSize: "1.125rem" }}>{allSpanTimes.length}</div>
              </div>
              <div>
                <div style={{ color: "#64748b", fontSize: "0.6875rem", textTransform: "uppercase" }}>Trace ID</div>
                <div style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#94a3b8" }}>{trace.id}</div>
              </div>
            </div>

            {trace.errorMessage && (
              <div style={{
                background: "#2d1a1a", border: "1px solid #dc2626", borderRadius: 6,
                padding: "0.5rem 0.75rem", marginTop: 12, color: "#f87171", fontSize: "0.8125rem",
              }}>
                {trace.errorMessage}
              </div>
            )}
          </div>

          {/* Service legend */}
          <div style={{ display: "flex", gap: 12, marginBottom: "0.75rem" }}>
            {Object.entries(SERVICE_COLORS).map(([name, color]) => (
              <span key={name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.6875rem", color: "#94a3b8" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
                {name}
              </span>
            ))}
          </div>

          {/* Timeline header */}
          <div style={{
            background: "#1e293b", border: "1px solid #334155", borderRadius: 8, overflow: "hidden",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "0.5rem 0.75rem",
              borderBottom: "1px solid #334155",
              fontSize: "0.6875rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              <span style={{ minWidth: 70 }}>Service</span>
              <span style={{ minWidth: 160 }}>Operation</span>
              <span style={{ flex: 1 }}>Timeline</span>
              <span style={{ minWidth: 55, textAlign: "right" }}>Duration</span>
              <span style={{ width: 24 }} />
              <span style={{ width: 16 }} />
            </div>

            {/* Span tree */}
            {spans.map(span => (
              <SpanRow
                key={span.id}
                span={span}
                traceStartMs={traceStartMs}
                traceDurationMs={traceDurationMs}
                depth={0}
              />
            ))}

            {spans.length === 0 && (
              <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>
                No spans recorded for this trace
              </div>
            )}
          </div>
        </>
      )}

      {!trace && !error && (
        <div style={{ padding: "2rem", textAlign: "center", color: "#475569" }}>Loading...</div>
      )}
    </div>
  );
}

/* ── Flatten nested spans for time bounds calculation ─────────────────────── */

function flattenSpans(spans: TraceSpanNode[]): TraceSpanNode[] {
  const result: TraceSpanNode[] = [];
  for (const s of spans) {
    result.push(s);
    if (s.children.length > 0) {
      result.push(...flattenSpans(s.children));
    }
  }
  return result;
}
