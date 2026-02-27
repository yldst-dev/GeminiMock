# GeminiMock

OpenAI-compatible chat API server backed by Gemini Code Assist OAuth.

## Install

- global: `npm i -g geminimock`
- one-off: `npx geminimock models list`

Installed CLI command:

- `geminimock auth login`
- `geminimock auth logout`
- `geminimock models list`
- `geminimock update`
- `geminimock serve`

## Commands

- `bun run auth:login`
- `bun run auth:logout`
- `bun run models:list`
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
- `GEMINI_CLI_API_PORT` default: `8080`
- `GEMINI_CLI_MODEL` default: `gemini-2.5-pro`
- `CODE_ASSIST_ENDPOINT` default: `https://cloudcode-pa.googleapis.com`
- `CODE_ASSIST_API_VERSION` default: `v1internal`
- `GEMINI_CLI_API_OAUTH_PATH` default: `~/.geminimock/oauth_creds.json`
- `GEMINI_CLI_OAUTH_FALLBACK_PATH` default: `~/.gemini/oauth_creds.json`
- `GEMINI_CLI_OAUTH_CLIENT_ID` required for fresh OAuth login
- `GEMINI_CLI_OAUTH_CLIENT_SECRET` required for fresh OAuth login
- `GOOGLE_CLOUD_PROJECT` optional
- `GOOGLE_CLOUD_PROJECT_ID` optional

## OAuth Login

1. Run `bun run auth:login`
2. Browser opens automatically and listens on a local callback URL
3. If browser callback is not available, paste either authorization code or full callback URL
4. If OAuth client env values are not set but `~/.gemini/oauth_creds.json` exists, stored credentials are reused

## API

- `GET /health`
- `GET /v1/auth/status`
- `GET /v1/models`
- `POST /v1/chat/completions`

Example:

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hello"}]}'
```

```bash
curl -sS http://127.0.0.1:8080/v1/models
```
