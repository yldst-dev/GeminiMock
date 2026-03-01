#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { createAccountStore } from "./auth/account-store.js";
import { OAuthService, type OAuthLoginMode } from "./auth/oauth-service.js";
import { runAuthLoginFlow, type LoginKey, type LoginTuiIO } from "./commands/auth-login.js";
import { runAuthLogoutFlow, type LogoutKey, type LogoutTuiIO } from "./commands/auth-logout.js";
import { loadEnv } from "./config/env.js";
import { CodeAssistClient } from "./gemini/code-assist-client.js";
import { ModelCatalogService } from "./gemini/model-catalog-service.js";
import { createApp } from "./server/app.js";
import { createBackgroundServiceManager } from "./server/background-service.js";
import { performSelfUpdate } from "./update/self-update.js";

function usage() {
  process.stdout.write(
    [
      "Usage:",
      "  geminimock serve",
      "  geminimock server start",
      "  geminimock server stop",
      "  geminimock server status",
      "  geminimock auth login [--manual|--web]",
      "  geminimock auth logout [--all]",
      "  geminimock auth accounts list",
      "  geminimock auth accounts use <id|email>",
      "  geminimock auth accounts remove <id|email>",
      "  geminimock models list",
      "  geminimock update"
    ].join("\n") + "\n"
  );
}

async function runAuthLogin(singleOnly = false, mode: OAuthLoginMode = "auto") {
  const env = loadEnv();
  const store = createAccountStore(env.accountsPath, env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (singleOnly || !isTTY) {
    const result = await oauthService.login(undefined, mode);
    process.stdout.write(`OAuth login succeeded${result.email ? `: ${result.email}` : ""}\n`);
    return;
  }

  const keyQueue: LoginKey[] = [];
  let keyResolver: ((key: LoginKey) => void) | null = null;
  let ignoreLoginKeysUntil = 0;

  function mapKeypressToLoginKey(key: { name?: string; ctrl?: boolean }): LoginKey | null {
    const name = key.name?.toLowerCase();
    if (name === "up") {
      return "up";
    }
    if (name === "down") {
      return "down";
    }
    if (name === "return" || name === "enter") {
      return "enter";
    }
    if (key.ctrl && name === "c") {
      return "cancel";
    }
    return null;
  }

  const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
    if (Date.now() < ignoreLoginKeysUntil) {
      return;
    }
    const mapped = mapKeypressToLoginKey(key);
    if (!mapped) {
      return;
    }
    if (keyResolver) {
      const resolve = keyResolver;
      keyResolver = null;
      resolve(mapped);
      return;
    }
    keyQueue.push(mapped);
  };

  async function readLoginKeyFromTTY(): Promise<LoginKey> {
    const next = keyQueue.shift();
    if (next) {
      return next;
    }
    return new Promise((resolve) => {
      keyResolver = resolve;
    });
  }

  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRaw = Boolean(stdin.isRaw);

  const io: LoginTuiIO = {
    isTTY,
    write(message: string) {
      process.stdout.write(message);
    },
    clear() {
      process.stdout.write("\u001b[2J\u001b[H");
    },
    async readKey() {
      return readLoginKeyFromTTY();
    }
  };

  const doLoginWithCookedMode = async () => {
    process.stdout.write("\u001b[2J\u001b[H");
    process.stdout.write("\u001b[?25h");
    stdin.setRawMode(false);
    stdin.off("keypress", onKeypress);
    keyResolver = null;
    keyQueue.length = 0;
    try {
      return await oauthService.login({
        write(message: string) {
          process.stdout.write(message);
        },
        async readCode(prompt: string): Promise<string> {
          const rl = createInterface({ input, output });
          try {
            return await rl.question(prompt);
          } finally {
            rl.close();
          }
        }
      }, mode);
    } finally {
      emitKeypressEvents(stdin);
      stdin.on("keypress", onKeypress);
      stdin.setRawMode(true);
      stdin.resume();
      process.stdout.write("\u001b[?25l");
      keyQueue.length = 0;
      ignoreLoginKeysUntil = Date.now() + 1000;
    }
  };

  emitKeypressEvents(stdin);
  stdin.on("keypress", onKeypress);
  stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write("\u001b[?25l");
  try {
    const lines = await runAuthLoginFlow({
      io,
      doLogin: doLoginWithCookedMode
    });
    process.stdout.write("\u001b[2J\u001b[H");
    process.stdout.write(`${lines.join("\n")}\n`);
  } finally {
    process.stdout.write("\u001b[?25h");
    stdin.off("keypress", onKeypress);
    keyResolver = null;
    stdin.setRawMode(wasRaw);
    stdin.pause();
  }
}

