import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthClient } from "../../src/auth/oauth-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuthClient", () => {
  it("refreshes an expired access token and preserves the refresh token", async () => {
    const client = new OAuthClient({
      clientId: "id-123",
      clientSecret: "secret-123"
    });
    client.setCredentials({
      access_token: "expired-token",
      refresh_token: "refresh-123",
      expiry_date: Date.now() - 1000
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "fresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "scope-a"
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const token = await client.getAccessToken();

    expect(token.token).toBe("fresh-token");
    expect(client.credentials.refresh_token).toBe("refresh-123");
    expect(client.credentials.expiry_date).toBeGreaterThan(Date.now());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/token");
  });

  it("exchanges an authorization code with PKCE verifier", async () => {
    const client = new OAuthClient({
      clientId: "id-123",
      clientSecret: "secret-123"
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "access-123",
        refresh_token: "refresh-123",
        expires_in: 3600,
        token_type: "Bearer"
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );

    const response = await client.getToken({
      code: "auth-code-123",
      codeVerifier: "pkce-verifier-123",
      redirect_uri: "http://127.0.0.1:43123/oauth2callback"
    });

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const requestBody = requestInit?.body;
    expect(requestBody).toBeInstanceOf(URLSearchParams);
    expect((requestBody as URLSearchParams).get("code_verifier")).toBe("pkce-verifier-123");
    expect(response.tokens.refresh_token).toBe("refresh-123");
    expect(client.credentials.access_token).toBe("access-123");
  });
});
