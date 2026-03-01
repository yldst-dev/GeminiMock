# GeminiMock

OpenAI-compatible chat API server backed by Gemini Code Assist OAuth.

## Terms of Service Warning

> [!CAUTION]
> Using this project may violate Google's Terms of Service. Some users have reported account suspension or shadow restrictions.
>
> High-risk scenarios:
> - Fresh Google accounts are more likely to be flagged
> - Newly created accounts with Pro/Ultra subscriptions may be reviewed or restricted quickly
>
> By using this project, you acknowledge:
> - This is an unofficial tool and is not endorsed by Google
> - Your account access may be limited, suspended, or permanently banned
> - You accept full responsibility for any risk or loss resulting from use
>
> Recommendation:
> - Prefer an established account that is not critical to your primary services
> - Avoid creating new accounts specifically for this workflow

## Install

- global: `npm i -g geminimock`
- one-off: `npx geminimock models list`

Installed CLI command:

- `geminimock server start`
- `geminimock server stop`
- `geminimock server status`
- `geminimock auth login [--manual|--web]`
- `geminimock auth logout`
- `geminimock auth logout --all`
- `geminimock auth accounts list`
- `geminimock auth accounts use <id|email>`
- `geminimock auth accounts remove <id|email>`
- `geminimock models list`
- `geminimock update`
- `geminimock serve`

## Commands

- `bun run auth:login`
- `bun run auth:logout`
- `bun run auth:logout:all`
- `bun run auth:accounts:list`
- `bun run models:list`
- `bun run server:start`
- `bun run server:stop`
- `bun run server:status`
- `bun run self:update`
- `bun run dev`
- `bun run start`
- `bun run test`
- `bun run lint`
- `bun run typecheck`
- `bun run build`
- `bun run verify:release`
- `bun run check:deps`

## Environment

- `GEMINI_CLI_API_HOST` default: `127.0.0.1`
- `GEMINI_CLI_API_PORT` default: `43173`
- `GEMINI_CLI_MODEL` default: `gemini-2.5-pro`
- `CODE_ASSIST_ENDPOINT` default: `https://cloudcode-pa.googleapis.com`
- `CODE_ASSIST_API_VERSION` default: `v1internal`
- `GEMINI_CLI_API_ACCOUNTS_PATH` default: `~/.geminimock/accounts.json`
- `GEMINI_CLI_API_OAUTH_PATH` default: `~/.geminimock/oauth_creds.json`
- `GEMINI_CLI_OAUTH_FALLBACK_PATH` default: `~/.gemini/oauth_creds.json`
- `GEMINI_CLI_OAUTH_CLIENT_ID` optional override
- `GEMINI_CLI_OAUTH_CLIENT_SECRET` optional
- `GEMINI_CLI_OAUTH_SOURCE_PATH` optional explicit path to Gemini CLI `oauth2.js` for auto-discovery
- `GEMINI_CLI_OAUTH_AUTO_DISCOVERY` default: `1` (`0` disables Gemini CLI client auto-discovery)
- `GEMINI_CLI_BIN_PATH` optional explicit path to `gemini` executable
- `@google/gemini-cli-core` is bundled as dependency, so OAuth client config is discovered without separate `gemini` CLI install
- `GEMINIMOCK_OAUTH_LOGIN_MODE` optional: `auto` (default), `manual`, `web`
- `GEMINIMOCK_OAUTH_FORCE_MANUAL` optional: `1` forces manual login flow
- `GOOGLE_CLOUD_PROJECT` optional
- `GOOGLE_CLOUD_PROJECT_ID` optional

## OAuth Login

1. Run `bun run auth:login`
2. Browser OAuth opens automatically with local callback and account selection prompt
3. If callback cannot complete, paste the authorization code or callback URL in terminal
4. On SSH/headless Linux/CI environments, login automatically falls back to manual code flow instead of waiting on localhost callback timeout
5. Use `geminimock auth login --manual` to force manual flow, `--web` to force localhost callback flow
6. OAuth client config is resolved in this order: explicit env vars, installed Gemini CLI auto-discovery, bundled gemini-cli-core discovery
7. `auth login` uses keyboard TUI (`Up/Down`, `Enter`, `Esc/Ctrl+C`) to start login, repeat login, or finish
8. `Login Completed` screen shows `Last login account: <email>`
9. `auth logout` uses keyboard TUI (`Up/Down`, `Enter`, `Q/Esc`) to choose which account to logout
10. In the logout list, `[*]` means the current active account
11. Choosing `Logout ALL accounts` opens a second TUI confirm selector (`No` / `Yes`)
12. `auth logout --all` clears all registered accounts and fallback Gemini auth state

## Multi-Account Rotation

- accounts are stored in `~/.geminimock/accounts.json`
- active account is used by default
- automatic rotation occurs on API failures indicating rate/capacity/auth blocking:
  - HTTP `429`, `503`, `401`, `403`
  - or error body containing quota/capacity/resource-exhausted indicators
