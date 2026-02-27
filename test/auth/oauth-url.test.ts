import { describe, expect, it } from "vitest";
import { buildManualOAuthRequest, buildWebOAuthRequest } from "../../src/auth/oauth-flow.js";

describe("buildManualOAuthRequest", () => {
  it("creates url with pkce", async () => {
    const request = await buildManualOAuthRequest();
    const url = new URL(request.authUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://codeassist.google.com/authcode");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("client_id")).toBeTruthy();
    expect(request.codeVerifier.length).toBeGreaterThan(20);
  });
});

describe("buildWebOAuthRequest", () => {
  it("creates localhost callback url", () => {
    const request = buildWebOAuthRequest(43123);
    const url = new URL(request.authUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43123/oauth2callback");
    expect(url.searchParams.get("state")).toBe(request.state);
  });
});
