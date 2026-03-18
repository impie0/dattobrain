import { TokenManager } from "./auth.js";

export interface ApiClient {
  get(path: string, query?: Record<string, unknown>): Promise<unknown>;
}

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

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      // On 401, invalidate cached token and retry once with a fresh token
      if (res.status === 401) {
        tokenManager.invalidate();
        const freshToken = await tokenManager.getToken();
        const retry = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${freshToken}` },
        });
        if (!retry.ok) {
          const body = await retry.text();
          throw new Error(`API error ${retry.status}: ${body}`);
        }
        return retry.json();
      }

      // On 429, wait 62s and retry once (Datto says wait 60s for count to reset)
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 62_000));
        const retry = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${await tokenManager.getToken()}` },
        });
        if (!retry.ok) {
          const body = await retry.text();
          throw new Error(`API error ${retry.status}: ${body}`);
        }
        return retry.json();
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`API error ${res.status}: ${body}`);
      }

      return res.json();
    },
  };
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
