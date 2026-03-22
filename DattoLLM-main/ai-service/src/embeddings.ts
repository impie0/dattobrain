/**
 * Stage 7: Semantic Embedding Pipeline
 *
 * Embeds all Datto fleet data (devices, sites, alerts, software) into pgvector
 * using nomic-embed-text running in Ollama (768 dimensions).
 *
 * Change detection: MD5 hash of content_text prevents re-embedding unchanged records.
 * Batch size: 20 texts per Ollama /api/embed call (good balance of throughput vs timeout).
 *
 * Usage:
 *   runEmbeddings(db)          — called after every full sync
 *   semanticSearch(db, query)  — called by the semantic-search tool
 */

import crypto from "node:crypto";
import type { Pool } from "pg";

const OLLAMA_URL  = process.env["OLLAMA_URL"] ?? "http://ollama:11434";
const EMBED_MODEL = "nomic-embed-text";
const BATCH_SIZE  = 20;

// ── Content-text builders ───────────────────────────────────────────────────
// These produce the plain-text that gets embedded. More context = better recall.

function deviceText(row: Record<string, unknown>): string {
  const parts: string[] = [`Device: ${row["hostname"] ?? "unknown"}`];
  if (row["site_name"])          parts.push(`Site: ${row["site_name"]}`);
  if (row["operating_system"])   parts.push(`OS: ${row["operating_system"]}${row["display_version"] ? " " + row["display_version"] : ""}`);
  parts.push(`Status: ${row["online"] ? "Online" : "Offline"}`);
  if (row["int_ip_address"])     parts.push(`IP: ${row["int_ip_address"]}`);
  if (row["domain"])             parts.push(`Domain: ${row["domain"]}`);
  if (row["last_logged_in_user"]) parts.push(`Last user: ${row["last_logged_in_user"]}`);
  if (row["av_product"])         parts.push(`Antivirus: ${row["av_product"]} — ${row["av_status"] ?? "unknown"}`);
  if (row["patch_status"])       parts.push(`Patch status: ${row["patch_status"]}`);
  if (row["cpu_description"])    parts.push(`CPU: ${row["cpu_description"]}${row["cpu_cores"] ? `, ${row["cpu_cores"]} cores` : ""}`);
  if (row["ram_total_mb"])       parts.push(`RAM: ${Math.round(Number(row["ram_total_mb"]) / 1024)}GB`);
  if (row["description"])        parts.push(`Description: ${row["description"]}`);
  return parts.join("\n");
}

function siteText(row: Record<string, unknown>): string {
  const parts: string[] = [`Site: ${row["name"]}`];
  if (row["description"])              parts.push(`Description: ${row["description"]}`);
  parts.push(`Devices: ${row["device_count"] ?? 0} total (${row["online_count"] ?? 0} online, ${row["offline_count"] ?? 0} offline)`);
  parts.push(`Open alerts: ${row["open_alerts"] ?? 0}`);
  if (row["autotask_company_name"])    parts.push(`Autotask company: ${row["autotask_company_name"]}`);
  return parts.join("\n");
}

function alertText(row: Record<string, unknown>): string {
  const parts: string[] = [`Alert: ${row["alert_message"] ?? "unknown"}`];
  if (row["priority"])        parts.push(`Priority: ${row["priority"]}`);
  if (row["device_name"])     parts.push(`Device: ${row["device_name"]}`);
  if (row["site_name"])       parts.push(`Site: ${row["site_name"]}`);
  if (row["alert_timestamp"]) parts.push(`Timestamp: ${new Date(row["alert_timestamp"] as string).toISOString()}`);
  return parts.join("\n");
}

function softwareText(row: Record<string, unknown>): string {
  const nameParts = [row["name"] as string];
  if (row["version"]) nameParts.push(row["version"] as string);
  const parts: string[] = [`Software: ${nameParts.join(" ")}`];
  if (row["publisher"])   parts.push(`Publisher: ${row["publisher"]}`);
  parts.push(`Installed on ${row["device_count"] ?? 0} devices in the fleet.`);
  return parts.join("\n");
}

// ── Low-level Ollama client ─────────────────────────────────────────────────

async function callOllamaEmbed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    signal: AbortSignal.timeout(300_000), // 5 min — can queue behind chat requests
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama embed ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  if (!data.embeddings?.length) throw new Error("Ollama returned no embeddings");
  if (data.embeddings.length !== texts.length) {
    throw new Error(`Embedding count mismatch: sent ${texts.length}, got ${data.embeddings.length}`);
  }
  return data.embeddings;
}

