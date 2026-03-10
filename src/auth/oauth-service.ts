import { createServer } from "node:http";
import { spawn } from "node:child_process";
import net from "node:net";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AccountStore, StoredAccount } from "./account-store.js";
import type { StoredCredentials } from "./credential-store.js";
import type { OAuthClient } from "./oauth-client.js";
import {
  buildManualOAuthRequest,
  buildWebOAuthRequest,
  createOAuthClient,
  exchangeManualCode,
  exchangeWebCode,
  GEMINI_CLI_OAUTH_SCOPE,
  hasConfiguredOAuthClient,
  parseOAuthInput,
  type ParsedOAuthInput
} from "./oauth-flow.js";
import type { CodeAssistApiError } from "../gemini/errors.js";

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const OAUTH_LOGIN_MODE_ENV = "GEMINIMOCK_OAUTH_LOGIN_MODE";
const OAUTH_FORCE_MANUAL_ENV = "GEMINIMOCK_OAUTH_FORCE_MANUAL";

export type OAuthLoginMode = "auto" | "manual" | "web";

export type OAuthServiceIO = {
  write(message: string): void;
  readCode(prompt: string): Promise<string>;
};

function defaultIO(): OAuthServiceIO {
  return {
    write(message: string) {
      output.write(message);
    },
    async readCode(prompt: string) {
      const rl = createInterface({ input, output });
      const code = await rl.question(prompt);
      rl.close();
      return code;
    }
  };
}

function normalizeCredentials(credentials: StoredCredentials): StoredCredentials {
  return {
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token ?? undefined,
    expiry_date: credentials.expiry_date ?? undefined,
    token_type: credentials.token_type ?? undefined,
    scope: credentials.scope ?? GEMINI_CLI_OAUTH_SCOPE.join(" ")
  };
}

async function fetchUserEmail(client: OAuthClient): Promise<string | undefined> {
  const token = await client.getAccessToken();
  if (!token.token) {
    return undefined;
  }
  return fetchUserEmailFromAccessToken(token.token);
}

async function fetchUserEmailFromAccessToken(accessToken: string): Promise<string | undefined> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    return undefined;
  }
  const data = (await response.json()) as { email?: string };
  return data.email;
}

function shouldRotateForError(error: CodeAssistApiError): boolean {
  const body = error.body.toLowerCase();
  if (error.status === 429 || error.status === 503 || error.status === 401 || error.status === 403) {
    return true;
  }
  if (error.status === 500 && body.includes("resource_exhausted")) {
    return true;
  }
  if (body.includes("model_capacity_exhausted")
    || body.includes("no capacity available")
    || body.includes("ratelimitexceeded")
    || body.includes("rate limit")
    || body.includes("quota")
    || body.includes("resource_exhausted")) {
    return true;
  }
  return false;
}

function cooldownForError(error: CodeAssistApiError): number {
  if (typeof error.retryAfterMs === "number" && error.retryAfterMs > 0) {
    return error.retryAfterMs;
  }

  const body = error.body.toLowerCase();
  if (error.status === 401 || error.status === 403) {
    return 15 * 60 * 1000;
  }
  if (body.includes("model_capacity_exhausted") || body.includes("no capacity available")) {
    return 45_000;
  }
  if (body.includes("quota")) {
    return 30 * 60 * 1000;
  }
  if (error.status === 429) {
    return 60_000;
  }
  if (error.status === 503) {
    return 60_000;
  }
  if (error.status === 500 && body.includes("resource_exhausted")) {
    return 60_000;
  }
  return 30_000;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("Unable to allocate callback port"));
      });
    });
    server.on("error", reject);
  });
}

async function openExternalUrl(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === "darwin"
    ? { cmd: "open", args: [url] }
    : platform === "win32"
      ? { cmd: "cmd", args: ["/c", "start", "", url] }
      : { cmd: "xdg-open", args: [url] };

  return new Promise((resolve) => {
    const child = spawn(command.cmd, command.args, {
      stdio: "ignore",
      detached: true
    });

    child.on("error", () => resolve(false));
    child.unref();
    resolve(true);
  });
}

function parseLoginMode(value: string | undefined): OAuthLoginMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "manual") {
    return "manual";
  }
  if (normalized === "web") {
    return "web";
  }
  if (normalized === "auto") {
    return "auto";
  }
  return undefined;
}

