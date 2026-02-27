#!/usr/bin/env node

import { createCredentialStore } from "./auth/credential-store.js";
import { OAuthService } from "./auth/oauth-service.js";
import { loadEnv } from "./config/env.js";
import { CodeAssistClient } from "./gemini/code-assist-client.js";
import { ModelCatalogService } from "./gemini/model-catalog-service.js";
import { createApp } from "./server/app.js";

function usage() {
  process.stdout.write(
    [
      "Usage:",
      "  geminimock serve",
      "  geminimock auth login",
      "  geminimock auth logout",
      "  geminimock models list"
    ].join("\n") + "\n"
  );
}

async function runAuthLogin() {
  const env = loadEnv();
  const store = createCredentialStore(env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const result = await oauthService.login();
  process.stdout.write(`OAuth login succeeded${result.email ? `: ${result.email}` : ""}\n`);
}

async function runAuthLogout() {
  const env = loadEnv();
  const store = createCredentialStore(env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  await oauthService.logout();
  process.stdout.write("OAuth credentials cleared\n");
}

async function runServe() {
  const env = loadEnv();
  const app = await createApp({ env });
  await app.listen({ host: env.host, port: env.port });
  process.stdout.write(`Server listening on http://${env.host}:${env.port}\n`);
}

async function runModelsList() {
  const env = loadEnv();
  const store = createCredentialStore(env.oauthPath, env.oauthFallbackPath);
  const oauthService = new OAuthService(store);
  const client = new CodeAssistClient(env, () => oauthService.getAccessToken());
  const catalog = new ModelCatalogService(client);
  const models = await catalog.listModels(true);
  if (models.length === 0) {
    process.stdout.write("No models available\n");
    return;
  }
  process.stdout.write(`${models.join("\n")}\n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "serve") {
    await runServe();
    return;
  }

  if (args[0] === "auth" && args[1] === "login") {
    await runAuthLogin();
    return;
  }

  if (args[0] === "auth" && args[1] === "logout") {
    await runAuthLogout();
    return;
  }

  if (args[0] === "models" && args[1] === "list") {
    await runModelsList();
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
