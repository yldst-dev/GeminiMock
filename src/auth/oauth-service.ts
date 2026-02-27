import { createServer } from "node:http";
import { spawn } from "node:child_process";
import net from "node:net";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { OAuth2Client } from "google-auth-library";
import type { CredentialStore, StoredCredentials } from "./credential-store.js";
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

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

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

async function fetchUserEmail(client: OAuth2Client): Promise<string | undefined> {
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

async function persistCredentials(store: CredentialStore, tokens: StoredCredentials): Promise<StoredCredentials> {
  const existing = await store.load();
  const normalized = normalizeCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token,
    expiry_date: tokens.expiry_date ?? existing?.expiry_date,
    token_type: tokens.token_type,
    scope: tokens.scope
  });
  await store.save(normalized);
  return normalized;
}

export class OAuthService {
  constructor(private readonly store: CredentialStore) {}

  async login(io: OAuthServiceIO = defaultIO()): Promise<{ email?: string }> {
    if (!hasConfiguredOAuthClient()) {
      const existing = await this.store.load();
      if (existing?.access_token) {
        const normalized = normalizeCredentials(existing);
        await this.store.save(normalized);
        const email = await fetchUserEmailFromAccessToken(existing.access_token);
        io.write("OAuth client env is not configured. Reusing existing stored credentials.\n");
        io.write("Set GEMINI_CLI_OAUTH_CLIENT_ID and GEMINI_CLI_OAUTH_CLIENT_SECRET for fresh OAuth login.\n");
        return { email };
      }
      throw new Error(
        "OAuth client is not configured. Set GEMINI_CLI_OAUTH_CLIENT_ID and GEMINI_CLI_OAUTH_CLIENT_SECRET."
      );
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
    const request = buildWebOAuthRequest(port);
    const listener = await startCallbackListener(port, OAUTH_TIMEOUT_MS);

    try {
      const opened = await openExternalUrl(request.authUrl);
      if (!opened) {
        io.write("Could not open browser automatically. Open this URL manually:\n");
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

      const stored = await persistCredentials(this.store, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? undefined,
        expiry_date: tokens.expiry_date ?? undefined,
        token_type: tokens.token_type ?? undefined,
        scope: tokens.scope ?? undefined
      });

      const client = createOAuthClient();
      client.setCredentials(stored);
      const email = await fetchUserEmail(client);
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

    const stored = await persistCredentials(this.store, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
      token_type: tokens.token_type ?? undefined,
      scope: tokens.scope ?? undefined
    });

    const client = createOAuthClient();
    client.setCredentials(stored);
    const email = await fetchUserEmail(client);
    return { email };
  }

  async logout(): Promise<void> {
    await this.store.clear();
  }

  async getClient(): Promise<OAuth2Client> {
    const credentials = await this.store.load();
    if (!credentials) {
      throw new Error("OAuth credentials not found. Run auth login first.");
    }

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
    await this.store.save(merged);
    client.setCredentials(merged);
    return client;
  }

  async getAccessToken(): Promise<string> {
    const credentials = await this.store.load();
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
}
