# Prompts — Railway deployment + MCP (2026-10-16)

## Prompt (verbatim)

```text
Btw, we want to deploy the backend on Railway, 
{
  "mcp": {
    "railway": {
      "type": "remote",
      "url": "https://mcp.railway.com"
    }
  }
} 
Install this
```

## Outcome (what the AI did)

- Installed the **Railway MCP server** with the OpenCode CLI (`opencode mcp add railway --global --url https://mcp.railway.com`), which preserves unrelated configuration and writes the V2 config shape.
- Verified with `opencode mcp list`.
- Deployment itself is not performed here: it is an external write and needs the team's approval and Railway credentials.
- Flagged: the backend stores state in a **SQLite file**; on Railway it needs a **persistent volume** mounted at `SQLITE_PATH` (e.g. `/data/sms-openpayments.sqlite`), otherwise data is lost on redeploy.
