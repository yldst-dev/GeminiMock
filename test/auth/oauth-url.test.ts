import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CLIENT_ID = process.env.GEMINI_CLI_OAUTH_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET;

function setConfiguredEnv() {
  process.env.GEMINI_CLI_OAUTH_CLIENT_ID = "id-123";
  process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET = "secret-123";
}

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

describe("buildManualOAuthRequest", () => {
  it("creates url with pkce", async () => {
    setConfiguredEnv();
    vi.resetModules();
    const module = await import("../../src/auth/oauth-flow.js");
    const request = await module.buildManualOAuthRequest();
    const url = new URL(request.authUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://codeassist.google.com/authcode");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("client_id")).toBeTruthy();
    expect(request.codeVerifier.length).toBeGreaterThan(20);
  });
});

describe("buildWebOAuthRequest", () => {
  it("creates localhost callback url", async () => {
    setConfiguredEnv();
    vi.resetModules();
    const module = await import("../../src/auth/oauth-flow.js");
    const request = module.buildWebOAuthRequest(43123);
    const url = new URL(request.authUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43123/oauth2callback");
    expect(url.searchParams.get("state")).toBe(request.state);
  });
});
