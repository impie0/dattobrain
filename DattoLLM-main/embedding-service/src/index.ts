import express from "express";
import cors from "cors";

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...extra });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function validateEnv() {
  if (!process.env["EMBEDDING_API_KEY"]) {
    log("error", "Missing required environment variable: EMBEDDING_API_KEY");
    process.exit(1);
  }
}

validateEnv();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/embed", async (req, res) => {
  const { text } = req.body as { text?: unknown };

  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "invalid_request", message: "text must be a non-empty string" });
    return;
  }

  const provider = process.env["EMBEDDING_PROVIDER"] ?? "voyage";
  const apiKey = process.env["EMBEDDING_API_KEY"]!;

  try {
    let url: string;
    let body: object;
    let responseParser: (data: unknown) => { vector: number[]; dimensions: number };

    if (provider === "openai") {
      url = "https://api.openai.com/v1/embeddings";
      const model = process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small";
      body = { input: text, model };
      responseParser = (data) => {
        const d = data as { data: Array<{ embedding: number[] }> };
        const vector = d.data[0]!.embedding;
        return { vector, dimensions: vector.length };
      };
    } else {
      // voyage (default)
      url = "https://api.voyageai.com/v1/embeddings";
      const model = process.env["EMBEDDING_MODEL"] ?? "voyage-3";
      body = { input: text, model };
      responseParser = (data) => {
        const d = data as { data: Array<{ embedding: number[] }> };
        const vector = d.data[0]!.embedding;
        return { vector, dimensions: vector.length };
      };
    }

    const apiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      log("error", "embedding_api_error", { status: apiRes.status, provider, body: errText });
      res.status(502).json({ error: "embedding_failed", message: errText });
      return;
    }

    const data = await apiRes.json();
    const result = responseParser(data);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "embedding_request_error", { provider, error: message });
    res.status(502).json({ error: "embedding_failed", message });
  }
});

const port = Number(process.env["PORT"] ?? 7001);
app.listen(port, () => {
  log("info", `embedding-service listening on :${port}`);
});
