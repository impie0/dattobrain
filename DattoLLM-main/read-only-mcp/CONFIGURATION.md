# Configuration -- API Tokens and Settings

This guide covers every credential and setting you need to configure before the read-only-mcp server can connect to the Datto RMM API.

---

## 1. Required: Datto API Credentials

You need two values from the Datto RMM portal:

| Variable | What It Is |
|----------|-----------|
| `DATTO_API_KEY` | Your API key (OAuth2 client ID) |
| `DATTO_API_SECRET` | Your API secret (OAuth2 client secret) |

### Where to get them

1. Log in to the Datto RMM web console.
2. Navigate to **Setup > Global Settings > API**.
3. Generate (or copy) your API key and secret.

These credentials use the OAuth2 `client_credentials` grant. The server exchanges them for a short-lived Bearer token automatically.

---

## 2. Optional: Platform Region

| Variable | Default | What It Is |
|----------|---------|-----------|
| `DATTO_PLATFORM` | `merlot` | Selects which Datto regional API endpoint to use |

The platform determines the base URL the server calls. Choose the one that matches your Datto RMM account region:

| Code | Region | API Base URL |
|------|--------|-------------|
| `merlot` | US East (default) | `https://merlot-api.centrastage.net/api` |
| `concord` | US West | `https://concord-api.centrastage.net/api` |
| `pinotage` | Asia Pacific | `https://pinotage-api.centrastage.net/api` |
| `vidal` | EU Frankfurt | `https://vidal-api.centrastage.net/api` |
| `zinfandel` | EU London | `https://zinfandel-api.centrastage.net/api` |
| `syrah` | Canada | `https://syrah-api.centrastage.net/api` |

If you are unsure which platform you are on, check the URL you use to log in to Datto RMM -- the subdomain matches the code name.

---

## 3. Where to Set the Environment Variables

### 3a. Docker CLI (recommended)

Pass them as `-e` flags when running the container:

```bash
docker run --rm -i \
  -e DATTO_API_KEY=your_api_key_here \
  -e DATTO_API_SECRET=your_api_secret_here \
  -e DATTO_PLATFORM=merlot \
  read-only-mcp
```

Replace `your_api_key_here` and `your_api_secret_here` with your real credentials. Change `merlot` if you are on a different region.

### 3b. Cursor IDE (.cursor/mcp.json)

Open (or create) `.cursor/mcp.json` in the workspace root and set the `env` values:

```json
{
  "mcpServers": {
    "read-only-mcp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "DATTO_API_KEY",
        "-e", "DATTO_API_SECRET",
        "-e", "DATTO_PLATFORM",
        "read-only-mcp"
      ],
      "env": {
        "DATTO_API_KEY": "REPLACE_WITH_YOUR_API_KEY",
        "DATTO_API_SECRET": "REPLACE_WITH_YOUR_API_SECRET",
        "DATTO_PLATFORM": "merlot"
      }
    }
  }
}
```

The three placeholders you must change:
- `REPLACE_WITH_YOUR_API_KEY` -- your Datto API key
- `REPLACE_WITH_YOUR_API_SECRET` -- your Datto API secret
- `merlot` -- change only if your account is on a different region

### 3c. Claude Desktop (claude_desktop_config.json)

On Windows the config file is at:

```
%APPDATA%\Claude\claude_desktop_config.json
```

Add this entry inside the `mcpServers` object:

```json
{
  "mcpServers": {
    "read-only-mcp": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "DATTO_API_KEY=REPLACE_WITH_YOUR_API_KEY",
        "-e", "DATTO_API_SECRET=REPLACE_WITH_YOUR_API_SECRET",
        "-e", "DATTO_PLATFORM=merlot",
        "read-only-mcp"
      ]
    }
  }
}
```

Replace the same three placeholders.

### 3d. Claude Code CLI

```bash
claude mcp add read-only-mcp -- docker run --rm -i \
  -e DATTO_API_KEY=REPLACE_WITH_YOUR_API_KEY \
  -e DATTO_API_SECRET=REPLACE_WITH_YOUR_API_SECRET \
  -e DATTO_PLATFORM=merlot \
  read-only-mcp
```

### 3e. Local Development (.env file)

For running without Docker (via `npm run dev`), create a `.env` file in the `read-only-mcp/` folder:

```
DATTO_API_KEY=your_api_key_here
DATTO_API_SECRET=your_api_secret_here
DATTO_PLATFORM=merlot
```

Then load the variables before starting:

**PowerShell:**
```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
npm run dev
```

**Bash / WSL:**
```bash
export $(cat .env | xargs)
npm run dev
```

---

## 4. Security Reminders

- **Never commit real API keys.** The `.dockerignore` already excludes `.env` files from the Docker build context.
- Add `.env` to your `.gitignore` if you initialize a git repo in this folder.
- The API key and secret are only sent to the Datto OAuth token endpoint over HTTPS. They are never logged or included in MCP responses.
- Rotate your API credentials in the Datto portal if you suspect they have been exposed.
