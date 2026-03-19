import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface ExternalSpan {
  id?: string;
  parentSpanId?: string;
  service: string;
  operation: string;
  status: "ok" | "error";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

/* ── Payload truncation ────────────────────────────────────────────────────── */

const MAX_PAYLOAD_BYTES = 50_000;

export function truncatePayload(obj: unknown): unknown {
  if (obj === undefined || obj === null) return null;
  const json = JSON.stringify(obj);
  if (json.length <= MAX_PAYLOAD_BYTES) return obj;
  return {
    _truncated: true,
    _originalSize: json.length,
    _preview: json.slice(0, 1000),
  };
}

/* ── SpanHandle — returned by startSpan, call end() when done ─────────────── */

export class SpanHandle {
  readonly spanId: string;
  private _pool: Pool;
  private _traceId: string;
  private _startedAt: Date;
  private _requestPayload: unknown;

  constructor(pool: Pool, traceId: string, spanId: string, requestPayload: unknown) {
    this._pool = pool;
    this._traceId = traceId;
    this.spanId = spanId;
    this._startedAt = new Date();
    this._requestPayload = requestPayload;
  }

  async end(
    status: "ok" | "error" = "ok",
    opts?: {
      responsePayload?: unknown;
      errorMessage?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - this._startedAt.getTime();
    try {
      await this._pool.query(
        `UPDATE request_trace_spans
         SET ended_at = $1, duration_ms = $2, status = $3,
             response_payload = $4, error_message = $5, metadata = $6
         WHERE id = $7`,
        [
          endedAt.toISOString(),
          durationMs,
          status,
          truncatePayload(opts?.responsePayload) ? JSON.stringify(truncatePayload(opts?.responsePayload)) : null,
          opts?.errorMessage ?? null,
          opts?.metadata ? JSON.stringify(opts.metadata) : null,
          this.spanId,
        ]
      );
    } catch { /* best effort */ }
  }
}

/* ── TraceContext — one per chat request ───────────────────────────────────── */

export class TraceContext {
  readonly traceId: string;
  private _pool: Pool;
  private _startedAt: Date;

  constructor(
    pool: Pool,
    traceId: string,
  ) {
    this._pool = pool;
    this.traceId = traceId;
    this._startedAt = new Date();
  }

  /** Create the trace row in the DB. Call once at the start of the request. */
  async init(opts: {
    userId?: string;
    username?: string;
    sessionId?: string;
    question?: string;
  }): Promise<void> {
    try {
      await this._pool.query(
        `INSERT INTO request_traces (id, session_id, user_id, username, question, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'in_progress', $6)`,
        [
          this.traceId,
          opts.sessionId ?? null,
          opts.userId ?? null,
          opts.username ?? null,
          opts.question ? opts.question.slice(0, 500) : null,
          this._startedAt.toISOString(),
        ]
      );
    } catch { /* best effort — don't break the request */ }
  }

  /** Start a new span. Inserts the row immediately; call handle.end() when done. */
  async startSpan(
    service: string,
    operation: string,
    opts?: {
      parentSpanId?: string;
      requestPayload?: unknown;
    }
  ): Promise<SpanHandle> {
    const spanId = randomUUID();
    const now = new Date();
    try {
      await this._pool.query(
        `INSERT INTO request_trace_spans
         (id, trace_id, parent_span_id, service, operation, started_at, request_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          spanId,
          this.traceId,
          opts?.parentSpanId ?? null,
          service,
          operation,
          now.toISOString(),
          truncatePayload(opts?.requestPayload) ? JSON.stringify(truncatePayload(opts?.requestPayload)) : null,
        ]
      );
    } catch { /* best effort */ }
    return new SpanHandle(this._pool, this.traceId, spanId, opts?.requestPayload);
  }

  /** Mark the trace as completed or errored. Updates tool_count and duration. */
  async complete(
    status: "completed" | "error",
    opts?: { toolCount?: number; errorMessage?: string }
  ): Promise<void> {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this._startedAt.getTime();
    try {
      await this._pool.query(
        `UPDATE request_traces
         SET status = $1, completed_at = $2, total_duration_ms = $3,
             tool_count = $4, error_message = $5
         WHERE id = $6`,
        [
          status,
          completedAt.toISOString(),
          durationMs,
          opts?.toolCount ?? 0,
          opts?.errorMessage ?? null,
          this.traceId,
        ]
      );
    } catch { /* best effort */ }
  }

  /** Ingest spans from external services (mcp-bridge, mcp-server). */
  async ingestExternalSpans(spans: ExternalSpan[]): Promise<void> {
    for (const s of spans) {
      try {
        await this._pool.query(
          `INSERT INTO request_trace_spans
           (id, trace_id, parent_span_id, service, operation, status,
            started_at, ended_at, duration_ms,
            request_payload, response_payload, metadata, error_message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            s.id ?? randomUUID(),
            this.traceId,
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
  }
}
