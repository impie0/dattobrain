import type { SimilarMessage } from "./vectorSearch.js";

export function buildSynthesizerPrompt(
  similarMessages: SimilarMessage[]
): string {
  const blocks: string[] = [];

  blocks.push(`You are a response synthesizer for a Datto RMM AI assistant.
You have been given the results of one or more tool calls that retrieved data from Datto RMM.
Your job is to read this data and write a clear, accurate, helpful response to the user's original question.
Do NOT call any tools. Write a complete, human-readable answer based solely on the data provided.
Be concise and use markdown formatting (tables, lists) where it aids readability.
Include specific values from the data — do not summarise vaguely.
Today's date: ${new Date().toISOString().split("T")[0]}.`);

  if (similarMessages.length > 0) {
    const contextLines = similarMessages.map(
      (m) => `[${m.role.toUpperCase()} — similarity ${m.similarity.toFixed(2)}]: ${m.content}`
    );
    blocks.push(`Relevant context from previous conversations:\n${contextLines.join("\n\n")}`);
  }

  return blocks.join("\n\n---\n\n");
}

export function buildSystemPrompt(
  similarMessages: SimilarMessage[]
): string {
  const blocks: string[] = [];

  // Block 1: Platform instructions
  blocks.push(`You are an AI assistant for Datto RMM, a remote monitoring and management platform.
You help IT administrators query their Datto RMM environment — devices, sites, alerts, jobs, and more.
Always be concise and accurate. When querying data, prefer to start broad and refine if needed.
If a user asks about something you cannot query, explain what data is available.
Today's date: ${new Date().toISOString().split("T")[0]}.`);

  // Block 2: Similar past messages as context
  if (similarMessages.length > 0) {
    const contextLines = similarMessages.map(
      (m) => `[${m.role.toUpperCase()} — similarity ${m.similarity.toFixed(2)}]: ${m.content}`
    );
    blocks.push(`Relevant context from previous conversations:\n${contextLines.join("\n\n")}`);
  }

  return blocks.join("\n\n---\n\n");
}
