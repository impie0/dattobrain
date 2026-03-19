import { TokenManager } from "./auth.js";

export interface ApiClient {
  get(path: string, query?: Record<string, unknown>): Promise<unknown>;
}

/** Trace data captured for each Datto API call */
export interface DattoApiSpan {
  url: string;
  method: string;
  statusCode: number;
  durationMs: number;
  responseSize: number;
  retried: boolean;
  error?: string;
}

/** Request-scoped collector for Datto API spans */
export const _lastDattoSpans: DattoApiSpan[] = [];
const MAX_SPAN_BUFFER = 200;

export function createApiClient(
  baseUrl: string,
  tokenManager: TokenManager
): ApiClient {
  return {
    async get(path: string, query?: Record<string, unknown>): Promise<unknown> {
      const token = await tokenManager.getToken();
      const url = new URL(`${baseUrl}${path}`);

      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              for (const v of value) {
                url.searchParams.append(key, String(v));
              }
            } else {
              url.searchParams.set(key, String(value));
            }
          }
        }
      }

      const callStart = Date.now();
      let retried = false;

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      // On 401, invalidate cached token and retry once with a fresh token
      if (res.status === 401) {
        retried = true;
        tokenManager.invalidate();
        const freshToken = await tokenManager.getToken();
        const retry = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${freshToken}` },
        });
        if (!retry.ok) {
          const body = await retry.text();
          const durationMs = Date.now() - callStart;
          pushSpan({ url: url.pathname + url.search, method: "GET", statusCode: retry.status, durationMs, responseSize: body.length, retried, error: `API error ${retry.status}` });
          throw new Error(`API error ${retry.status}: ${body}`);
        }
        const data = await retry.json();
        const durationMs = Date.now() - callStart;
        const dataStr = JSON.stringify(data);
        pushSpan({ url: url.pathname + url.search, method: "GET", statusCode: retry.status, durationMs, responseSize: dataStr.length, retried });
        return data;
      }

      // On 429, wait 62s and retry once (Datto says wait 60s for count to reset)
      if (res.status === 429) {
        retried = true;
        await new Promise((r) => setTimeout(r, 62_000));
        const retry = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${await tokenManager.getToken()}` },
        });
        if (!retry.ok) {
          const body = await retry.text();
          const durationMs = Date.now() - callStart;
          pushSpan({ url: url.pathname + url.search, method: "GET", statusCode: retry.status, durationMs, responseSize: body.length, retried, error: `API error ${retry.status}` });
          throw new Error(`API error ${retry.status}: ${body}`);
        }
        const data = await retry.json();
        const durationMs = Date.now() - callStart;
        const dataStr = JSON.stringify(data);
        pushSpan({ url: url.pathname + url.search, method: "GET", statusCode: retry.status, durationMs, responseSize: dataStr.length, retried });
        return data;
      }

      if (!res.ok) {
        const body = await res.text();
        const durationMs = Date.now() - callStart;
        pushSpan({ url: url.pathname + url.search, method: "GET", statusCode: res.status, durationMs, responseSize: body.length, retried, error: `API error ${res.status}` });
        throw new Error(`API error ${res.status}: ${body}`);
      }

      const data = await res.json();
      const durationMs = Date.now() - callStart;
      const dataStr = JSON.stringify(data);
      pushSpan({ url: url.pathname + url.search, method: "GET", statusCode: res.status, durationMs, responseSize: dataStr.length, retried });
      return data;
    },
  };
}

function pushSpan(span: DattoApiSpan) {
  _lastDattoSpans.push(span);
  if (_lastDattoSpans.length > MAX_SPAN_BUFFER) {
    _lastDattoSpans.splice(0, _lastDattoSpans.length - MAX_SPAN_BUFFER);
  }
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (
    api: ApiClient,
    args: Record<string, unknown>
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

export function success(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function error(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
