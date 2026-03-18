import type { Pool } from "pg";

export interface SimilarMessage {
  content: string;
  role: string;
  similarity: number;
}

export async function searchSimilar(
  queryVector: number[],
  userId: string,
  currentSessionId: string,
  db: Pool
): Promise<SimilarMessage[]> {
  const result = await db.query(
    `SELECT content, role, 1 - (embedding <=> $1::vector) AS similarity
     FROM chat_messages
     WHERE user_id = $2
       AND session_id != $3
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) > 0.78
     ORDER BY embedding <=> $1::vector
     LIMIT 5`,
    [JSON.stringify(queryVector), userId, currentSessionId]
  );

  return result.rows as SimilarMessage[];
}
