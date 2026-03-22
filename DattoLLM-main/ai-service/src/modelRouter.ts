/**
 * Model router — unified LLM client via LiteLLM /v1 (OpenAI-compatible).
 *
 * All models (Claude via OpenRouter, DeepSeek, Gemini) go through
 * LiteLLM's /v1/chat/completions endpoint using the OpenAI SDK.
 * LiteLLM translates to each provider's native format internally.
 *
 * Falls back to direct OpenRouter if LITELLM_URL is not set.
 */

import OpenAI from "openai";

// ── Client instantiation ─────────────────────────────────────────────────────

function makeClient(): OpenAI {
  const litellmUrl = process.env["LITELLM_URL"];
  if (litellmUrl) {
    return new OpenAI({
      apiKey: process.env["LITELLM_MASTER_KEY"] ?? "no-key",
      baseURL: `${litellmUrl}/v1`,
    });
  }
  // Graceful fallback: no LiteLLM — hit OpenRouter directly
  return new OpenAI({
    apiKey: process.env["OPENROUTER_API_KEY"] ?? "no-key",
    baseURL: "https://openrouter.ai/api/v1",
  });
}

export const llmClient = makeClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

export function isLocalModel(model: string): boolean {
  return model.startsWith("local/");
}

// ── Synthesis interfaces ─────────────────────────────────────────────────────

export interface SynthesisOptions {
  model: string;
  systemPrompt: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  maxTokens?: number;
}

// ── Non-streaming synthesis (legacyChat.ts Stage 2) ─────────────────────────

export interface SynthesisResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function synthesize(opts: SynthesisOptions): Promise<SynthesisResult> {
  // Local Ollama models (Qwen3) default to "thinking mode" which puts output
  // in reasoning_content instead of content. Pass extra_body.think=false to
  // disable thinking and get direct content output.
  const extra = isLocalModel(opts.model) ? { think: false } : {};

  const completion = await llmClient.chat.completions.create({
    model: opts.model,
    messages: [{ role: "system", content: opts.systemPrompt }, ...opts.messages],
    max_tokens: opts.maxTokens ?? 4096,
    ...extra,
  } as OpenAI.ChatCompletionCreateParamsNonStreaming);
  return {
    content: completion.choices[0]?.message.content ?? "",
    usage: {
      prompt_tokens: completion.usage?.prompt_tokens ?? 0,
      completion_tokens: completion.usage?.completion_tokens ?? 0,
      total_tokens: completion.usage?.total_tokens ?? 0,
    },
  };
}

// ── Streaming synthesis (chat.ts Stage 2) — yields text deltas ───────────────

export async function* synthesizeStream(
  opts: SynthesisOptions
): AsyncGenerator<string> {
  const extra = isLocalModel(opts.model) ? { think: false } : {};

  const stream = await llmClient.chat.completions.create({
    model: opts.model,
    messages: [{ role: "system", content: opts.systemPrompt }, ...opts.messages],
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    ...extra,
  } as OpenAI.ChatCompletionCreateParamsStreaming);

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta.content;
    if (delta) yield delta;
  }
}
