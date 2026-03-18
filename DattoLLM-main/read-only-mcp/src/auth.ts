const PLATFORM_URLS: Record<string, string> = {
  pinotage: "https://pinotage-api.centrastage.net/api",
  merlot: "https://merlot-api.centrastage.net/api",
  concord: "https://concord-api.centrastage.net/api",
  vidal: "https://vidal-api.centrastage.net/api",
  zinfandel: "https://zinfandel-api.centrastage.net/api",
  syrah: "https://syrah-api.centrastage.net/api",
};

export function getBaseUrl(platform: string): string {
  const url = PLATFORM_URLS[platform.toLowerCase()];
  if (!url) {
    const valid = Object.keys(PLATFORM_URLS).join(", ");
    throw new Error(`Invalid platform "${platform}". Valid: ${valid}`);
  }
  return url;
}

export class TokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private apiKey: string,
    private apiSecret: string,
    private tokenUrl: string
  ) {}

  async getToken(): Promise<string> {
    const BUFFER_MS = 5 * 60 * 1000;
    if (this.token && Date.now() < this.expiresAt - BUFFER_MS) {
      return this.token;
    }
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchToken().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
    this.refreshPromise = null;
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from("public-client:public").toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: this.apiKey,
        password: this.apiSecret,
      }).toString(),
    });

    if (!res.ok) {
      throw new Error(`OAuth token request failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }
}

export interface AppConfig {
  apiKey: string;
  apiSecret: string;
  platform: string;
  baseUrl: string;
}

export function loadConfig(): AppConfig {
  const apiKey = process.env["DATTO_API_KEY"];
  const apiSecret = process.env["DATTO_API_SECRET"];
  const platform = (process.env["DATTO_PLATFORM"] ?? "merlot").toLowerCase();

  if (!apiKey) throw new Error("DATTO_API_KEY environment variable is required");
  if (!apiSecret) throw new Error("DATTO_API_SECRET environment variable is required");

  const baseUrl = getBaseUrl(platform);
  return { apiKey, apiSecret, platform, baseUrl };
}
