import type { Pool } from "pg";
import type OpenAI from "openai";

export async function loadHistory(
  sessionId: string,
  db: Pool
): Promise<OpenAI.ChatCompletionMessageParam[]> {
  const result = await db.query(
    `SELECT role, content FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT 20`,
    [sessionId]
  );

  return result.rows.map((row: { role: string; content: string }) => ({
    role: row.role as "user" | "assistant",
    content: row.content,
  }));
}

export async function saveMessages(
  sessionId: string,
  userId: string,
  userContent: string,
  assistantContent: string,
  toolsUsed: string[],
  db: Pool,
  allowedTools: string[] = []
): Promise<{ userMsgId: string; assistantMsgId: string }> {
  // Ensure the session row exists before inserting messages
  await db.query(
    `INSERT INTO chat_sessions (id, user_id, title, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET title = COALESCE(NULLIF(chat_sessions.title, ''), $3), updated_at = NOW()`,
    [sessionId, userId, userContent.slice(0, 100)]
  );

  // Rough token estimate: ~4 chars per token (good enough for observability)
  const userTokens = Math.ceil(userContent.length / 4);
  const assistantTokens = Math.ceil(assistantContent.length / 4);

  const userResult = await db.query(
    `INSERT INTO chat_messages (session_id, user_id, role, content, tools_used, token_count)
     VALUES ($1, $2, 'user', $3, $4, $5)
     RETURNING id`,
    [sessionId, userId, userContent, JSON.stringify([]), userTokens]
  );

  const assistantResult = await db.query(
    `INSERT INTO chat_messages (session_id, user_id, role, content, tools_used, token_count)
     VALUES ($1, $2, 'assistant', $3, $4, $5)
     RETURNING id`,
    [sessionId, userId, assistantContent, JSON.stringify(toolsUsed), assistantTokens]
  );

  return {
    userMsgId: (userResult.rows[0] as { id: string }).id,
    assistantMsgId: (assistantResult.rows[0] as { id: string }).id,
  };
}

export async function saveEmbeddings(
  userMsgId: string,
  userVec: number[],
  assistantMsgId: string,
  assistantVec: number[],
  db: Pool
): Promise<void> {
  await db.query(
    "UPDATE chat_messages SET embedding = $1 WHERE id = $2",
    [JSON.stringify(userVec), userMsgId]
  );
  await db.query(
    "UPDATE chat_messages SET embedding = $1 WHERE id = $2",
    [JSON.stringify(assistantVec), assistantMsgId]
  );
}
