import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { pool } from "./db.js";
import { toolRegistry } from "./toolRegistry.js";
import { loadHistory, saveMessages } from "./history.js";
import { callTool } from "./mcpBridge.js";
import { buildSystemPrompt, buildSynthesizerPrompt } from "./prompt.js";
import { executeCachedTool, isLiveOnlyTool } from "./cachedQueries.js";
import { checkAndAuditToolPermission, toolDeniedMessage } from "./permissions.js";
import {
  getRoutingConfig,
  selectOrchestratorModel,
  selectSynthesizerModel,
  checkHighRiskInScope,
} from "./llmConfig.js";
import { llmClient, synthesize } from "./modelRouter.js";
import { TraceContext } from "./tracing.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

/**
 * SEC-015b: Compress conversation messages for Stage 2.
 * Tool results can be huge (full device lists, audit data). The synthesizer
 * only needs enough to write a summary. Truncate large tool results to fit
 * within the target model's context window (~120k chars ≈ 30k tokens safe).
 */
const STAGE2_MAX_CHARS = 120_000;
const TOOL_RESULT_MAX = 12_000;

function compressForSynthesizer(
  msgs: OpenAI.ChatCompletionMessageParam[]
): OpenAI.ChatCompletionMessageParam[] {
  const totalChars = msgs.reduce(
    (s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0
  );
  if (totalChars <= STAGE2_MAX_CHARS) return msgs;

  log("info", "stage2_context_compression", { totalChars, targetMax: STAGE2_MAX_CHARS });
  return msgs.map(m => {
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > TOOL_RESULT_MAX) {
      return {
        ...m,
        content: m.content.slice(0, TOOL_RESULT_MAX) +
          `\n\n[... truncated from ${m.content.length} chars for synthesis — full data was used in Stage 1]`,
      };
    }
    return m;
  });
}

