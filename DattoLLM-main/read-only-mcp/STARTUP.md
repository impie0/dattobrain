# Startup Guide -- How to Build and Run the Server

---

## Prerequisites

You need **one** of the following:

- **Docker Desktop** with WSL enabled (recommended), OR
- **Node.js 22+** installed locally

---

## Option A: Docker (Recommended)

### Step 1 -- Build the image

Open a terminal in the `read-only-mcp/` folder and run:

```bash
docker build -t read-only-mcp .
```

This compiles the TypeScript, installs dependencies, and creates a lightweight Alpine Linux image. It takes about 30 seconds on first build.

### Step 2 -- Run the container

```bash
docker run --rm -i \
  -e DATTO_API_KEY=your_api_key_here \
  -e DATTO_API_SECRET=your_api_secret_here \
  -e DATTO_PLATFORM=merlot \
  read-only-mcp
```

Replace the placeholder values with your real Datto API credentials. See [CONFIGURATION.md](CONFIGURATION.md) for details on where to get them and what platform code to use.

**Important flags:**
- `--rm` removes the container when it exits (keeps things clean).
- `-i` keeps stdin open -- required because the server communicates over stdio, not HTTP.
- Do **not** use `-d` (detached mode) when connecting to an AI client, since the client needs to pipe stdin/stdout.

### Step 3 -- Verify the MCP handshake

To confirm the server starts and responds correctly, send a test initialize request:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | docker run --rm -i -e DATTO_API_KEY=test -e DATTO_API_SECRET=test read-only-mcp
```

You should see a JSON response containing:

```json
{
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "read-only-mcp", "version": "1.0.0" }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

This test uses dummy credentials. The handshake succeeds because authentication only happens when a tool is actually called, not during initialization.

---

## Option B: Local Node.js

### Step 1 -- Install dependencies

```bash
npm install
```

### Step 2 -- Build

```bash
npm run build
```

This runs the TypeScript compiler and outputs JavaScript to the `dist/` folder.

### Step 3 -- Set environment variables and start

**PowerShell:**
```powershell
$env:DATTO_API_KEY = "your_api_key_here"
$env:DATTO_API_SECRET = "your_api_secret_here"
$env:DATTO_PLATFORM = "merlot"
npm start
```

**Bash / WSL:**
```bash
export DATTO_API_KEY=your_api_key_here
export DATTO_API_SECRET=your_api_secret_here
export DATTO_PLATFORM=merlot
npm start
```

### Development mode (hot reload)

For faster iteration while editing the code, use:

```bash
npm run dev
```

This runs the TypeScript source directly via `tsx` without needing a separate build step. Set the environment variables first as shown above.

---

## Connecting to an AI Client

Once the Docker image is built (or the local build is done), configure your AI client to launch the server. See [CONFIGURATION.md](CONFIGURATION.md) for copy-paste config snippets for:

- Cursor IDE (`.cursor/mcp.json`)
- Claude Desktop (`claude_desktop_config.json`)
- Claude Code CLI (`claude mcp add`)

---

## Testing with MCP Inspector

The MCP Inspector is a web-based GUI that lets you browse tools, make test calls, and see raw JSON-RPC traffic.

### Launch the Inspector

```bash
npx @modelcontextprotocol/inspector
```

This opens a browser window. Configure the transport to point at the server:

1. Set **Transport** to `stdio`.
2. Set **Command** to `docker`.
3. Set **Arguments** to: `run --rm -i -e DATTO_API_KEY=your_key -e DATTO_API_SECRET=your_secret read-only-mcp`
4. Click **Connect**.

You should see all 37 tools listed. You can click any tool, fill in parameters, and execute it to see the live API response.

---

## Troubleshooting

### "DATTO_API_KEY environment variable is required"

The container started but no API key was passed. Make sure you include the `-e` flags when running `docker run`. If you are using Docker Desktop's GUI "Start" button, it does not pass environment variables -- always use the command line.

### "Invalid platform" error

The `DATTO_PLATFORM` value does not match any known region. Valid values are: `merlot`, `concord`, `pinotage`, `vidal`, `zinfandel`, `syrah`. The value is case-insensitive.

### "OAuth token request failed: 401"

Your API key or secret is incorrect. Double-check the values in the Datto RMM portal under Setup > Global Settings > API.

### "OAuth token request failed: 403"

Your API credentials may not have the necessary permissions, or your Datto RMM subscription does not include API access. Contact your Datto administrator.

### Container exits immediately with no output

Make sure you included the `-i` flag. Without it, stdin closes immediately and the stdio transport shuts down.

### "API error 429"

You have hit the Datto RMM API rate limit. Use the `get-rate-limit` tool to check your current usage. Wait and retry, or reduce the frequency of requests.

### Docker build fails with network errors

Ensure Docker Desktop is running and has internet access. If you are behind a corporate proxy, configure Docker's proxy settings in Docker Desktop > Settings > Resources > Proxies.