async function runAuthLogout(all = false) {
  const env = loadEnv();
  const store = createAccountStore(env.accountsPath, env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const keyQueue: LogoutKey[] = [];
  let keyResolver: ((key: LogoutKey) => void) | null = null;

  function mapKeypressToLogoutKey(key: { name?: string; ctrl?: boolean }): LogoutKey | null {
    const name = key.name?.toLowerCase();
    if (name === "up") {
      return "up";
    }
    if (name === "down") {
      return "down";
    }
    if (name === "return" || name === "enter") {
      return "enter";
    }
    if (name === "escape" || name === "q" || (key.ctrl && name === "c")) {
      return "cancel";
    }
    return null;
  }

  const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
    const mapped = mapKeypressToLogoutKey(key);
    if (!mapped) {
      return;
    }
    if (keyResolver) {
      const resolve = keyResolver;
      keyResolver = null;
      resolve(mapped);
      return;
    }
    keyQueue.push(mapped);
  };

  async function readLogoutKeyFromTTY(): Promise<LogoutKey> {
    const next = keyQueue.shift();
    if (next) {
      return next;
    }
    return new Promise((resolve) => {
      keyResolver = resolve;
    });
  }

  const io: LogoutTuiIO = {
    isTTY,
    write(message: string) {
      process.stdout.write(message);
    },
    clear() {
      process.stdout.write("\u001b[2J\u001b[H");
    },
    async readKey() {
      if (!isTTY) {
        return "cancel";
      }
      return readLogoutKeyFromTTY();
    }
  };

  const runFlow = async () => {
    const lines = await runAuthLogoutFlow({
      oauthService,
      store,
      io,
      forceAll: all
    });
    if (isTTY) {
      process.stdout.write("\u001b[2J\u001b[H");
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  };

  const canRawMode = isTTY && typeof process.stdin.setRawMode === "function";
  if (!canRawMode) {
    await runFlow();
    return;
  }

  const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRaw = Boolean(stdin.isRaw);
  emitKeypressEvents(stdin);
  stdin.on("keypress", onKeypress);
  stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write("\u001b[?25l");
  try {
    await runFlow();
  } finally {
    process.stdout.write("\u001b[?25h");
    stdin.off("keypress", onKeypress);
    keyResolver = null;
    stdin.setRawMode(wasRaw);
    stdin.pause();
  }
}

async function runAuthAccountsList() {
  const env = loadEnv();
  const store = createAccountStore(env.accountsPath, env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const accounts = await oauthService.listAccounts();
  const active = await store.getActiveAccount();
  if (accounts.length === 0) {
    process.stdout.write("No accounts registered\n");
    return;
  }
  for (const account of accounts) {
    const marker = active?.id === account.id ? "*" : " ";
    const label = account.email ?? "(no email)";
    const status = account.enabled ? "enabled" : "disabled";
    process.stdout.write(`${marker} ${account.id} ${label} ${status}\n`);
  }
}

async function runAuthAccountsUse(idOrEmail: string | undefined) {
  if (!idOrEmail) {
    throw new Error("Missing account id or email");
  }
  const env = loadEnv();
  const store = createAccountStore(env.accountsPath, env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const selected = await oauthService.useAccount(idOrEmail);
  process.stdout.write(`Active account set: ${selected.id}${selected.email ? ` (${selected.email})` : ""}\n`);
}

async function runAuthAccountsRemove(idOrEmail: string | undefined) {
  if (!idOrEmail) {
    throw new Error("Missing account id or email");
  }
  const env = loadEnv();
  const store = createAccountStore(env.accountsPath, env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const removed = await oauthService.removeAccount(idOrEmail);
  if (!removed) {
    process.stdout.write(`Account not found: ${idOrEmail}\n`);
    return;
  }
  process.stdout.write(`Account removed: ${idOrEmail}\n`);
}

async function runServe() {
  const env = loadEnv();
  const app = await createApp({ env });
  await app.listen({ host: env.host, port: env.port });
  process.stdout.write(`Server listening on http://${env.host}:${env.port}\n`);
}

async function runServerStart() {
  const manager = createBackgroundServiceManager();
  const result = await manager.start();
  if (result.alreadyRunning) {
    if (result.pid) {
      process.stdout.write(`Server already running (PID ${result.pid}) at ${result.url}\n`);
    } else {
      process.stdout.write(`Server already running at ${result.url}\n`);
    }
    process.stdout.write(`Logs: ${result.logPath}\n`);
    return;
  }
  process.stdout.write(`Server started in background (PID ${result.pid ?? "unknown"}) at ${result.url}\n`);
  process.stdout.write(`Logs: ${result.logPath}\n`);
}

async function runServerStop() {
  const manager = createBackgroundServiceManager();
  const result = await manager.stop();
  if (!result.stopped) {
    if (result.unmanagedRunning) {
      process.stdout.write("Server is running but unmanaged by geminimock (no pid file)\n");
      return;
    }
    process.stdout.write("Server is not running\n");
    return;
  }
  process.stdout.write(`Server stopped (PID ${result.pid})\n`);
}

async function runServerStatus() {
  const manager = createBackgroundServiceManager();
  const result = await manager.status();
  if (!result.running) {
    process.stdout.write(`Server is not running (${result.url})\n`);
    return;
  }
  if (result.pid) {
    process.stdout.write(`Server is running (PID ${result.pid}) at ${result.url}\n`);
  } else {
    process.stdout.write(`Server is running at ${result.url} (unmanaged)\n`);
  }
  process.stdout.write(`Logs: ${result.logPath}\n`);
}

async function runModelsList() {
  const env = loadEnv();
  const store = createAccountStore(env.accountsPath, env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const client = new CodeAssistClient(
    env,
    () => oauthService.getAccessToken(),
    {
      onApiError: (error) => oauthService.handleCodeAssistError(error),
      onApiSuccess: () => oauthService.handleCodeAssistSuccess(),
      maxAttempts: () => oauthService.getApiAttemptLimit(),
      getAccountCacheKey: () => oauthService.getActiveAccountId()
    }
  );
  const catalog = new ModelCatalogService(client);
  const models = await catalog.listModels(true);
  if (models.length === 0) {
    process.stdout.write("No models available\n");
    return;
  }
  process.stdout.write(`${models.join("\n")}\n`);
}

async function runUpdate() {
  await performSelfUpdate("geminimock");
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "serve") {
    await runServe();
    return;
  }

  if (args[0] === "server" && args[1] === "start") {
    await runServerStart();
    return;
  }

  if (args[0] === "server" && args[1] === "stop") {
    await runServerStop();
    return;
  }

  if (args[0] === "server" && args[1] === "status") {
    await runServerStatus();
    return;
  }

  if (args[0] === "auth" && args[1] === "login") {
    const manual = args.includes("--manual");
    const web = args.includes("--web");
    if (manual && web) {
      throw new Error("Use either --manual or --web, not both");
    }
    const mode: OAuthLoginMode = manual ? "manual" : web ? "web" : "auto";
    await runAuthLogin(args.includes("--single"), mode);
    return;
  }

  if (args[0] === "auth" && args[1] === "logout") {
    await runAuthLogout(args.includes("--all"));
    return;
  }

  if (args[0] === "auth" && args[1] === "accounts" && args[2] === "list") {
    await runAuthAccountsList();
    return;
  }

  if (args[0] === "auth" && args[1] === "accounts" && args[2] === "use") {
    await runAuthAccountsUse(args[3]);
    return;
  }

  if (args[0] === "auth" && args[1] === "accounts" && args[2] === "remove") {
    await runAuthAccountsRemove(args[3]);
    return;
  }

  if (args[0] === "models" && args[1] === "list") {
    await runModelsList();
    return;
  }

  if (args[0] === "update") {
    await runUpdate();
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