// POST /api/chat — synchronous JSON response for web-app compatibility
export async function handleLegacyChat(req: Request, res: Response): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  const allowedToolsHeader = req.headers["x-allowed-tools"] as string | undefined;
  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? randomUUID();
  const { question, message } = req.body as { question?: string; message?: string };
  // SEC-MCP-001: Extract JWT so the MCP bridge can independently verify permissions
  const authHeader = req.headers["authorization"] as string | undefined;
  const jwtToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  const text = question ?? message;
  if (!text) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  if (!userId) {
    res.status(401).json({ error: "missing x-user-id header" });
    return;
  }

  let allowedTools: string[] = [];
  if (allowedToolsHeader) {
    try {
      allowedTools = JSON.parse(allowedToolsHeader) as string[];
    } catch {
      allowedTools = [];
    }
  }

  const requestId = randomUUID();

  // ── Tracing ─────────────────────────────────────────────────────────────
  const trace = new TraceContext(pool, requestId);
  await trace.init({ userId, sessionId, question: text });

  try {
    const rootSpan = await trace.startSpan("ai-service", "incoming_request", {
      requestPayload: {
        message: text.slice(0, 500),
        sessionId,
        allowedTools,
        headers: { "x-user-id": userId, "x-user-role": req.headers["x-user-role"] },
      },
    });

    // Ensure session exists early — needed for llm_request_logs FK and title
    await pool.query(
      `INSERT INTO chat_sessions (id, user_id, title, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [sessionId, userId, text.slice(0, 100)]
    ).catch(() => {});

    // Load routing config (60s cached)
    const cfgSpan = await trace.startSpan("ai-service", "db_routing_config", { parentSpanId: rootSpan.spanId });
    const routingConfig = await getRoutingConfig(pool);
    await cfgSpan.end("ok", { metadata: { source: "llm_routing_config" } });

    // Resolve data mode — prefer explicit session value, else use configured default
    const sessSpan = await trace.startSpan("ai-service", "db_session_lookup", { parentSpanId: rootSpan.spanId, requestPayload: { sessionId } });
    const sessionRow = await pool.query(
      `SELECT data_mode FROM chat_sessions WHERE id = $1`,
      [sessionId]
    ).catch(() => ({ rows: [] }));
    await sessSpan.end("ok", { metadata: { found: sessionRow.rows.length > 0, sessionId } });
    const dataMode: "cached" | "live" =
      (sessionRow.rows[0] as { data_mode?: string } | undefined)?.data_mode === "live"
        ? "live"
        : routingConfig.default_data_mode === "live" ? "live" : "cached";

    const histSpan = await trace.startSpan("ai-service", "db_load_history", { parentSpanId: rootSpan.spanId, requestPayload: { sessionId } });
    const history = await loadHistory(sessionId, pool).catch(() => [] as OpenAI.ChatCompletionMessageParam[]);
    await histSpan.end("ok", { metadata: { messageCount: history.length, sessionId } });
    const filteredTools = toolRegistry.filter((t) => allowedTools.includes(t.name));
    const systemPrompt = buildSystemPrompt([]);

    // Conversation messages (no system — system is passed separately to each LLM call)
    const conversationMessages: OpenAI.ChatCompletionMessageParam[] = [
      ...history,
      { role: "user", content: text },
    ];

    // OpenAI-format tool definitions
    const openaiTools: OpenAI.ChatCompletionTool[] = filteredTools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as OpenAI.FunctionParameters,
      },
    }));

    // Determine orchestrator model
    const riskSpan = await trace.startSpan("ai-service", "db_high_risk_check", { parentSpanId: rootSpan.spanId, requestPayload: { toolCount: filteredTools.length } });
    const highRiskInScope = await checkHighRiskInScope(filteredTools.map(t => t.name), pool);
    await riskSpan.end("ok", { metadata: { highRiskInScope, toolCount: filteredTools.length } });
    const orchestratorModel = selectOrchestratorModel(routingConfig, highRiskInScope);

    const toolsUsed: string[] = [];
    // SEC-Routing-001: scope-based high-risk routing for both stages (consistent with chat.ts)
    let totalToolResultLength = 0;
    let fullStage1Content = "";

    // Log the full payload before sending to LLM — capture ID for model update later
    const logSpan = await trace.startSpan("ai-service", "db_llm_request_log", { parentSpanId: rootSpan.spanId });
    let logRowId: string | undefined;
    await pool.query(
      `INSERT INTO llm_request_logs (session_id, user_id, system_prompt, messages, tool_names, tools_payload, orchestrator_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [sessionId, userId, systemPrompt, JSON.stringify(conversationMessages), openaiTools.map((t) => t.function.name), JSON.stringify(openaiTools), orchestratorModel]
    ).then((r: { rows: { id: string }[] }) => { logRowId = r.rows[0]?.id; }).catch((err) => { log("error", "llm_log_insert_failed", { sessionId, error: String(err) }); });
    await logSpan.end("ok", { metadata: { table: "llm_request_logs", logRowId } });

    log("info", "stage1_start", { orchestratorModel, requestId });

    // SEC-015: Context overflow threshold. Large tool results (full device audits,
    // software lists for 300 devices) can overflow the model's context window.
    // Break the loop and proceed to Stage 2 with accumulated data rather than
    // crashing with a context-limit API error.
    const CONTEXT_OVERFLOW_CHARS = 100_000; // ~25k tokens, safe limit for Haiku 32k ctx

    // ── STAGE 1: Orchestrator — tool selection loop ───────────────────────────
    let stage1Iteration = 0;
    while (true) {
      stage1Iteration++;
      const llmSpan = await trace.startSpan("ai-service", `llm_stage1_iter_${stage1Iteration}`, {
        parentSpanId: rootSpan.spanId,
        requestPayload: { model: orchestratorModel, messageCount: conversationMessages.length },
      });

      const litellmSpan = await trace.startSpan("litellm", "chat_completion", {
        parentSpanId: llmSpan.spanId,
        requestPayload: { model: orchestratorModel, stream: false, endpoint: "/v1/chat/completions", stage: "orchestrator" },
      });
      const completion = await llmClient.chat.completions.create({
        model: orchestratorModel,
        messages: [{ role: "system", content: systemPrompt }, ...conversationMessages],
        max_tokens: 4096,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
      });
      await litellmSpan.end("ok", { metadata: { model: orchestratorModel, finishReason: completion.choices[0]?.finish_reason }, responsePayload: { toolCallCount: completion.choices[0]?.message.tool_calls?.length ?? 0 } });

      const choice = completion.choices[0];
      const assistantMsg = choice.message;
      fullStage1Content += assistantMsg.content ?? "";

      if (choice.finish_reason !== "tool_calls" || !assistantMsg.tool_calls?.length) {
        await llmSpan.end("ok", {
          metadata: { model: orchestratorModel, finishReason: choice.finish_reason, toolCallCount: 0 },
          responsePayload: { textLength: (assistantMsg.content ?? "").length },
        });
        break;
      }

      await llmSpan.end("ok", {
        metadata: { model: orchestratorModel, finishReason: choice.finish_reason, toolCallCount: assistantMsg.tool_calls.length },
        responsePayload: { toolCalls: assistantMsg.tool_calls.map(tc => ({ name: tc.function.name, args: tc.function.arguments.slice(0, 200) })) },
      });

      conversationMessages.push({
        role: "assistant",
        content: assistantMsg.content,
        tool_calls: assistantMsg.tool_calls,
      });

      for (const tc of assistantMsg.tool_calls) {
        const toolName = tc.function.name;

        // SEC-Cache-001: Hard permission gate — reject tool names not in allowedTools
        const permitted = await checkAndAuditToolPermission(
          toolName, allowedTools, userId, requestId, pool,
          dataMode === "cached" && !isLiveOnlyTool(toolName) ? "cached" : "live_preflight"
        );
        if (!permitted) {
          const denySpan = await trace.startSpan("ai-service", "tool_denied", {
            parentSpanId: rootSpan.spanId,
            requestPayload: { toolName, sec: "SEC-Cache-001" },
          });
          await denySpan.end("error", {
            metadata: { toolName, reason: "not_in_allowed_tools" },
            errorMessage: `Tool '${toolName}' denied by SEC-Cache-001`,
          });
          conversationMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolDeniedMessage(toolName),
          });
          continue;
        }

        toolsUsed.push(toolName);

        let toolInput: Record<string, unknown>;
        try { toolInput = JSON.parse(tc.function.arguments) as Record<string, unknown>; }
        catch { toolInput = {}; }

        const toolSpan = await trace.startSpan("ai-service", "tool_call", {
          parentSpanId: rootSpan.spanId,
          requestPayload: { toolName, toolInput, dataMode, cached: dataMode === "cached" && !isLiveOnlyTool(toolName) },
        });

        let resultText: string;
        if (dataMode === "cached" && !isLiveOnlyTool(toolName)) {
          try {
            const cacheSpan = await trace.startSpan("ai-service", "db_cached_query", { parentSpanId: toolSpan.spanId, requestPayload: { toolName, toolInput } });
            resultText = await executeCachedTool(toolName, toolInput, pool, allowedTools);
            await cacheSpan.end("ok", { metadata: { toolName, source: "datto_cache" }, responsePayload: { resultLength: resultText.length } });
          } catch {
            const liveResult = await callTool(toolName, toolInput, allowedTools, requestId, userId, jwtToken, trace.traceId, toolSpan.spanId);
            resultText = typeof liveResult.result === "string" ? liveResult.result : JSON.stringify(liveResult.result);
          }
        } else {
          const liveResult = await callTool(toolName, toolInput, allowedTools, requestId, userId, jwtToken, trace.traceId, toolSpan.spanId);
          resultText = typeof liveResult.result === "string" ? liveResult.result : JSON.stringify(liveResult.result);
        }

        totalToolResultLength += resultText.length;

        await toolSpan.end("ok", {
          metadata: { toolName },
          responsePayload: { resultLength: resultText.length, resultPreview: resultText.slice(0, 500) },
        });

        conversationMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultText,
        });
      }

      // SEC-015: Check accumulated context size — break before hitting model limit
      const ctxLen = conversationMessages.reduce(
        (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0
      );
      if (ctxLen > CONTEXT_OVERFLOW_CHARS) {
        log("warn", "context_overflow_truncation", { ctxLen, requestId });
        break;
      }
    }

    // ── STAGE 2: Synthesizer — response writing (only when tools were called) ─
    let fullAnswer: string;
    let synthModel: string | undefined;

    if (toolsUsed.length > 0) {
      synthModel = selectSynthesizerModel(routingConfig, {
        highRiskToolCalled: highRiskInScope,
        dataMode,
        totalToolResultLength,
      });

      const synthSpan = await trace.startSpan("ai-service", "llm_stage2_synthesizer", {
        parentSpanId: rootSpan.spanId,
        requestPayload: { model: synthModel, messageCount: conversationMessages.length, totalToolResultLength },
      });

      const synthLitellmSpan = await trace.startSpan("litellm", "chat_completion", {
        parentSpanId: synthSpan.spanId,
        requestPayload: { model: synthModel, stream: false, endpoint: "/v1/chat/completions", stage: "synthesizer" },
      });
      fullAnswer = await synthesize({
        model: synthModel,
        systemPrompt: buildSynthesizerPrompt([]),
        messages: compressForSynthesizer(conversationMessages),
        maxTokens: 4096,
      });
      await synthLitellmSpan.end("ok", { metadata: { model: synthModel }, responsePayload: { answerLength: fullAnswer.length } });

      await synthSpan.end("ok", {
        metadata: { model: synthModel, highRiskInScope, dataMode },
        responsePayload: { answerLength: fullAnswer.length },
      });
    } else {
      // No tools called — Stage 1 answer is the final response
      fullAnswer = fullStage1Content;
    }

    // Update log with synthesizer model and tools actually called
    if (logRowId) {
      pool.query(
        `UPDATE llm_request_logs SET synthesizer_model = $1, tools_called = $2 WHERE id = $3`,
        [toolsUsed.length > 0 ? synthModel : null, toolsUsed, logRowId]
      ).catch(() => {});
    }

    // Save to history (best effort)
    await saveMessages(
      sessionId, userId, text, fullAnswer, toolsUsed, pool, allowedTools
    ).catch((err) => { log("error", "save_messages_failed", { sessionId, error: String(err) }); return { userMsgId: "", assistantMsgId: "" }; });

    // Audit log (best effort)
    for (const toolName of toolsUsed) {
      pool.query(
        "INSERT INTO audit_logs (user_id, event_type, tool_name) VALUES ($1, $2, $3)",
        [userId, "tool_call", toolName]
      ).catch(() => {});
    }

    await rootSpan.end("ok", {
      metadata: { toolsUsed, orchestratorModel, synthModel: synthModel ?? null, dataMode },
      responsePayload: { answerLength: fullAnswer.length },
    });
    await trace.complete("completed", { toolCount: toolsUsed.length });

    res.json({ conversation_id: sessionId, answer: fullAnswer });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    log("error", "legacy_chat_error", { error: raw, requestId });
    await trace.complete("error", { errorMessage: raw });

    let userMessage = "Chat request failed";
    if (raw.includes("credit balance is too low")) {
      userMessage = "API credits exhausted — please contact your administrator.";
    } else if (raw.includes("invalid_api_key") || raw.includes("Could not resolve authentication")) {
      userMessage = "API key is invalid — please contact your administrator.";
    } else if (raw.includes("overloaded")) {
      userMessage = "API is currently overloaded — please try again in a moment.";
    }

    res.status(500).json({ error: userMessage });
  }
}

