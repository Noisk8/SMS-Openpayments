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

## Prompt 2 (verbatim)

```text
done!, railway connected, deploy the backend there!
```

## Prompt 3 (verbatim)

```text
Btw, create a DB on railway, hence we can connect there from the local deployment, it would make easier to iterate!
```

## Team decision

"Si no hay forma de tener el comportamiento que pedi con SQlite, usa postgres."

There is no way to share a networked SQLite between local and Railway, so the persistence layer moves
to **PostgreSQL** (Railway-hosted), shared by the local backend and the deployed service.

## Prompt 4 (verbatim)

```text
ea81e746d3cd8bc4832d8acb8423604b164e5616bf746dc35e9430c7ee95325a THIS IS A HACKATHON, API KEYS DOESNT MATTER, use this as the encryption key
```

Decision: this 64-hex-character value is the `ENCRYPTION_KEY` for local and Railway. `SecretBox`
now accepts a 32-byte key as either 64 hex characters or base64. Secrets are not treated as
sensitive for this hackathon, but they are still kept in `.env` (git-ignored) and Railway variables.

## Outcome (what the AI did)

- Deployed the `postgres` template into the Railway project `thorough-energy` (service `Postgres`).
- Diagnosed the existing service crash: `sh: 1: tsx: not found` (Railway installs without
  devDependencies; the service also builds from the repo root instead of `backend/`).
- Database credentials are redacted by the MCP (OAuth), so the public `DATABASE_URL` for local use
  must be copied from the Railway dashboard.
- Next: migrate the backend from better-sqlite3 to Postgres (`pg`), then configure and deploy the
  service (root directory `backend/`, healthcheck `/health`, env vars).

- Installed the **Railway MCP server** with the OpenCode CLI (`opencode mcp add railway --global --url https://mcp.railway.com`), which preserves unrelated configuration and writes the V2 config shape.
- Verified with `opencode mcp list`.
- Deployment itself is not performed here: it is an external write and needs the team's approval and Railway credentials.
- Flagged: the backend stores state in a **SQLite file**; on Railway it needs a **persistent volume** mounted at `SQLITE_PATH` (e.g. `/data/sms-openpayments.sqlite`), otherwise data is lost on redeploy.
