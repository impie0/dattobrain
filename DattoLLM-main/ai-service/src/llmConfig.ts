/**
 * LLM routing configuration — DB accessor + routing decision logic.
 * Reads from `llm_routing_config` table with a 60-second in-process cache.
 * Falls back to safe defaults if the table doesn't exist yet.
 */

import type { Pool } from "pg";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RoutingConfig {
  orchestrator_default: string;
  orchestrator_high_risk: string;
  synthesizer_default: string;
  synthesizer_large_data: string;
  synthesizer_high_risk: string;
  synthesizer_cached: string;
  default_data_mode: string;
}

// ── Defaults (used when table is missing or query fails) ─────────────────────

const DEFAULTS: RoutingConfig = {
  orchestrator_default:   "claude-haiku-4-5-20251001",
  orchestrator_high_risk: "claude-opus-4-6",
  synthesizer_default:    "claude-haiku-4-5-20251001",
  synthesizer_large_data: "deepseek/deepseek-r1",
  synthesizer_high_risk:  "claude-opus-4-6",
  synthesizer_cached:     "claude-haiku-4-5-20251001",
  default_data_mode:      "cached",
};

// ── In-process cache ─────────────────────────────────────────────────────────

let _cached: RoutingConfig | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export async function getRoutingConfig(pool: Pool): Promise<RoutingConfig> {
  if (_cached && Date.now() - _cachedAt < CACHE_TTL_MS) return _cached;

  try {
    const result = await pool.query<{ key: string; model: string }>(
      "SELECT key, model FROM llm_routing_config"
    );
    const config = { ...DEFAULTS };
    for (const row of result.rows) {
      if (Object.prototype.hasOwnProperty.call(config, row.key)) {
        (config as Record<string, string>)[row.key] = row.model;
      }
    }
    _cached = config;
    _cachedAt = Date.now();
    return config;
  } catch {
    // Table may not exist during migration window — fall back to defaults
    return DEFAULTS;
  }
}

export function invalidateRoutingConfigCache(): void {
  _cached = null;
  _cachedAt = 0;
}

// ── Routing decision functions (pure — no DB calls) ──────────────────────────

export function selectOrchestratorModel(
  config: RoutingConfig,
  highRiskInScope: boolean
): string {
  return highRiskInScope
    ? config.orchestrator_high_risk
    : config.orchestrator_default;
}

/**
 * Synthesizer priority order (from local-llm.md):
 *   1. high-risk tool was called  → synthesizer_high_risk
 *   2. data_mode is cached        → synthesizer_cached
 *   3. total result length > 8000 → synthesizer_large_data
 *   4. default                    → synthesizer_default
 */
export function selectSynthesizerModel(
  config: RoutingConfig,
  opts: {
    highRiskToolCalled: boolean;
    dataMode: "cached" | "live";
    totalToolResultLength: number;
  }
): string {
  if (opts.highRiskToolCalled)           return config.synthesizer_high_risk;
  if (opts.dataMode === "cached")        return config.synthesizer_cached;
  if (opts.totalToolResultLength > 8000) return config.synthesizer_large_data;
  return config.synthesizer_default;
}

// ── DB helpers for high-risk detection ───────────────────────────────────────

/** Returns true if any tool in the list has risk_level = 'high' in tool_policies. */
export async function checkHighRiskInScope(
  toolNames: string[],
  pool: Pool
): Promise<boolean> {
  if (toolNames.length === 0) return false;
  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM tool_policies
       WHERE tool_name = ANY($1) AND risk_level = 'high'`,
      [toolNames]
    );
    return Number(result.rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Returns true if the given tool has risk_level = 'high' in tool_policies. */
export async function checkToolHighRisk(
  toolName: string,
  pool: Pool
): Promise<boolean> {
  try {
    const result = await pool.query<{ risk_level: string }>(
      "SELECT risk_level FROM tool_policies WHERE tool_name = $1",
      [toolName]
    );
    return result.rows[0]?.risk_level === "high";
  } catch {
    return false;
  }
}
