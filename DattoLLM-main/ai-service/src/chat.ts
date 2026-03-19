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
import { executeCachedTool, isLiveOnlyTool } from "./cachedQueries.js";
import {
  getRoutingConfig,
  selectOrchestratorModel,
  selectSynthesizerModel,
  checkHighRiskInScope,
} from "./llmConfig.js";
import { llmClient, synthesizeStream } from "./modelRouter.js";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
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
  const { message } = req.body as { message?: string };
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

    // Load history + embed + search similar in parallel
    const [history, similarMessages] = await Promise.all([
      loadHistory(sessionId, pool),
      embed(message)
        .then(({ vector }) => searchSimilar(vector, userId, sessionId, pool))
        .catch(() => []),
    ]);

    // Filter tools to only allowed
    const filteredTools = toolRegistry.filter((t) => allowedTools.includes(t.name));

    // Build system prompt
    const systemPrompt = buildSystemPrompt(similarMessages);

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
    const highRiskInScope = await checkHighRiskInScope(filteredTools.map(t => t.name), pool);
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
    while (true) {
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

      fullStage1Content += textChunk;

      if (finishReason !== "tool_calls" || toolCallsMap.size === 0) break;

      const toolCalls = Array.from(toolCallsMap.values()).filter(tc => tc.name);

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
        toolsUsed.push(toolName);
        writeToolCall(res, toolName, "calling");

        let toolInput: Record<string, unknown>;
        try { toolInput = JSON.parse(tc.argsJson) as Record<string, unknown>; }
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
        writeToolCall(res, toolName, "done");

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

      for await (const delta of synthesizeStream({
        model: synthModel,
        systemPrompt: buildSynthesizerPrompt(similarMessages),
        messages: conversationMessages,
        maxTokens: 4096,
      })) {
        writeDelta(res, delta, sessionId);
        fullAssistantContent += delta;
      }
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

    writeDone(res);
  } catch (err) {
    log("error", "chat_handler_error", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.writableEnded) {
      writeError(res, "An error occurred processing your request", "internal_error");
      writeDone(res);
    }
  }
}