function isHeadlessOrRemoteEnvironment(): boolean {
  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) {
    return true;
  }
  if (process.env.CI === "1" || process.env.CI === "true") {
    return true;
  }
  if (process.env[OAUTH_FORCE_MANUAL_ENV] === "1") {
    return true;
  }
  if (process.platform === "linux") {
    const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.MIR_SOCKET);
    if (!hasDisplay) {
      return true;
    }
  }
  return false;
}

export function resolveOAuthLoginMode(requestedMode: OAuthLoginMode = "auto"): OAuthLoginMode {
  if (requestedMode !== "auto") {
    return requestedMode;
  }
  const envMode = parseLoginMode(process.env[OAUTH_LOGIN_MODE_ENV]);
  if (envMode && envMode !== "auto") {
    return envMode;
  }
  if (isHeadlessOrRemoteEnvironment()) {
    return "manual";
  }
  return "auto";
}

type CallbackPayload = {
  code: string;
  state?: string;
};

async function startCallbackListener(port: number, timeoutMs: number): Promise<{
  waitForCallback: () => Promise<CallbackPayload>;
  close: () => Promise<void>;
}> {
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  let resolveWait!: (payload: CallbackPayload) => void;
  let rejectWait!: (error: Error) => void;

  const waitPromise = new Promise<CallbackPayload>((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
  });

  const server = createServer((req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid request");
        return;
      }

      const parsed = new URL(req.url, `http://127.0.0.1:${port}`);
      if (parsed.pathname !== "/oauth2callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state") ?? undefined;
      const error = parsed.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("OAuth failed");
        if (!settled) {
          settled = true;
          rejectWait(new Error(`OAuth error: ${error}`));
        }
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing code");
        if (!settled) {
          settled = true;
          rejectWait(new Error("OAuth callback missing code"));
        }
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>Login complete</h1><p>You can close this tab.</p></body></html>");

      if (!settled) {
        settled = true;
        resolveWait({ code, state });
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        rejectWait(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      setImmediate(() => {
        server.close();
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, process.env.OAUTH_CALLBACK_HOST ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectWait(new Error("Timed out waiting for OAuth callback"));
      server.close();
    }
  }, timeoutMs);

  return {
    waitForCallback: () => waitPromise,
    close: () =>
      new Promise((resolve) => {
        if (timer) {
          clearTimeout(timer);
        }
        server.close(() => resolve());
      })
  };
}

export class OAuthService {
  constructor(private readonly store: AccountStore) {}

  async listAccounts(): Promise<StoredAccount[]> {
    return this.store.listAccounts();
  }

  async useAccount(idOrEmail: string): Promise<StoredAccount> {
    return this.store.setActiveAccount(idOrEmail);
  }

  async removeAccount(idOrEmail: string): Promise<boolean> {
    return this.store.removeAccount(idOrEmail);
  }

  async login(io: OAuthServiceIO = defaultIO(), mode: OAuthLoginMode = "auto"): Promise<{ email?: string }> {
    if (!hasConfiguredOAuthClient()) {
      throw new Error("OAuth client is not configured.");
    }

    const resolvedMode = resolveOAuthLoginMode(mode);
    if (resolvedMode === "manual") {
      io.write("Using manual authorization code flow.\n\n");
      return this.loginManual(io);
    }
    if (resolvedMode === "web") {
      return this.loginWithWebCallback(io);
    }

    try {
      const result = await this.loginWithWebCallback(io);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.write(`Automatic callback login failed: ${message}\n`);
      io.write("Falling back to manual authorization code flow.\n\n");
      return this.loginManual(io);
    }
  }

  private async loginWithWebCallback(io: OAuthServiceIO): Promise<{ email?: string }> {
    const port = await getAvailablePort();
    const request = await buildWebOAuthRequest(port);
    const listener = await startCallbackListener(port, OAUTH_TIMEOUT_MS);

    try {
      const opened = await openExternalUrl(request.authUrl);
      if (!opened) {
        throw new Error("Unable to open browser for localhost callback flow");
      }
      io.write(`${request.authUrl}\n\n`);
      io.write("Waiting for OAuth callback...\n");

      const callback = await listener.waitForCallback();
      if (callback.state && callback.state !== request.state) {
        throw new Error("OAuth state mismatch");
      }

      const tokens = await exchangeWebCode(request, callback.code);
      if (!tokens.access_token) {
        throw new Error("OAuth login did not return access_token");
      }

      const stored = normalizeCredentials({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? undefined,
        expiry_date: tokens.expiry_date ?? undefined,
        token_type: tokens.token_type ?? undefined,
        scope: tokens.scope ?? undefined
      });

      await this.store.addOrUpdateAccount(stored);
      const client = createOAuthClient();
      client.setCredentials(stored);
      const email = await fetchUserEmail(client);
      await this.store.updateActiveCredentials(stored, email);
      return { email };
    } finally {
      await listener.close();
    }
  }

  private async loginManual(io: OAuthServiceIO): Promise<{ email?: string }> {
    const request = await buildManualOAuthRequest();
    io.write(`Open this URL and complete login:\n\n${request.authUrl}\n\n`);
    const rawInput = await io.readCode("Paste the authorization code (or callback URL): ");
    const parsed: ParsedOAuthInput = parseOAuthInput(rawInput);
    if (parsed.state && parsed.state !== request.state) {
      throw new Error("OAuth state mismatch");
    }

    const tokens = await exchangeManualCode(request, parsed.code);
    if (!tokens.access_token) {
      throw new Error("OAuth login did not return access_token");
    }

    const stored = normalizeCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
      token_type: tokens.token_type ?? undefined,
      scope: tokens.scope ?? undefined
    });

    await this.store.addOrUpdateAccount(stored);
    const client = createOAuthClient();
    client.setCredentials(stored);
    const email = await fetchUserEmail(client);
    await this.store.updateActiveCredentials(stored, email);
    return { email };
  }

  async logout(): Promise<StoredAccount | null> {
    return this.store.logoutActive();
  }

  async logoutAll(): Promise<void> {
    await this.store.clearAll();
  }

  async getClient(): Promise<OAuthClient> {
    const active = await this.store.getActiveAccount();
    if (!active) {
      throw new Error("OAuth credentials not found. Run auth login first.");
    }

    const credentials = active.credentials;
    const client = createOAuthClient();
    client.setCredentials(normalizeCredentials(credentials));

    const token = await client.getAccessToken();
    if (!token.token) {
      throw new Error("Failed to obtain access token from stored credentials.");
    }

    const merged = normalizeCredentials({
      access_token: token.token,
      refresh_token: client.credentials.refresh_token ?? credentials.refresh_token,
      expiry_date: client.credentials.expiry_date ?? undefined,
      token_type: client.credentials.token_type ?? undefined,
      scope: client.credentials.scope ?? undefined
    });
    await this.store.updateActiveCredentials(merged, active.email);
    client.setCredentials(merged);
    return client;
  }

  async getAccessToken(): Promise<string> {
    const active = await this.store.getActiveAccount();
    const credentials = active?.credentials;
    if (credentials?.access_token) {
      const expiresAt = credentials.expiry_date ?? Number.MAX_SAFE_INTEGER;
      if (expiresAt > Date.now() + 60_000) {
        return credentials.access_token;
      }
    }
    const client = await this.getClient();
    const token = await client.getAccessToken();
    if (!token.token) {
      throw new Error("Access token is empty");
    }
    return token.token;
  }

  async getApiAttemptLimit(): Promise<number> {
    const count = await this.store.getAccountCount();
    const attempts = Math.max(1, count);
    return attempts > 6 ? 6 : attempts;
  }

  async getActiveAccountId(): Promise<string | undefined> {
    const active = await this.store.getActiveAccount();
    return active?.id;
  }

  async handleCodeAssistSuccess(): Promise<void> {
    await this.store.markActiveUsed();
  }

  async handleCodeAssistError(error: CodeAssistApiError): Promise<boolean> {
    if (!shouldRotateForError(error)) {
      return false;
    }
    const cooldownMs = cooldownForError(error);
    const reason = `${error.status}:${error.method}`;
    const rotated = await this.store.rotateActiveAccount(reason, cooldownMs);
    return Boolean(rotated);
  }
}