// POST /api/chat/mode — set data_mode for a session
export async function handleSetDataMode(req: Request, res: Response): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }
  const { session_id, mode } = req.body as { session_id?: string; mode?: string };
  if (!session_id || (mode !== "cached" && mode !== "live")) {
    res.status(400).json({ error: "session_id and mode ('cached'|'live') required" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO chat_sessions (id, user_id, data_mode, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET data_mode = EXCLUDED.data_mode, updated_at = NOW()`,
      [session_id, userId, mode]
    );
    res.json({ session_id, mode });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

// GET /api/history
export async function handleHistory(req: Request, res: Response): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) { res.status(401).json({ error: "missing x-user-id" }); return; }

  const limit = Number(req.query["limit"] ?? 20);
  const offset = Number(req.query["offset"] ?? 0);

  try {
    const result = await pool.query(
      `SELECT s.id,
              (SELECT content FROM chat_messages WHERE session_id = s.id AND role = 'user'   ORDER BY created_at ASC  LIMIT 1) AS question,
              (SELECT content FROM chat_messages WHERE session_id = s.id AND role = 'assistant' ORDER BY created_at DESC LIMIT 1) AS answer,
              'completed' AS status, 'claude-opus-4-6' AS model,
              s.created_at, s.updated_at AS completed_at
       FROM chat_sessions s
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    res.json({ items: result.rows, limit, offset });
  } catch {
    res.json({ items: [], limit, offset });
  }
}

// GET /api/tools
export async function handleTools(req: Request, res: Response): Promise<void> {
  const allowedToolsHeader = req.headers["x-allowed-tools"] as string | undefined;
  let allowedTools: string[] = [];
  if (allowedToolsHeader) {
    try { allowedTools = JSON.parse(allowedToolsHeader) as string[]; } catch { /* ignore */ }
  }

  const tools = toolRegistry
    .filter((t) => allowedTools.includes(t.name))
    .map((t) => ({
      tool_name: t.name,
      description: t.description,
      risk_level: "low",
      approval_required: false,
    }));

  res.json(tools);
}
