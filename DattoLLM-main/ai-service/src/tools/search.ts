import type { ToolDef } from "./shared.js";

/**
 * Stage 7: Semantic search tools backed by pgvector + nomic-embed-text.
 * Always handled locally — never forwarded to the MCP bridge.
 */
export const searchTools: ToolDef[] = [
  {
    name: "semantic-search",
    description: [
      "Semantic vector search across ALL Datto fleet data — devices, sites, open alerts, and software.",
      "Use this when you need to find entities by concept or description rather than exact field values.",
      "Examples: 'devices with disk space issues', 'sites with many alerts', 'antivirus disabled or expired',",
      "'find machines running outdated browsers', 'network connectivity problems', 'BitLocker not enabled'.",
      "Returns the top semantically-relevant matches even without exact keyword matches.",
      "After finding matches use other tools (get-device, get-site, get-alert) for full details.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language description of what you are looking for.",
        },
        entityTypes: {
          type: "array",
          items: { type: "string", enum: ["device", "site", "alert", "software"] },
          description: "Limit results to these entity types. Omit to search all types.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (1–20, default 10).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search-chat-history",
    description: [
      "Search past chat Q&A pairs semantically to find if a similar question was answered before.",
      "Use this FIRST before doing heavy tool research — if the same or similar question was already answered,",
      "you can use that answer directly instead of repeating the same tool calls.",
      "Also useful for building context: 'have we discussed X before?', 'what was the previous answer about Y?'.",
      "Returns matched question+answer pairs ranked by similarity.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The question or topic to search for in chat history.",
        },
        limit: {
          type: "number",
          description: "Maximum number of past Q&A pairs to return (1–10, default 5).",
        },
      },
      required: ["query"],
    },
  },
];
