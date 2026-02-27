import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CLIENT_ID = process.env.GEMINI_CLI_OAUTH_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET;

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
}

afterEach(() => {
  restoreEnv();
});

describe("oauth client config", () => {
  it("is configured when env values exist", async () => {
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID = "id-123";
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET = "secret-123";
    vi.resetModules();
    const module = await import("../../src/auth/oauth-flow.js");

    expect(module.hasConfiguredOAuthClient()).toBe(true);
    expect(() => module.createOAuthClient()).not.toThrow();
  });

  it("throws when env values are missing", async () => {
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_ID;
    delete process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET;
    vi.resetModules();
    const module = await import("../../src/auth/oauth-flow.js");

    expect(module.hasConfiguredOAuthClient()).toBe(false);
    expect(() => module.createOAuthClient()).toThrow("OAuth client is not configured.");
  });
});