- current account is put on temporary cooldown and next available account is selected
- project cache is invalidated automatically when active account changes (manual switch or auto-rotation), so server restart is not required
- use `geminimock auth accounts list` to inspect active account and IDs
- use `geminimock auth accounts use <id|email>` to pin a specific account manually

## Service Usage Guide

### 1) Start service

Run OAuth login first:

```bash
geminimock auth login
```

Start in background:

```bash
geminimock server start
geminimock server status
```

- default URL is `http://127.0.0.1:43173`
- if `43173` is in use, an available port is selected automatically
- always check actual URL with `geminimock server status`
- log file: `~/.geminimock/server.log`

Run in foreground:

```bash
geminimock serve
```

Quick health check:

```bash
curl -sS http://127.0.0.1:43173/health
```

### 2) API endpoints

- `GET /health`
- `GET /v1/auth/status`
- `GET /v1/models`
- `POST /v1/chat/completions`

Check auth status:

```bash
curl -sS http://127.0.0.1:43173/v1/auth/status
```

Response:

```json
{"authenticated":true}
```

List available models from current account/project:

```bash
curl -sS http://127.0.0.1:43173/v1/models
```

Response format (OpenAI-style model list):

```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-2.5-flash",
      "object": "model",
      "created": 0,
      "owned_by": "google-code-assist"
    }
  ]
}
```

### 3) Chat completion call pattern

Basic request:

```bash
curl -sS -X POST http://127.0.0.1:43173/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hello"}]}'
```

Basic response format (OpenAI-style):

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1772175296,
  "model": "gemini-2.5-flash",
  "choices": [
    {
      "index": 0,
      "finish_reason": "STOP",
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 1,
    "completion_tokens": 9,
    "total_tokens": 31
  }
}
```

Streaming request (`stream: true`, SSE):

```bash
curl -N -sS -X POST http://127.0.0.1:43173/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gemini-2.5-flash","stream":true,"messages":[{"role":"user","content":"Hello"}]}'
```

Streaming response format:

```text
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":"Hel"}}]}
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"lo"}}]}
data: {"id":"...","object":"chat.completion.chunk","choices":[{"finish_reason":"stop","delta":{}}]}
data: [DONE]
```

### 4) How answers are generated

- API is stateless per request
- server does not keep conversation memory between calls
- to continue a conversation, send full history in `messages` each call
- response text is mapped to `choices[0].message.content`
- token usage is mapped to `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`

Model resolution behavior:

- if requested model is unavailable, alias mapping may be applied
- example: `gemini-3-flash` -> `gemini-3-flash-preview` (when available)
- model list normalizes `_vertex` suffix

### 5) System prompt and role mapping

System prompt usage example:

```bash
curl -sS -X POST http://127.0.0.1:43173/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"system","content":"You are concise."},{"role":"user","content":"Summarize OAuth in one sentence."}]}'
```

Role mapping rules:

- `system` messages are merged and sent as Gemini `systemInstruction`
- `assistant` maps to Gemini `model`
- `user` maps to Gemini `user`
- `developer` and `tool` are accepted but mapped as `user`

Important:

- include at least one non-`system` message (`user` or `assistant`)
- sending only `system` may fail with `400 INVALID_ARGUMENT` from upstream

### 6) Error response style

Validation/route errors:

```json
{"error":{"message":"..."}}
```

Common upstream errors:

- `403 PERMISSION_DENIED`: active account lacks permission for resolved project/model
- `404 NOT_FOUND`: requested model or entity does not exist in current project/account
- `429 RESOURCE_EXHAUSTED`: quota/capacity/rate limit

Troubleshooting steps:

1. Check current auth: `curl -sS http://127.0.0.1:43173/v1/auth/status`
2. Check available models: `geminimock models list`
3. Check active account and switch if needed:
   - `geminimock auth accounts list`
   - `geminimock auth accounts use <id|email>`

## GitHub Release Automation

- On push to `main`, `release-publish.yml` runs a single pipeline for version bump, npm publish, and GitHub release.
- Bump rule from pushed commit messages:
  - `#major` or `BREAKING CHANGE` or `!:` -> major
  - `#minor` -> minor
  - default (or `#patch`) -> patch
- If multiple markers exist in the pushed commit range, priority is `major > minor > patch`.
- The workflow commits `package.json` and `package-lock.json` with `[skip ci]` to avoid duplicate runs from the bump commit.
- `release-publish.yml` creates release tag `v<version>` if it does not exist.
- Release notes are generated automatically from the merged changes.
- `release-publish.yml` publishes to npm using Trusted Publishing (OIDC) if that version is not already published.
- Normal workflow: commit and push to `main`; version bump, release, and npm publish run automatically.

Trusted Publisher setup values for npm:

- Publisher: `GitHub Actions`
- Organization or user: `yldst-dev`
- Repository: `GeminiMock`
- Workflow filename: `release-publish.yml`
- Environment name: leave empty
