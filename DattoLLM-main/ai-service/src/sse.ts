import type { Response } from "express";
import { randomUUID } from "node:crypto";

export function writeDelta(res: Response, delta: string, sessionId: string): void {
  const id = randomUUID();
  res.write(`id: ${id}\nevent: delta\ndata: ${JSON.stringify({ delta, sessionId })}\n\n`);
}

export function writeToolCall(
  res: Response,
  tool: string,
  status: "calling" | "done" | "denied"
): void {
  const id = randomUUID();
  res.write(
    `id: ${id}\nevent: tool_call\ndata: ${JSON.stringify({ tool, status })}\n\n`
  );
}

export function writeError(res: Response, message: string, code: string): void {
  const id = randomUUID();
  res.write(`id: ${id}\nevent: error\ndata: ${JSON.stringify({ error: code, message })}\n\n`);
}

export function writeDone(res: Response): void {
  const id = randomUUID();
  res.write(`id: ${id}\nevent: done\ndata: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}
