import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { pool } from "./db.js";
import { toolRegistry } from "./toolRegistry.js";
import { loadHistory, saveMessages } from "./history.js";
import { callTool } from "./mcpBridge.js";
import { buildSystemPrompt, buildSynthesizerPrompt } from "./prompt.js";
import { executeCachedTool, isLiveOnlyTool } from "./cachedQueries.js";
import {
  getRoutingConfig,
  selectOrchestratorModel,
  selectSynthesizerModel,
  checkHighRiskInScope,
} from "./llmConfig.js";
import { llmClient, synthesize } from "./modelRouter.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
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

  try {
    // Load routing config (60s cached)
    const routingConfig = await getRoutingConfig(pool);

    // Resolve data mode — prefer explicit session value, else use configured default
    const sessionRow = await pool.query(
      `SELECT data_mode FROM chat_sessions WHERE id = $1`,
      [sessionId]
    ).catch(() => ({ rows: [] }));
    const dataMode: "cached" | "live" =
      (sessionRow.rows[0] as { data_mode?: string } | undefined)?.data_mode === "live"
        ? "live"
        : routingConfig.default_data_mode === "live" ? "live" : "cached";

    const history = await loadHistory(sessionId, pool).catch(() => []);
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
    const highRiskInScope = await checkHighRiskInScope(filteredTools.map(t => t.name), pool);
    const orchestratorModel = selectOrchestratorModel(routingConfig, highRiskInScope);

    const toolsUsed: string[] = [];
    // SEC-Routing-001: scope-based high-risk routing for both stages (consistent with chat.ts)
    let totalToolResultLength = 0;
    let fullStage1Content = "";

    // Log the full payload before sending to LLM — capture ID for model update later
    let logRowId: string | undefined;
    await pool.query(
      `INSERT INTO llm_request_logs (session_id, user_id, system_prompt, messages, tool_names, tools_payload, orchestrator_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [sessionId, userId, systemPrompt, JSON.stringify(conversationMessages), openaiTools.map((t) => t.function.name), JSON.stringify(openaiTools), orchestratorModel]
    ).then((r: { rows: { id: string }[] }) => { logRowId = r.rows[0]?.id; }).catch(() => {});

    log("info", "stage1_start", { orchestratorModel, requestId });

    // SEC-015: Context overflow threshold. Large tool results (full device audits,
    // software lists for 300 devices) can overflow the model's context window.
    // Break the loop and proceed to Stage 2 with accumulated data rather than
    // crashing with a context-limit API error.
    const CONTEXT_OVERFLOW_CHARS = 100_000; // ~25k tokens, safe limit for Haiku 32k ctx

    // ── STAGE 1: Orchestrator — tool selection loop ───────────────────────────
    while (true) {
      const completion = await llmClient.chat.completions.create({
        model: orchestratorModel,
        messages: [{ role: "system", content: systemPrompt }, ...conversationMessages],
        max_tokens: 4096,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
      });

      const choice = completion.choices[0];
      const assistantMsg = choice.message;
      fullStage1Content += assistantMsg.content ?? "";

      if (choice.finish_reason !== "tool_calls" || !assistantMsg.tool_calls?.length) break;

      conversationMessages.push({
        role: "assistant",
        content: assistantMsg.content,
        tool_calls: assistantMsg.tool_calls,
      });

      for (const tc of assistantMsg.tool_calls) {
        const toolName = tc.function.name;
        toolsUsed.push(toolName);

        let toolInput: Record<string, unknown>;
        try { toolInput = JSON.parse(tc.function.arguments) as Record<string, unknown>; }
        catch { toolInput = {}; }

        let resultText: string;
        if (dataMode === "cached" && !isLiveOnlyTool(toolName)) {
          try {
            resultText = await executeCachedTool(toolName, toolInput, pool);
          } catch {
            const liveResult = await callTool(toolName, toolInput, allowedTools, requestId, userId, jwtToken);
            resultText = typeof liveResult.result === "string" ? liveResult.result : JSON.stringify(liveResult.result);
          }
        } else {
          const liveResult = await callTool(toolName, toolInput, allowedTools, requestId, userId, jwtToken);
          resultText = typeof liveResult.result === "string" ? liveResult.result : JSON.stringify(liveResult.result);
        }

        totalToolResultLength += resultText.length;

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

      fullAnswer = await synthesize({
        model: synthModel,
        systemPrompt: buildSynthesizerPrompt([]),
        messages: conversationMessages,
        maxTokens: 4096,
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
    ).catch(() => ({ userMsgId: "", assistantMsgId: "" }));

    // Audit log (best effort)
    for (const toolName of toolsUsed) {
      pool.query(
        "INSERT INTO audit_logs (user_id, event_type, tool_name) VALUES ($1, $2, $3)",
        [userId, "tool_call", toolName]
      ).catch(() => {});
    }

    res.json({ conversation_id: sessionId, answer: fullAnswer });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    log("error", "legacy_chat_error", { error: raw, requestId });

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
