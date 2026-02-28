# GeminiMock

OpenAI-compatible chat API server backed by Gemini Code Assist OAuth.

## Install

- global: `npm i -g geminimock`
- one-off: `npx geminimock models list`

Installed CLI command:

- `geminimock server start`
- `geminimock server stop`
- `geminimock server status`
- `geminimock auth login`
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
- `GOOGLE_CLOUD_PROJECT` optional
- `GOOGLE_CLOUD_PROJECT_ID` optional

## OAuth Login

1. Run `bun run auth:login`
2. Browser OAuth opens automatically with local callback and account selection prompt
3. If callback cannot complete, paste the authorization code or callback URL in terminal
4. OAuth client config is resolved in this order: explicit env vars, installed Gemini CLI auto-discovery
5. `auth login` uses keyboard TUI (`Up/Down`, `Enter`, `Q/Esc`) to start login, repeat login, or finish
6. `Login Completed` screen shows `Last login account: <email>`
7. `auth logout` uses keyboard TUI (`Up/Down`, `Enter`, `Q/Esc`) to choose which account to logout
8. In the logout list, `[*]` means the current active account
9. Choosing `Logout ALL accounts` opens a second TUI confirm selector (`No` / `Yes`)
10. `auth logout --all` clears all registered accounts and fallback Gemini auth state

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

## API

- `GET /health`
- `GET /v1/auth/status`
- `GET /v1/models`
- `POST /v1/chat/completions`

Example:

```bash
curl -sS -X POST http://127.0.0.1:43173/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hello"}]}'
```

```bash
curl -sS http://127.0.0.1:43173/v1/models
```

Notes:

- `messages` must include at least one non-`system` message (`user` or `assistant`). Sending only `system` can fail with:
  - `400 INVALID_ARGUMENT: at least one contents field is required`
- To use system prompt, include both `system` and `user`:

```bash
curl -sS -X POST http://127.0.0.1:43173/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"system","content":"You are concise."},{"role":"user","content":"Hello"}]}'
```

Troubleshooting:

- `403 PERMISSION_DENIED` (for example `IAM_PERMISSION_DENIED`) usually means the active account does not have permission on the resolved Google project/model.
- Check active account and switch if needed:
  - `geminimock auth accounts list`
  - `geminimock auth accounts use <id|email>`
- Check currently available models for that account/project:
  - `geminimock models list`

## Background Server

- start: `geminimock server start`
- status: `geminimock server status`
- stop: `geminimock server stop`
- log file: `~/.geminimock/server.log`
- if `43173` is already in use, `server start` automatically picks an available port; check the actual URL with `server status`

## GitHub Release Automation

- On push to `main`, GitHub Actions reads `package.json` version and creates a release tag `v<version>` if it does not exist.
- Release notes are generated automatically from the merged changes.
- To publish a new release, bump `package.json` version, commit, and push to `main`.
