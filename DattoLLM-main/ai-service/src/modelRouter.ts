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

// ── Synthesis interfaces ─────────────────────────────────────────────────────

export interface SynthesisOptions {
  model: string;
  systemPrompt: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  maxTokens?: number;
}

// ── Non-streaming synthesis (legacyChat.ts Stage 2) ─────────────────────────

export async function synthesize(opts: SynthesisOptions): Promise<string> {
  const completion = await llmClient.chat.completions.create({
    model: opts.model,
    messages: [{ role: "system", content: opts.systemPrompt }, ...opts.messages],
    max_tokens: opts.maxTokens ?? 4096,
  });
  return completion.choices[0]?.message.content ?? "";
}

// ── Streaming synthesis (chat.ts Stage 2) — yields text deltas ───────────────

export async function* synthesizeStream(
  opts: SynthesisOptions
): AsyncGenerator<string> {
  const stream = await llmClient.chat.completions.create({
    model: opts.model,
    messages: [{ role: "system", content: opts.systemPrompt }, ...opts.messages],
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta.content;
    if (delta) yield delta;
  }
}
