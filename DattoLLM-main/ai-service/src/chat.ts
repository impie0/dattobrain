import type { Request, Response } from "express";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { toolRegistry } from "./toolRegistry.js";
import { loadHistory, saveMessages, saveEmbeddings } from "./history.js";
import { searchSimilar } from "./vectorSearch.js";
import { callTool } from "./mcpBridge.js";
import { buildSystemPrompt, buildSynthesizerPrompt } from "./prompt.js";
import { writeDelta, writeToolCall, writeError, writeDone } from "./sse.js";
import { executeCachedTool, isLiveOnlyTool, isLocalOnlyTool } from "./cachedQueries.js";
import { checkAndAuditToolPermission, toolDeniedMessage } from "./permissions.js";
import { tryPreQuery } from "./preQuery.js";
import {
  getRoutingConfig,
  selectOrchestratorModel,
  selectSynthesizerModel,
  checkHighRiskInScope,
} from "./llmConfig.js";
import { llmClient, synthesizeStream } from "./modelRouter.js";
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

async function embed(text: string): Promise<{ vector: number[] }> {
  const res = await fetch(process.env["EMBEDDING_SERVICE_URL"]! + "/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Embedding service returned ${res.status}`);
  return res.json() as Promise<{ vector: number[] }>;
}

export async function handleChat(req: Request, res: Response): Promise<void> {
  const userId = req.headers["x-user-id"] as string | undefined;
  const allowedToolsStr = req.headers["x-allowed-tools"] as string | undefined;
  const sessionId = (req.headers["x-session-id"] as string | undefined) ?? randomUUID();
  const { message, data_mode: requestDataMode } = req.body as { message?: string; data_mode?: string };
  // SEC-MCP-001: Extract JWT so the MCP bridge can independently verify permissions
  const authHeader = req.headers["authorization"] as string | undefined;
  const jwtToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!userId || !allowedToolsStr || !message) {
    res.status(400).json({ error: "missing_fields", message: "x-user-id, x-allowed-tools headers and message body required" });
    return;
  }

  let allowedTools: string[];
  try {
    allowedTools = JSON.parse(allowedToolsStr) as string[];
  } catch {
    res.status(400).json({ error: "invalid_allowed_tools", message: "x-allowed-tools must be a JSON array" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const requestId = randomUUID();

  // ── Tracing: create context ───────────────────────────────────────────────
  const trace = new TraceContext(pool, requestId);
  await trace.init({ userId, sessionId, question: message });

  // ── Stage 4: Pre-Query — skip LLM for simple questions ──────────────────
  const preQueryResult = await tryPreQuery(message, allowedTools, userId, pool);
  if (preQueryResult) {
    const pqSpan = await trace.startSpan("ai-service", "prequery_hit", {
      requestPayload: { question: message.slice(0, 200), pattern: preQueryResult.toolUsed },
    });
    await pqSpan.end("ok", {
      metadata: { tool: preQueryResult.toolUsed, source: "materialized_view", llmTokens: 0 },
      responsePayload: { answerLength: preQueryResult.answer.length, answerPreview: preQueryResult.answer.slice(0, 300) },
    });
    await trace.complete("completed", { toolCount: 1 });
    writeDelta(res, preQueryResult.answer, sessionId);
    await saveMessages(sessionId, userId, message, preQueryResult.answer, [preQueryResult.toolUsed], pool, allowedTools)
      .catch(() => {});
    writeDone(res);
    return;
  }

  try {
    const rootSpan = await trace.startSpan("ai-service", "incoming_request", {
      requestPayload: {
        message: message.slice(0, 500),
        sessionId,
        allowedTools: allowedTools,
        headers: { "x-user-id": userId, "x-user-role": req.headers["x-user-role"] },
      },
    });

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
    // Data mode priority: request body > session DB > global default
    const sessionDataMode = (sessionRow.rows[0] as { data_mode?: string } | undefined)?.data_mode;
    const dataMode: "cached" | "live" =
      (requestDataMode === "live" || requestDataMode === "cached") ? requestDataMode
        : sessionDataMode === "live" ? "live"
        : sessionDataMode === "cached" ? "cached"
        : routingConfig.default_data_mode === "live" ? "live" : "cached";
    // Persist the mode to the session so it sticks for future messages
    if (requestDataMode === "live" || requestDataMode === "cached") {
      pool.query(
        `INSERT INTO chat_sessions (id, user_id, data_mode, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET data_mode = EXCLUDED.data_mode, updated_at = NOW()`,
        [sessionId, userId, requestDataMode]
      ).catch(() => {});
    }

    // Load history + embed + search similar in parallel
    const promptSpan = await trace.startSpan("ai-service", "prompt_build", { parentSpanId: rootSpan.spanId });

    const [history, similarMessages] = await Promise.all([
      (async () => {
        const s = await trace.startSpan("ai-service", "db_load_history", { parentSpanId: promptSpan.spanId, requestPayload: { sessionId } });
        try {
          const h = await loadHistory(sessionId, userId, pool);
          await s.end("ok", { metadata: { messageCount: h.length, sessionId } });
          return h;
        } catch (e) {
          await s.end("error", { errorMessage: e instanceof Error ? e.message : String(e) });
          return [] as OpenAI.ChatCompletionMessageParam[];
        }
      })(),
      (async () => {
        const embedSpan = await trace.startSpan("embedding-service", "embed_text", {
          parentSpanId: promptSpan.spanId,
          requestPayload: { textLength: message.length, endpoint: "/embed" },
        });
        try {
          const { vector } = await embed(message);
          await embedSpan.end("ok", { metadata: { dimensions: vector.length }, responsePayload: { vectorLength: vector.length } });

          const searchSpan = await trace.startSpan("ai-service", "db_vector_search", {
            parentSpanId: promptSpan.spanId,
            requestPayload: { vectorDimensions: vector.length, userId, sessionId, threshold: 0.78 },
          });
          const results = await searchSimilar(vector, userId, sessionId, pool);
          await searchSpan.end("ok", { metadata: { resultCount: results.length } });
          return results;
        } catch (e) {
          await embedSpan.end("error", { errorMessage: e instanceof Error ? e.message : String(e) });
          return [];
        }
      })(),
    ]);

    // Filter tools to only allowed
    const filteredTools = toolRegistry.filter((t) => allowedTools.includes(t.name));

    // Build system prompt
    const systemPrompt = buildSystemPrompt(similarMessages);

    await promptSpan.end("ok", {
      metadata: {
        historyLength: history.length,
        similarMessagesCount: similarMessages.length,
        filteredToolCount: filteredTools.length,
        toolNames: filteredTools.map(t => t.name),
        dataMode,
      },
    });

    // Conversation messages (system is passed separately to each LLM call)
    const conversationMessages: OpenAI.ChatCompletionMessageParam[] = [
      ...history,
      { role: "user", content: message },
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
    // SEC-Routing-001: highRiskInScope is used for BOTH orchestrator and synthesizer model
    // selection so the routing is consistent. Previously synthesizer used per-call
    // checkToolHighRisk (execution-based) while orchestrator was scope-based — now both
    // are scope-based: if any high-risk tool is in the user's allowed set, the platform
    // uses high-risk models throughout the entire request.
    let totalToolResultLength = 0;
    let fullStage1Content = "";

    // SEC-015: Context overflow threshold. Break the loop and proceed to Stage 2
    // with accumulated data rather than crashing with a context-limit API error.
    const CONTEXT_OVERFLOW_CHARS = 100_000;

    // ── STAGE 1: Orchestrator — tool selection loop ───────────────────────────
    const MAX_TOOL_ITERATIONS = 12; // Safety cap — prevents runaway tool loops
    let stage1Iteration = 0;
    while (true) {
      stage1Iteration++;
      if (stage1Iteration > MAX_TOOL_ITERATIONS) {
        log("warn", "max_tool_iterations_reached", { requestId, iterations: stage1Iteration });
        break;
      }
      const llmSpan = await trace.startSpan("ai-service", `llm_stage1_iter_${stage1Iteration}`, {
        parentSpanId: rootSpan.spanId,
        requestPayload: { model: orchestratorModel, messageCount: conversationMessages.length },
      });

      const litellmSpan = await trace.startSpan("litellm", "chat_completion", {
        parentSpanId: llmSpan.spanId,
        requestPayload: { model: orchestratorModel, stream: true, endpoint: "/v1/chat/completions", stage: "orchestrator" },
      });

      const stream = await llmClient.chat.completions.create({
        model: orchestratorModel,
        messages: [{ role: "system", content: systemPrompt }, ...conversationMessages],
        max_tokens: 4096,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        stream: true,
      });

      let textChunk = "";
      let finishReason = "";
      const toolCallsMap = new Map<number, { id: string; name: string; argsJson: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) finishReason = fr;

        if (delta?.content) textChunk += delta.content;

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCallsMap.has(tc.index)) {
              toolCallsMap.set(tc.index, { id: "", name: "", argsJson: "" });
            }
            const entry = toolCallsMap.get(tc.index)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.argsJson += tc.function.arguments;
          }
        }
      }

      await litellmSpan.end("ok", {
        metadata: { model: orchestratorModel, provider: orchestratorModel.startsWith("local/") ? "ollama" : "cloud", finishReason },
        responsePayload: { textLength: textChunk.length, toolCallCount: toolCallsMap.size },
      });

      fullStage1Content += textChunk;

      if (finishReason !== "tool_calls" || toolCallsMap.size === 0) {
        await llmSpan.end("ok", {
          metadata: { model: orchestratorModel, finishReason, toolCallCount: 0 },
          responsePayload: { textLength: textChunk.length },
        });
        break;
      }

      const toolCalls = Array.from(toolCallsMap.values()).filter(tc => tc.name);

      await llmSpan.end("ok", {
        metadata: { model: orchestratorModel, finishReason, toolCallCount: toolCalls.length },
        responsePayload: { toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.argsJson.slice(0, 200) })) },
      });

      conversationMessages.push({
        role: "assistant",
        content: textChunk || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.argsJson },
        })),
      });

      for (const tc of toolCalls) {
        const toolName = tc.name;

        // SEC-Cache-001: Hard permission gate — reject tool names not in allowedTools
        const permitted = await checkAndAuditToolPermission(
          toolName, allowedTools, userId, requestId, pool,
          (dataMode === "cached" || isLocalOnlyTool(toolName)) && !isLiveOnlyTool(toolName) ? "cached" : "live_preflight"
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
          writeToolCall(res, toolName, "denied");
          conversationMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolDeniedMessage(toolName),
          });
          continue;
        }

        toolsUsed.push(toolName);
        writeToolCall(res, toolName, "calling");

        let toolInput: Record<string, unknown>;
        try { toolInput = JSON.parse(tc.argsJson) as Record<string, unknown>; }
        catch {
          // SEC: Don't default to empty args — empty args on list tools causes full data dump
          conversationMessages.push({ role: "tool" as const, tool_call_id: tc.id, content: `Error: Invalid tool arguments for ${toolName}.` });
          writeToolCall(res, toolName, "denied");
          continue;
        }

        const isLocal  = isLocalOnlyTool(toolName);
        const isCached = isLocal || (dataMode === "cached" && !isLiveOnlyTool(toolName));
        const spanLabel = isLocal ? "LOCAL→VECTOR" : (isCached ? "CACHED" : "LIVE→MCP");
        const spanSource = isLocal ? "pgvector+ollama" : (isCached ? "postgres_cache" : "mcp_bridge→mcp_server→datto_api");
        const toolSpan = await trace.startSpan("ai-service", `tool_call [${toolName}] ${spanLabel}`, {
          parentSpanId: rootSpan.spanId,
          requestPayload: { toolName, toolInput, dataMode, source: spanSource },
        });

        let resultText: string;
        if (isCached) {
          try {
            const cacheSpan = await trace.startSpan("ai-service", isLocal ? "vector_search" : "db_cached_query", { parentSpanId: toolSpan.spanId, requestPayload: { toolName, toolInput } });
            resultText = await executeCachedTool(toolName, toolInput, pool, allowedTools);
            await cacheSpan.end("ok", { metadata: { toolName, source: isLocal ? "pgvector" : "datto_cache" }, responsePayload: { resultLength: resultText.length, resultPreview: resultText.slice(0, 300) } });
          } catch {
            if (isLocal) {
              resultText = JSON.stringify({ error: `Semantic search unavailable. Ensure Ollama is running and embeddings have been generated (trigger a data sync).` });
            } else {
              const liveResult = await callTool(toolName, toolInput, allowedTools, requestId, userId, jwtToken, trace.traceId, toolSpan.spanId);
              resultText = typeof liveResult.result === "string" ? liveResult.result : JSON.stringify(liveResult.result);
            }
          }
        } else {
          const liveResult = await callTool(toolName, toolInput, allowedTools, requestId, userId, jwtToken, trace.traceId, toolSpan.spanId);
          resultText = typeof liveResult.result === "string" ? liveResult.result : JSON.stringify(liveResult.result);
        }

        // Stage 2a: Hard cap on individual tool result size
        const MAX_TOOL_RESULT_CHARS = 8_000;
        if (resultText.length > MAX_TOOL_RESULT_CHARS) {
          log("warn", "tool_result_truncated", { toolName, original: resultText.length, truncated: MAX_TOOL_RESULT_CHARS, requestId });
          resultText = resultText.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n[Result truncated from ${resultText.length} to ${MAX_TOOL_RESULT_CHARS} chars. Use more specific filters to narrow results.]`;
        }

        totalToolResultLength += resultText.length;
        writeToolCall(res, toolName, "done");

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

    // ── STAGE 2: Synthesizer — response writing ───────────────────────────────
    let fullAssistantContent = "";
    let synthModel: string | undefined;

    if (toolsUsed.length > 0) {
      synthModel = selectSynthesizerModel(routingConfig, {
        highRiskToolCalled: highRiskInScope,
        dataMode,
        totalToolResultLength,
      });

      const synthSpan = await trace.startSpan("ai-service", `llm_stage2_synthesizer [${synthModel}]`, {
        parentSpanId: rootSpan.spanId,
        requestPayload: {
          model: synthModel,
          provider: synthModel.startsWith("local/") ? "ollama" : "cloud",
          messageCount: conversationMessages.length,
          totalToolResultLength,
          dataMode,
          toolsUsed,
        },
      });

      const synthLitellmSpan = await trace.startSpan("litellm", "chat_completion", {
        parentSpanId: synthSpan.spanId,
        requestPayload: { model: synthModel, provider: synthModel.startsWith("local/") ? "ollama" : "cloud", stream: true, endpoint: "/v1/chat/completions", stage: "synthesizer" },
      });
      for await (const delta of synthesizeStream({
        model: synthModel,
        systemPrompt: buildSynthesizerPrompt(similarMessages),
        messages: compressForSynthesizer(conversationMessages),
        maxTokens: 4096,
      })) {
        writeDelta(res, delta, sessionId);
        fullAssistantContent += delta;
      }
      await synthLitellmSpan.end("ok", {
        metadata: { model: synthModel, provider: synthModel.startsWith("local/") ? "ollama" : "cloud" },
        responsePayload: { answerLength: fullAssistantContent.length, answerPreview: fullAssistantContent.slice(0, 300) },
      });

      await synthSpan.end("ok", {
        metadata: { model: synthModel, provider: synthModel.startsWith("local/") ? "ollama" : "cloud", highRiskInScope, dataMode },
        responsePayload: { answerLength: fullAssistantContent.length, answerPreview: fullAssistantContent.slice(0, 300) },
      });
    } else {
      // No tools called — Stage 1 answer is the final response
      writeDelta(res, fullStage1Content, sessionId);
      fullAssistantContent = fullStage1Content;
    }

    // Save messages + embeddings in background
    setImmediate(async () => {
      try {
        const { userMsgId, assistantMsgId } = await saveMessages(
          sessionId,
          userId,
          message,
          fullAssistantContent,
          toolsUsed,
          pool
        );

        const [userEmbed, assistantEmbed] = await Promise.all([
          embed(message).catch(() => null),
          embed(fullAssistantContent).catch(() => null),
        ]);

        if (userEmbed && assistantEmbed) {
          await saveEmbeddings(userMsgId, userEmbed.vector, assistantMsgId, assistantEmbed.vector, pool);
        }

        for (const toolName of toolsUsed) {
          await pool.query(
            "INSERT INTO audit_logs (user_id, event_type, tool_name) VALUES ($1, $2, $3)",
            [userId, "tool_call", toolName]
          ).catch(() => {});
        }
      } catch (err) {
        log("error", "post_chat_save_error", { error: err instanceof Error ? err.message : String(err) });
      }
    });

    await rootSpan.end("ok", {
      metadata: {
        toolsUsed,
        orchestratorModel,
        orchestratorProvider: orchestratorModel.startsWith("local/") ? "ollama" : "cloud",
        synthModel: synthModel ?? null,
        synthProvider: synthModel?.startsWith("local/") ? "ollama" : "cloud",
        dataMode,
        stage1Iterations: stage1Iteration,
        totalToolResultLength,
      },
      responsePayload: { answerLength: fullAssistantContent.length, answerPreview: fullAssistantContent.slice(0, 300) },
    });
    await trace.complete("completed", { toolCount: toolsUsed.length });

    writeDone(res);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log("error", "chat_handler_error", {
      requestId,
      error: errMsg,
    });
    await trace.complete("error", { errorMessage: errMsg });
    if (!res.writableEnded) {
      writeError(res, "An error occurred processing your request", "internal_error");
      writeDone(res);
    }
  }
}
