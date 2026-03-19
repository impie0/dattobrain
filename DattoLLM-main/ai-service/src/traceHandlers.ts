import type { Request, Response } from "express";
import type { Pool } from "pg";
import type { ExternalSpan } from "./tracing.js";
import { randomUUID } from "node:crypto";
import { truncatePayload } from "./tracing.js";

/* ── GET /api/admin/observability/traces ──────────────────────────────────── */

export async function handleListTraces(req: Request, res: Response, pool: Pool): Promise<void> {
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 50)));
  const offset = (page - 1) * pageSize;
  const search = (req.query["search"] as string | undefined) ?? "";
  const status = req.query["status"] as string | undefined;

  try {
    const conditions: string[] = ["t.created_at > NOW() - INTERVAL '30 days'"];
    const params: unknown[] = [];
    let paramIdx = 0;

    if (search) {
      paramIdx++;
      conditions.push(`t.question ILIKE $${paramIdx}`);
      params.push(`%${search}%`);
    }
    if (status) {
      paramIdx++;
      conditions.push(`t.status = $${paramIdx}`);
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM request_traces t ${where}`,
      params
    );
    const total = Number(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM request_trace_spans s WHERE s.trace_id = t.id) AS span_count
       FROM request_traces t
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      traces: dataRes.rows.map(r => ({
        id: r.id,
        sessionId: r.session_id,
        userId: r.user_id,
        username: r.username,
        question: r.question,
        status: r.status,
        toolCount: r.tool_count,
        totalDurationMs: r.total_duration_ms,
        errorMessage: r.error_message,
        createdAt: r.created_at,
        completedAt: r.completed_at,
        spanCount: Number(r.span_count),
      })),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

/* ── GET /api/admin/observability/traces/:traceId ─────────────────────────── */

interface SpanRow {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  service: string;
  operation: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  request_payload: unknown;
  response_payload: unknown;
  metadata: Record<string, unknown> | null;
  error_message: string | null;
}

interface SpanNode {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  service: string;
  operation: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  requestPayload: unknown;
  responsePayload: unknown;
  metadata: Record<string, unknown> | null;
  errorMessage: string | null;
  children: SpanNode[];
}

function buildSpanTree(rows: SpanRow[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Create nodes
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      traceId: r.trace_id,
      parentSpanId: r.parent_span_id,
      service: r.service,
      operation: r.operation,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationMs: r.duration_ms,
      requestPayload: r.request_payload,
      responsePayload: r.response_payload,
      metadata: r.metadata,
      errorMessage: r.error_message,
      children: [],
    });
  }

  // Build tree
  for (const node of nodes.values()) {
    if (node.parentSpanId && nodes.has(node.parentSpanId)) {
      nodes.get(node.parentSpanId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function handleGetTrace(req: Request, res: Response, pool: Pool): Promise<void> {
  const traceId = req.params["traceId"];
  try {
    const [traceRes, spansRes] = await Promise.all([
      pool.query(`SELECT * FROM request_traces WHERE id = $1`, [traceId]),
      pool.query(`SELECT * FROM request_trace_spans WHERE trace_id = $1 ORDER BY started_at`, [traceId]),
    ]);

    if (!traceRes.rows[0]) {
      res.status(404).json({ error: "trace_not_found" });
      return;
    }

    const t = traceRes.rows[0];
    const spans = buildSpanTree(spansRes.rows as SpanRow[]);

    res.json({
      trace: {
        id: t.id,
        sessionId: t.session_id,
        userId: t.user_id,
        username: t.username,
        question: t.question,
        status: t.status,
        toolCount: t.tool_count,
        totalDurationMs: t.total_duration_ms,
        errorMessage: t.error_message,
        createdAt: t.created_at,
        completedAt: t.completed_at,
      },
      spans,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

/* ── POST /api/internal/trace-spans — ingest from mcp-bridge ──────────────── */

export async function handleIngestSpans(req: Request, res: Response, pool: Pool): Promise<void> {
  const secret = req.headers["x-internal-secret"] as string | undefined;
  const expectedSecret = process.env["MCP_INTERNAL_SECRET"];

  if (!secret || secret !== expectedSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { traceId, spans } = req.body as { traceId?: string; spans?: ExternalSpan[] };
  if (!traceId || !Array.isArray(spans)) {
    res.status(400).json({ error: "traceId and spans[] required" });
    return;
  }

  for (const s of spans) {
    try {
      await pool.query(
        `INSERT INTO request_trace_spans
         (id, trace_id, parent_span_id, service, operation, status,
          started_at, ended_at, duration_ms,
          request_payload, response_payload, metadata, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING`,
        [
          s.id ?? randomUUID(),
          traceId,
          s.parentSpanId ?? null,
          s.service,
          s.operation,
          s.status,
          s.startedAt,
          s.endedAt ?? null,
          s.durationMs ?? null,
          s.requestPayload ? JSON.stringify(truncatePayload(s.requestPayload)) : null,
          s.responsePayload ? JSON.stringify(truncatePayload(s.responsePayload)) : null,
          s.metadata ? JSON.stringify(s.metadata) : null,
          s.errorMessage ?? null,
        ]
      );
    } catch { /* best effort */ }
  }

  res.json({ ingested: spans.length });
}