// ── Change detection ────────────────────────────────────────────────────────

function contentHash(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

interface EmbedRecord {
  entityType: string;
  entityId: string;
  contentText: string;
}

async function filterUnchanged(db: Pool, records: EmbedRecord[], entityType: string): Promise<EmbedRecord[]> {
  if (records.length === 0) return [];
  const existingQ = await db.query<{ entity_id: string; content_hash: string }>(
    `SELECT entity_id, content_hash FROM semantic_embeddings WHERE entity_type = $1`,
    [entityType]
  );
  const existing = new Map(existingQ.rows.map(r => [r.entity_id, r.content_hash]));
  return records.filter(r => existing.get(r.entityId) !== contentHash(r.contentText));
}

// ── Upsert helper ───────────────────────────────────────────────────────────

async function upsertBatch(db: Pool, records: EmbedRecord[], embeddings: number[][]): Promise<void> {
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const emb = embeddings[i]!;
    await db.query(
      `INSERT INTO semantic_embeddings (entity_type, entity_id, content_text, content_hash, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         content_text = EXCLUDED.content_text,
         content_hash = EXCLUDED.content_hash,
         embedding    = EXCLUDED.embedding,
         embedded_at  = NOW()`,
      [r.entityType, r.entityId, r.contentText, contentHash(r.contentText), JSON.stringify(emb)]
    );
  }
}

// ── Per-entity-type pipeline ────────────────────────────────────────────────

async function embedEntityBatch(db: Pool, entityType: string, records: EmbedRecord[]): Promise<number> {
  const toEmbed = await filterUnchanged(db, records, entityType);
  if (toEmbed.length === 0) return 0;

  let count = 0;
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const embeddings = await callOllamaEmbed(batch.map(r => r.contentText));
    await upsertBatch(db, batch, embeddings);
    count += batch.length;
  }
  return count;
}

// ── Public: full embedding pipeline ────────────────────────────────────────

export interface EmbeddingStats {
  devices:   number;
  sites:     number;
  alerts:    number;
  software:  number;
  chat_qa?:  number;
  errors:    string | null;
}

