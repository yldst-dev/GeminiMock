# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains production code.
- `src/cli.ts` is the CLI entrypoint (`geminimock`).
- `src/auth/` handles OAuth, credential/account storage, and rotation.
- `src/openai/` maps OpenAI-style payloads to Gemini Code Assist.
- `src/gemini/` contains upstream client, model catalog, and API error handling.
- `src/server/` contains Fastify app routes and background service manager.
- `test/` mirrors runtime domains (`test/auth`, `test/openai`, `test/server`, etc.).
- `dist/` is generated output only; do not edit manually.
- `.github/workflows/` contains unified release and npm publish automation.

## Bun-First Defaults (Migrated from CLAUDE.md)
- Prefer Bun commands by default:
- `bun <file>` instead of `node <file>` or `ts-node <file>`.
- `bun run <script>` instead of `npm run <script>` when possible.
- `bun install` instead of `npm install` for local dependency setup.
- `bunx <pkg>` instead of `npx <pkg>`.
- Bun auto-loads `.env`; avoid adding `dotenv` unless required by external constraints.

## Bun API Preferences (Migrated from CLAUDE.md)
- For new services, prefer `Bun.serve()` over adding Express-based servers.
- Prefer Bun-native APIs when introducing new infrastructure:
- `bun:sqlite` (SQLite), `Bun.redis` (Redis), `Bun.sql` (Postgres), built-in `WebSocket`.
- Prefer `Bun.file` for simple file read/write tasks in Bun runtime contexts.
- If code is already structured around existing project libraries, keep consistency unless a refactor is explicitly requested.

## Build, Test, and Development Commands
- `bun run dev`: run local server in watch mode.
- `bun run start`: run CLI server once.
- `bun run build`: compile TypeScript and prepare CLI bin.
- `bun run test`: run full Vitest suite.
- `bun run lint`: run ESLint checks.
- `bun run typecheck`: strict TypeScript check (`tsc --noEmit`).
- `bun run verify:release`: full release gate (test, lint, typecheck, build, audits).
- Example targeted test: `bun run test -- test/auth/oauth-login-mode.test.ts`.

## Coding Style & Naming Conventions
- Language: TypeScript (`strict`, ESM `NodeNext`).
- Indentation: 2 spaces, keep style consistent with surrounding code.
- File names: kebab-case (`oauth-service.ts`, `model-catalog-service.ts`).
- Prefer explicit types and avoid `any`.
- Keep modules small and domain-focused; extend the nearest existing folder first.

## Testing Guidelines
- Framework: Vitest for repository tests.
- Test files use `*.test.ts` and should map to feature domains under `test/`.
- Add regression tests for auth fallback, model mapping, route behavior, and rotation logic.
- Before PR: run `bun run test && bun run lint && bun run typecheck`.
- For standalone Bun runtime snippets, `bun:test` is acceptable when it does not conflict with repository test structure.

## Commit, Versioning & Release Rules
- Use Conventional Commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`.
- Keep commits atomic and include tests for behavior changes.
- Auto version bump runs on `main` pushes:
- `#major`, `BREAKING CHANGE`, or `!:` => major bump.
- `#minor` => minor bump.
- default or `#patch` => patch bump.
- After bump, the unified workflow handles release tagging and npm trusted publish.

## Security & Configuration Tips
- Never commit OAuth tokens, client secrets, or local credential files.
- Use environment variables for local overrides and OAuth mode selection.
- For headless/remote environments, prefer manual OAuth (`--manual` or `GEMINIMOCK_OAUTH_LOGIN_MODE=manual`).
