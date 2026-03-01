import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CLIENT_ID = process.env.GEMINI_CLI_OAUTH_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET;
const ORIGINAL_SOURCE_PATH = process.env.GEMINI_CLI_OAUTH_SOURCE_PATH;
const ORIGINAL_AUTO_DISCOVERY = process.env.GEMINI_CLI_OAUTH_AUTO_DISCOVERY;
const ORIGINAL_BIN_PATH = process.env.GEMINI_CLI_BIN_PATH;

function restoreEnv() {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_ID;
  } else {
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID = ORIGINAL_CLIENT_ID;
  }

  if (ORIGINAL_CLIENT_SECRET === undefined) {
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET;
  } else {
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET = ORIGINAL_CLIENT_SECRET;
  }

  if (ORIGINAL_SOURCE_PATH === undefined) {
    delete process.env.GEMINI_CLI_OAUTH_SOURCE_PATH;
  } else {
    process.env.GEMINI_CLI_OAUTH_SOURCE_PATH = ORIGINAL_SOURCE_PATH;
  }

  if (ORIGINAL_AUTO_DISCOVERY === undefined) {
    delete process.env.GEMINI_CLI_OAUTH_AUTO_DISCOVERY;
  } else {
    process.env.GEMINI_CLI_OAUTH_AUTO_DISCOVERY = ORIGINAL_AUTO_DISCOVERY;
  }

  if (ORIGINAL_BIN_PATH === undefined) {
    delete process.env.GEMINI_CLI_BIN_PATH;
  } else {
    process.env.GEMINI_CLI_BIN_PATH = ORIGINAL_BIN_PATH;
  }
}

async function createOAuthSourceFile(clientId: string, clientSecret: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "geminimock-oauth-"));
  const file = path.join(dir, "oauth2.js");
  await writeFile(
    file,
    `const OAUTH_CLIENT_ID = '${clientId}';\nconst OAUTH_CLIENT_SECRET = '${clientSecret}';\n`,
    "utf8"
  );
  return file;
}

afterEach(() => {
  restoreEnv();
});

describe("oauth client config", () => {
  it("uses Gemini CLI source file when env is missing", async () => {
    const sourceFile = await createOAuthSourceFile("source-id-123", "source-secret-123");
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_ID;
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET;
    process.env.GEMINI_CLI_OAUTH_SOURCE_PATH = sourceFile;
    process.env.GEMINI_CLI_OAUTH_AUTO_DISCOVERY = "1";
    vi.resetModules();
    const module = await import("../../src/auth/oauth-flow.js");
    try {
      const request = await module.buildManualOAuthRequest();
      const url = new URL(request.authUrl);
      expect(module.hasConfiguredOAuthClient()).toBe(true);
      expect(url.searchParams.get("client_id")).toBe("source-id-123");
      expect(() => module.createOAuthClient()).not.toThrow();
    } finally {
      await rm(path.dirname(sourceFile), { recursive: true, force: true });
    }
  });

  it("uses custom OAuth client env when provided", async () => {
    const sourceFile = await createOAuthSourceFile("source-id-123", "source-secret-123");
    process.env.GEMINI_CLI_OAUTH_SOURCE_PATH = sourceFile;
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID = "id-123";
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET = "secret-123";
    vi.resetModules();
    const module = await import("../../src/auth/oauth-flow.js");
    try {
      const request = await module.buildManualOAuthRequest();
      const url = new URL(request.authUrl);
      expect(module.hasConfiguredOAuthClient()).toBe(true);
      expect(url.searchParams.get("client_id")).toBe("id-123");
      expect(() => module.createOAuthClient()).not.toThrow();
    } finally {
      await rm(path.dirname(sourceFile), { recursive: true, force: true });
    }
  });

  it("uses bundled gemini-cli-core OAuth client when env is unavailable", async () => {
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_ID;
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET;
    delete process.env.GEMINI_CLI_OAUTH_SOURCE_PATH;
    delete process.env.GEMINI_CLI_BIN_PATH;
    process.env.GEMINI_CLI_OAUTH_AUTO_DISCOVERY = "1";
    vi.resetModules();
    const module = await import("../../src/auth/oauth-flow.js");
    const request = await module.buildManualOAuthRequest();
    const url = new URL(request.authUrl);
    expect(module.hasConfiguredOAuthClient()).toBe(true);
    const discoveredClientId = url.searchParams.get("client_id");
    expect(discoveredClientId).toBeTruthy();
    expect(discoveredClientId?.endsWith(".apps.googleusercontent.com")).toBe(true);
    expect(() => module.createOAuthClient()).not.toThrow();
  });
});