export async function runEmbeddings(db: Pool): Promise<EmbeddingStats> {
  const stats: EmbeddingStats = { devices: 0, sites: 0, alerts: 0, software: 0, errors: null };
  const errors: string[] = [];

  // ── Devices ─────────────────────────────────────────────────────────────
  try {
    const q = await db.query<Record<string, unknown>>(`
      SELECT d.uid, d.hostname, d.site_name, d.operating_system, d.display_version,
             d.online, d.int_ip_address, d.domain, d.last_logged_in_user,
             d.av_product, d.av_status, d.patch_status, d.description,
             a.cpu_description, a.cpu_cores, a.ram_total_mb
      FROM datto_cache_devices d
      LEFT JOIN datto_cache_device_audit a ON a.device_uid = d.uid
    `);
    const records: EmbedRecord[] = q.rows.map(row => ({
      entityType: "device",
      entityId:   row["uid"] as string,
      contentText: deviceText(row),
    }));
    stats.devices = await embedEntityBatch(db, "device", records);
  } catch (err) {
    errors.push(`devices: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Sites ────────────────────────────────────────────────────────────────
  try {
    const q = await db.query<Record<string, unknown>>(`
      SELECT s.uid, s.name, s.description, s.autotask_company_name,
             s.device_count, s.online_count, s.offline_count,
             (SELECT COUNT(*) FROM datto_cache_alerts a
              WHERE a.site_uid = s.uid AND a.resolved = false)::int AS open_alerts
      FROM datto_cache_sites s
    `);
    const records: EmbedRecord[] = q.rows.map(row => ({
      entityType: "site",
      entityId:   row["uid"] as string,
      contentText: siteText(row),
    }));
    stats.sites = await embedEntityBatch(db, "site", records);
  } catch (err) {
    errors.push(`sites: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Open alerts ──────────────────────────────────────────────────────────
  // Cap at 10,000 most recent — resolved alerts are stale and add noise
  try {
    const q = await db.query<Record<string, unknown>>(`
      SELECT alert_uid, alert_message, priority, device_name, site_name, alert_timestamp
      FROM datto_cache_alerts
      WHERE resolved = false
      ORDER BY alert_timestamp DESC
      LIMIT 10000
    `);
    const records: EmbedRecord[] = q.rows.map(row => ({
      entityType: "alert",
      entityId:   row["alert_uid"] as string,
      contentText: alertText(row),
    }));
    stats.alerts = await embedEntityBatch(db, "alert", records);
  } catch (err) {
    errors.push(`alerts: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Software — distinct by normalized name ────────────────────────────────
  // Group by lower(trim(name)) to deduplicate across versions/publishers.
  // Pick the most common version/publisher per name. Count unique devices.
  try {
    const q = await db.query<Record<string, unknown>>(`
      SELECT
        lower(trim(name)) AS entity_id,
        (array_agg(name       ORDER BY cnt DESC))[1] AS name,
        (array_agg(version    ORDER BY cnt DESC))[1] AS version,
        (array_agg(publisher  ORDER BY cnt DESC))[1] AS publisher,
        SUM(cnt)::int AS device_count
      FROM (
        SELECT name, version, publisher, COUNT(DISTINCT device_uid) AS cnt
        FROM datto_cache_device_software
        WHERE name IS NOT NULL AND trim(name) <> ''
        GROUP BY name, version, publisher
      ) sub
      GROUP BY lower(trim(name))
      ORDER BY device_count DESC
    `);
    const records: EmbedRecord[] = q.rows.map(row => ({
      entityType:  "software",
      entityId:    row["entity_id"] as string,
      contentText: softwareText(row),
    }));
    stats.software = await embedEntityBatch(db, "software", records);
  } catch (err) {
    errors.push(`software: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Chat Q&A pairs ───────────────────────────────────────────────────────
  // Embed recent question+answer pairs so the LLM can do RAG over past conversations.
  try {
    stats.chat_qa = await embedChatQA(db);
  } catch (err) {
    errors.push(`chat_qa: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (errors.length > 0) stats.errors = errors.join("; ");

  process.stdout.write(JSON.stringify({
    level: "info", msg: "embeddings_completed",
    devices: stats.devices, sites: stats.sites,
    alerts: stats.alerts, software: stats.software,
    chat_qa: stats.chat_qa ?? 0,
    errors: stats.errors ?? null, ts: Date.now(),
  }) + "\n");

  return stats;
}

// ── Chat Q&A embedding — call after each chat or during full pipeline ───────

/**
 * Embed question+answer pairs from chat_messages.
 * Entity_id = user message UUID (one embedding per question asked).
 * Content: "Question: ...\nAnswer: ..." (answer capped at 800 chars to avoid noise).
 *
 * @param db   - Database pool
 * @param sessionId - If provided, only embed Q&A from this session (for post-chat embed)
 */
export async function embedChatQA(db: Pool, sessionId?: string): Promise<number> {
  const whereExtra = sessionId ? "AND um.session_id = $2::uuid" : "";
  const params: unknown[] = sessionId ? [5000, sessionId] : [5000];

  const q = await db.query<Record<string, unknown>>(
    `SELECT
       um.id         AS entity_id,
       um.content    AS question,
       am.content    AS answer,
       um.created_at
     FROM chat_messages um
     JOIN LATERAL (
       SELECT content FROM chat_messages
       WHERE session_id = um.session_id
         AND role = 'assistant'
         AND created_at > um.created_at
       ORDER BY created_at ASC LIMIT 1
     ) am ON true
     WHERE um.role = 'user'
       AND length(am.content) > 20
       ${whereExtra}
     ORDER BY um.created_at DESC
     LIMIT $1`,
    params
  );

  if (q.rows.length === 0) return 0;

  const records: EmbedRecord[] = q.rows.map(row => ({
    entityType: "chat_qa",
    entityId:   row["entity_id"] as string,
    contentText: `Question: ${row["question"]}\nAnswer: ${(row["answer"] as string).slice(0, 800)}`,
  }));

  return embedEntityBatch(db, "chat_qa", records);
}

// ── Public: semantic search ─────────────────────────────────────────────────

export interface SemanticResult {
  type:       string;
  id:         string;
  similarity: number;
  [key: string]: unknown;
}

export async function semanticSearch(
  db: Pool,
  query: string,
  entityTypes?: string[],
  limit = 10
): Promise<{ query: string; results: SemanticResult[]; embeddedEntities: Record<string, number> }> {
  const k = Math.min(Math.max(1, limit), 20);
  const types = entityTypes?.length ? entityTypes : ["device", "site", "alert", "software"];

  // Get query embedding
  const [queryEmbedding] = await callOllamaEmbed([query]);
  if (!queryEmbedding) throw new Error("Failed to get query embedding from Ollama");

  // Vector similarity search — cosine distance (lower = more similar, hence ORDER BY ASC)
  const searchQ = await db.query<{
    entity_type: string;
    entity_id:   string;
    content_text: string;
    similarity:  number;
  }>(
    `SELECT entity_type, entity_id, content_text,
            1 - (embedding <=> $1::vector) AS similarity
     FROM semantic_embeddings
     WHERE entity_type = ANY($2::text[])
       AND 1 - (embedding <=> $1::vector) > 0.35
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(queryEmbedding), types, k]
  );

  // Embed count stats
  const statsQ = await db.query<{ entity_type: string; embedded_count: string }>(
    `SELECT entity_type, COUNT(*)::int AS embedded_count FROM semantic_embeddings GROUP BY entity_type`
  );
  const embeddedEntities = Object.fromEntries(statsQ.rows.map(r => [r.entity_type, Number(r.embedded_count)]));

  // Enrich each match with entity details
  const results: SemanticResult[] = [];
  for (const row of searchQ.rows) {
    const detail = await fetchEntityDetail(db, row.entity_type, row.entity_id);
    results.push({
      type:       row.entity_type,
      id:         row.entity_id,
      similarity: Math.round(row.similarity * 1000) / 1000,
      ...(detail ?? { contentPreview: row.content_text.slice(0, 300) }),
    });
  }

  return { query, results, embeddedEntities };
}

async function fetchEntityDetail(db: Pool, entityType: string, entityId: string): Promise<Record<string, unknown> | null> {
  try {
    switch (entityType) {
      case "device": {
        const q = await db.query<Record<string, unknown>>(
          `SELECT uid, hostname, site_uid, site_name, online, operating_system, display_version,
                  int_ip_address, av_product, av_status, patch_status, domain, last_logged_in_user,
                  last_seen, synced_at
           FROM datto_cache_devices WHERE uid = $1`,
          [entityId]
        );
        return q.rows[0] ?? null;
      }
      case "site": {
        const q = await db.query<Record<string, unknown>>(
          `SELECT s.uid, s.name, s.device_count, s.online_count, s.offline_count,
                  s.autotask_company_name, s.description,
                  (SELECT COUNT(*) FROM datto_cache_alerts a
                   WHERE a.site_uid = s.uid AND a.resolved = false)::int AS open_alerts
           FROM datto_cache_sites s WHERE s.uid = $1`,
          [entityId]
        );
        return q.rows[0] ?? null;
      }
      case "alert": {
        const q = await db.query<Record<string, unknown>>(
          `SELECT alert_uid, alert_message, priority, device_uid, device_name,
                  site_uid, site_name, alert_timestamp, muted
           FROM datto_cache_alerts WHERE alert_uid = $1`,
          [entityId]
        );
        return q.rows[0] ?? null;
      }
      case "software": {
        // entityId is lower(trim(name)) — find all devices with this software
        const q = await db.query<Record<string, unknown>>(
          `SELECT ds.name, ds.version, ds.publisher,
                  COUNT(DISTINCT ds.device_uid)::int AS device_count,
                  (array_agg(d.hostname ORDER BY d.hostname)
                   FILTER (WHERE d.hostname IS NOT NULL)
                  )[1:5] AS sample_hosts
           FROM datto_cache_device_software ds
           LEFT JOIN datto_cache_devices d ON d.uid = ds.device_uid
           WHERE lower(trim(ds.name)) = $1
           GROUP BY ds.name, ds.version, ds.publisher
           ORDER BY COUNT(DISTINCT ds.device_uid) DESC
           LIMIT 1`,
          [entityId]
        );
        return q.rows[0] ?? null;
      }
      case "chat_qa": {
        const q = await db.query<Record<string, unknown>>(
          `SELECT um.id, um.content AS question, am.content AS answer,
                  um.created_at, u.username
           FROM chat_messages um
           JOIN LATERAL (
             SELECT content FROM chat_messages
             WHERE session_id = um.session_id AND role = 'assistant' AND created_at > um.created_at
             ORDER BY created_at ASC LIMIT 1
           ) am ON true
           LEFT JOIN users u ON u.id = um.user_id
           WHERE um.id = $1`,
          [entityId]
        );
        if (!q.rows[0]) return null;
        const row = q.rows[0] as Record<string, unknown>;
        // Truncate answer for display in tool results
        return { ...row, answer: (row["answer"] as string).slice(0, 600) };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
