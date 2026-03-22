import { Pool } from "pg";
import { Request, Response } from "express";

function onlyAdmin(req: Request, res: Response): boolean {
  if ((req.headers["x-user-role"] as string) !== "admin") {
    res.status(403).json({ error: "admin only" });
    return false;
  }
  return true;
}

// ── Overview ──────────────────────────────────────────────────────────────

export async function handleObsOverview(req: Request, res: Response, pool: Pool): Promise<void> {
  if (!onlyAdmin(req, res)) return;
  try {
    const [reqs, sessions, tokens, tools, errors, modes, reqSeries, toolSeries, errSeries] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '5 minutes') AS r5m,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')    AS r1h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')  AS r24h
        FROM llm_request_logs`),

      pool.query(`
        SELECT COUNT(*) AS n
        FROM chat_sessions
        WHERE updated_at > NOW() - INTERVAL '15 minutes'`),

      pool.query(`
        SELECT
          COALESCE(SUM(token_count), 0)::bigint  AS total,
          COALESCE(AVG(token_count), 0)::numeric AS avg
        FROM chat_messages
        WHERE created_at > NOW() - INTERVAL '24 hours' AND token_count IS NOT NULL`),

      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '5 minutes') AS c5m,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')    AS c1h
        FROM audit_logs WHERE event_type = 'tool_call'`),

      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')   AS e1h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS e24h
        FROM audit_logs
        WHERE event_type IN ('tool_error','tool_denied','api_error')`),

      pool.query(`
        SELECT data_mode, COUNT(*) AS n
        FROM chat_sessions
        WHERE updated_at > NOW() - INTERVAL '24 hours'
        GROUP BY data_mode`),

      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) AS t, COUNT(*) AS v
        FROM llm_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t ORDER BY t`),

      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) AS t, COUNT(*) AS v
        FROM audit_logs
        WHERE event_type = 'tool_call' AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t ORDER BY t`),

      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) AS t, COUNT(*) AS v
        FROM audit_logs
        WHERE event_type IN ('tool_error','tool_denied') AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t ORDER BY t`),
    ]);

    const r  = reqs.rows[0];
    const t  = tools.rows[0];
    const e  = errors.rows[0];
    const tk = tokens.rows[0];

    res.json({
      requests:       { last5m: +r.r5m,    last1h: +r.r1h,    last24h: +r.r24h },
      activeSessions: +sessions.rows[0].n,
      tokens:         { last24h: +tk.total, avg: Math.round(+tk.avg) },
      toolCalls:      { last5m: +t.c5m,    last1h: +t.c1h },
      errors:         { last1h: +e.e1h,    last24h: +e.e24h },
      cacheMode: Object.fromEntries(
        modes.rows.map((row: { data_mode: string; n: string }) => [row.data_mode, +row.n])
      ),
      series: {
        requests:  reqSeries.rows.map( (row: { t: Date; v: string }) => ({ t: row.t, v: +row.v })),
        toolCalls: toolSeries.rows.map((row: { t: Date; v: string }) => ({ t: row.t, v: +row.v })),
        errors:    errSeries.rows.map( (row: { t: Date; v: string }) => ({ t: row.t, v: +row.v })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── LLM / Tokens ──────────────────────────────────────────────────────────

export async function handleObsLlm(req: Request, res: Response, pool: Pool): Promise<void> {
  if (!onlyAdmin(req, res)) return;
  try {
    const [summary, byOrch, bySynth, byProvider, tokenSeries, recent] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS total_24h,
          COALESCE(SUM(total_tokens) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) AS tokens_24h,
          COALESCE(SUM(orch_total_tokens) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) AS orch_tokens_24h,
          COALESCE(SUM(synth_total_tokens) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) AS synth_tokens_24h,
          COALESCE(AVG(total_tokens) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours' AND total_tokens > 0), 0) AS avg_tokens,
          COALESCE(AVG(orch_total_tokens) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours' AND orch_total_tokens > 0), 0) AS avg_orch_tokens,
          COALESCE(AVG(synth_total_tokens) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours' AND synth_total_tokens > 0), 0) AS avg_synth_tokens,
          COUNT(*) FILTER (WHERE prequery_hit = true AND created_at > NOW() - INTERVAL '24 hours') AS prequery_hits_24h,
          COALESCE(AVG(orch_iterations) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours' AND orch_iterations > 0), 0) AS avg_iterations
        FROM llm_request_logs`),

      pool.query(`
        SELECT orchestrator_model AS model, COUNT(*) AS count,
               COALESCE(SUM(orch_total_tokens), 0) AS tokens,
               COALESCE(AVG(orch_total_tokens), 0)::int AS avg_tokens
        FROM llm_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours' AND orchestrator_model IS NOT NULL
        GROUP BY orchestrator_model ORDER BY count DESC`),

      pool.query(`
        SELECT synthesizer_model AS model, COUNT(*) AS count,
               COALESCE(SUM(synth_total_tokens), 0) AS tokens,
               COALESCE(AVG(synth_total_tokens), 0)::int AS avg_tokens
        FROM llm_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours' AND synthesizer_model IS NOT NULL
        GROUP BY synthesizer_model ORDER BY count DESC`),

      pool.query(`
        SELECT
          COALESCE(orchestrator_provider, 'unknown') AS provider,
          'orchestrator' AS stage,
          COUNT(*) AS count,
          COALESCE(SUM(orch_total_tokens), 0) AS tokens
        FROM llm_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY orchestrator_provider
        UNION ALL
        SELECT
          COALESCE(synth_provider, 'unknown') AS provider,
          'synthesizer' AS stage,
          COUNT(*) AS count,
          COALESCE(SUM(synth_total_tokens), 0) AS tokens
        FROM llm_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours' AND synthesizer_model IS NOT NULL
        GROUP BY synth_provider
        ORDER BY stage, provider`),

      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) AS t,
               COALESCE(SUM(total_tokens), 0) AS total,
               COALESCE(SUM(orch_total_tokens), 0) AS orch,
               COALESCE(SUM(synth_total_tokens), 0) AS synth
        FROM llm_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t ORDER BY t`),

      pool.query(`
        SELECT l.id, l.created_at, l.orchestrator_model, l.synthesizer_model,
               l.orchestrator_provider, l.synth_provider, l.data_mode,
               l.orch_prompt_tokens, l.orch_completion_tokens, l.orch_total_tokens,
               l.synth_prompt_tokens, l.synth_completion_tokens, l.synth_total_tokens,
               l.total_tokens, l.orch_iterations, l.tool_result_chars,
               l.tools_called, l.prequery_hit, l.prequery_tool, u.username
        FROM llm_request_logs l
        LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC
        LIMIT 100`),
    ]);

    const s = summary.rows[0];
    res.json({
      summary: {
        total: +s.total,
        total24h: +s.total_24h,
        tokens24h: +s.tokens_24h,
        orchTokens24h: +s.orch_tokens_24h,
        synthTokens24h: +s.synth_tokens_24h,
        avgTokens: Math.round(+s.avg_tokens),
        avgOrchTokens: Math.round(+s.avg_orch_tokens),
        avgSynthTokens: Math.round(+s.avg_synth_tokens),
        prequeryHits24h: +s.prequery_hits_24h,
        avgIterations: Math.round(+s.avg_iterations * 10) / 10,
      },
      byOrchModel:  byOrch.rows.map( (r: { model: string; count: string; tokens: string; avg_tokens: number }) => ({ model: r.model, count: +r.count, tokens: +r.tokens, avgTokens: r.avg_tokens })),
      bySynthModel: bySynth.rows.map((r: { model: string; count: string; tokens: string; avg_tokens: number }) => ({ model: r.model, count: +r.count, tokens: +r.tokens, avgTokens: r.avg_tokens })),
      byProvider:   byProvider.rows.map((r: { provider: string; stage: string; count: string; tokens: string }) => ({ provider: r.provider, stage: r.stage, count: +r.count, tokens: +r.tokens })),
      tokenSeries:  tokenSeries.rows.map((r: { t: Date; total: string; orch: string; synth: string }) => ({
        t: r.t, total: +r.total || 0, orch: +r.orch || 0, synth: +r.synth || 0,
      })),
      recent:       recent.rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Tool Calls ─────────────────────────────────────────────────────────────

export async function handleObsTools(req: Request, res: Response, pool: Pool): Promise<void> {
  if (!onlyAdmin(req, res)) return;
  try {
    const [topTools, callSeries, recent] = await Promise.all([
      pool.query(`
        SELECT
          tool_name,
          COUNT(*) FILTER (WHERE event_type = 'tool_call')  AS calls,
          COUNT(*) FILTER (WHERE event_type = 'tool_error') AS errors
        FROM audit_logs
        WHERE event_type IN ('tool_call','tool_error')
          AND created_at > NOW() - INTERVAL '24 hours'
          AND tool_name IS NOT NULL
        GROUP BY tool_name
        ORDER BY calls DESC
        LIMIT 20`),

      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) AS t, COUNT(*) AS v
        FROM audit_logs
        WHERE event_type = 'tool_call' AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t ORDER BY t`),

      pool.query(`
        SELECT a.id, a.tool_name, a.event_type, a.created_at, a.metadata, u.username
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.event_type IN ('tool_call','tool_error')
        ORDER BY a.created_at DESC
        LIMIT 100`),
    ]);

    res.json({
      topTools: topTools.rows.map((r: { tool_name: string; calls: string; errors: string }) => ({
        tool_name:  r.tool_name,
        calls:      +r.calls,
        errors:     +r.errors,
        error_rate: +r.calls > 0 ? Math.round((+r.errors / +r.calls) * 100) : 0,
      })),
      callSeries: callSeries.rows.map((r: { t: Date; v: string }) => ({ t: r.t, v: +r.v })),
      recent:     recent.rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── MCP Server ─────────────────────────────────────────────────────────────

export async function handleObsMcp(req: Request, res: Response, pool: Pool): Promise<void> {
  if (!onlyAdmin(req, res)) return;
  try {
    const mcpBridgeUrl = process.env["MCP_BRIDGE_URL"] ?? "http://mcp-bridge:4001";

    // Probe bridge with a short timeout; treat any success as "up"
    let mcpStatus = "unknown";
    try {
      const r = await fetch(`${mcpBridgeUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      mcpStatus = r.ok ? "up" : "degraded";
    } catch {
      mcpStatus = "down";
    }

    const [stats, errSeries, recentErrors, topDenied] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'tool_call')  AS calls_1h,
          COUNT(*) FILTER (WHERE event_type = 'tool_error') AS errors_1h,
          COUNT(*) FILTER (WHERE event_type = 'tool_denied') AS denied_1h,
          COUNT(*) FILTER (WHERE event_type = 'tool_call'
            AND created_at > NOW() - INTERVAL '5 minutes')  AS calls_5m
        FROM audit_logs
        WHERE created_at > NOW() - INTERVAL '1 hour'`),

      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) AS t, COUNT(*) AS v
        FROM audit_logs
        WHERE event_type = 'tool_error' AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t ORDER BY t`),

      pool.query(`
        SELECT a.tool_name, a.event_type, a.created_at, a.metadata, u.username
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.event_type IN ('tool_error','tool_denied')
        ORDER BY a.created_at DESC
        LIMIT 50`),

      pool.query(`
        SELECT tool_name, COUNT(*) AS count
        FROM audit_logs
        WHERE event_type = 'tool_denied'
          AND created_at > NOW() - INTERVAL '24 hours'
          AND tool_name IS NOT NULL
        GROUP BY tool_name
        ORDER BY count DESC
        LIMIT 10`),
    ]);

    const s     = stats.rows[0];
    const calls = +s.calls_1h;
    const errs  = +s.errors_1h;

    res.json({
      health:  { status: mcpStatus, checked_at: new Date() },
      stats: {
        calls1h:   calls,
        calls5m:   +s.calls_5m,
        errors1h:  errs,
        denied1h:  +s.denied_1h,
        errorRate: calls > 0 ? Math.round((errs / calls) * 100) : 0,
      },
      errSeries:    errSeries.rows.map((r: { t: Date; v: string }) => ({ t: r.t, v: +r.v })),
      recentErrors: recentErrors.rows,
      topDenied:    topDenied.rows.map((r: { tool_name: string; count: string }) => ({ tool_name: r.tool_name, count: +r.count })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Chat / Usage ───────────────────────────────────────────────────────────

export async function handleObsChat(req: Request, res: Response, pool: Pool): Promise<void> {
  if (!onlyAdmin(req, res)) return;
  try {
    const [summary, msgSeries, activeSessions] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM chat_sessions
           WHERE created_at > NOW() - INTERVAL '24 hours') AS sessions_24h,
          (SELECT COUNT(*) FROM chat_messages
           WHERE created_at > NOW() - INTERVAL '24 hours') AS messages_24h,
          (SELECT COUNT(*) FROM chat_sessions
           WHERE updated_at > NOW() - INTERVAL '15 minutes') AS active_15m,
          (SELECT COALESCE(AVG(c), 0)::numeric
           FROM (SELECT COUNT(*) AS c FROM chat_messages
                 WHERE created_at > NOW() - INTERVAL '24 hours'
                 GROUP BY session_id) sub
          ) AS avg_msgs`),

      pool.query(`
        SELECT DATE_TRUNC('hour', created_at) AS t, COUNT(*) AS v
        FROM chat_messages
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY t ORDER BY t`),

      pool.query(`
        SELECT s.id, s.data_mode, s.updated_at, u.username,
               (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
        FROM chat_sessions s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.updated_at > NOW() - INTERVAL '15 minutes'
        ORDER BY s.updated_at DESC
        LIMIT 50`),
    ]);

    const sm = summary.rows[0];
    res.json({
      summary: {
        sessions24h:       +sm.sessions_24h,
        messages24h:       +sm.messages_24h,
        active15m:         +sm.active_15m,
        avgMsgsPerSession: Math.round(+sm.avg_msgs * 10) / 10,
      },
      msgSeries:      msgSeries.rows.map((r: { t: Date; v: string }) => ({ t: r.t, v: +r.v })),
      activeSessions: activeSessions.rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// ── Cache ──────────────────────────────────────────────────────────────────

export async function handleObsCache(req: Request, res: Response, pool: Pool): Promise<void> {
  if (!onlyAdmin(req, res)) return;
  try {
    const [syncHistory, modeDistrib, tableCounts] = await Promise.all([
      pool.query(`
        SELECT id, started_at, completed_at, triggered_by, status,
               sites_synced, devices_synced, alerts_open_synced,
               audit_errors, error, last_api_error,
               EXTRACT(EPOCH FROM (completed_at - started_at))::int AS duration_secs
        FROM datto_sync_log
        ORDER BY started_at DESC
        LIMIT 20`),

      pool.query(`
        SELECT data_mode, COUNT(*) AS n
        FROM chat_sessions
        GROUP BY data_mode`),

      pool.query(`
        SELECT 'sites'            AS name, COUNT(*) AS n FROM datto_cache_sites
        UNION ALL
        SELECT 'devices',                  COUNT(*)      FROM datto_cache_devices
        UNION ALL
        SELECT 'alerts_open',              COUNT(*)
          FROM datto_cache_alerts WHERE resolved = false
        UNION ALL
        SELECT 'alerts_resolved',          COUNT(*)
          FROM datto_cache_alerts WHERE resolved = true
        UNION ALL
        SELECT 'users',                    COUNT(*)      FROM datto_cache_users
        UNION ALL
        SELECT 'device_audits',            COUNT(*)      FROM datto_cache_device_audit
        UNION ALL
        SELECT 'software',                 COUNT(*)      FROM datto_cache_device_software`),
    ]);

    res.json({
      syncHistory:  syncHistory.rows,
      modeDistrib:  Object.fromEntries(
        modeDistrib.rows.map((r: { data_mode: string; n: string }) => [r.data_mode, +r.n])
      ),
      tableCounts:  tableCounts.rows.map((r: { name: string; n: string }) => ({ name: r.name, count: +r.n })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
