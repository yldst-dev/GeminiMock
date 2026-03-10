import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCESS_TOKEN_SKEW_MS = 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional()
});

const tokenErrorSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional()
});

export const CodeChallengeMethod = {
  S256: "S256"
} as const;

export type OAuthCredentials = {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
};

type AuthUrlOptions = {
  redirect_uri: string;
  access_type?: string;
  prompt?: string;
  scope: readonly string[];
  code_challenge_method?: typeof CodeChallengeMethod[keyof typeof CodeChallengeMethod];
  code_challenge?: string;
  state?: string;
};

type TokenRequest = {
  code: string;
  codeVerifier?: string;
  redirect_uri: string;
};

type OAuthClientOptions = {
  clientId: string;
  clientSecret?: string;
};

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildExpiryDate(expiresInSeconds: number | undefined): number | undefined {
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    return undefined;
  }
  return Date.now() + expiresInSeconds * 1000;
}

function mergeCredentials(
  current: OAuthCredentials,
  incoming: OAuthCredentials & { expires_in?: number }
): OAuthCredentials {
  return {
    access_token: incoming.access_token ?? current.access_token,
    refresh_token: incoming.refresh_token ?? current.refresh_token,
    expiry_date: incoming.expiry_date ?? buildExpiryDate(incoming.expires_in) ?? current.expiry_date,
    token_type: incoming.token_type ?? current.token_type,
    scope: incoming.scope ?? current.scope
  };
}

async function parseTokenResponse(response: Response): Promise<OAuthCredentials & { expires_in?: number }> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = tokenErrorSchema.safeParse(payload);
    const detail = parsed.success
      ? parsed.data.error_description ?? parsed.data.error
      : undefined;
    throw new Error(detail ? `OAuth token request failed: ${detail}` : `OAuth token request failed: ${response.status}`);
  }

  const parsed = tokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("OAuth token response was invalid");
  }
  return parsed.data;
}

export class OAuthClient {
  readonly clientId: string;
  readonly clientSecret?: string;
  credentials: OAuthCredentials = {};

  constructor({ clientId, clientSecret }: OAuthClientOptions) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async generateCodeVerifierAsync(): Promise<{ codeVerifier: string; codeChallenge: string }> {
    const codeVerifier = toBase64Url(randomBytes(64));
    const codeChallenge = toBase64Url(createHash("sha256").update(codeVerifier).digest());
    return { codeVerifier, codeChallenge };
  }

  generateAuthUrl(options: AuthUrlOptions): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", options.redirect_uri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", options.scope.join(" "));

    if (options.access_type) {
      url.searchParams.set("access_type", options.access_type);
    }
    if (options.prompt) {
      url.searchParams.set("prompt", options.prompt);
    }
    if (options.state) {
      url.searchParams.set("state", options.state);
    }
    if (options.code_challenge_method) {
      url.searchParams.set("code_challenge_method", options.code_challenge_method);
    }
    if (options.code_challenge) {
      url.searchParams.set("code_challenge", options.code_challenge);
    }

    return url.toString();
  }

  setCredentials(credentials: OAuthCredentials): void {
    this.credentials = { ...credentials };
  }

  async getToken(request: TokenRequest): Promise<{ tokens: OAuthCredentials }> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      code: request.code,
      grant_type: "authorization_code",
      redirect_uri: request.redirect_uri
    });

    if (this.clientSecret) {
      body.set("client_secret", this.clientSecret);
    }
    if (request.codeVerifier) {
      body.set("code_verifier", request.codeVerifier);
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const tokens = mergeCredentials(this.credentials, await parseTokenResponse(response));
    this.setCredentials(tokens);
    return { tokens };
  }

  async getAccessToken(): Promise<{ token?: string }> {
    if (this.credentials.access_token) {
      const expiresAt = this.credentials.expiry_date ?? Number.MAX_SAFE_INTEGER;
      if (expiresAt > Date.now() + ACCESS_TOKEN_SKEW_MS) {
        return { token: this.credentials.access_token };
      }
    }

    if (!this.credentials.refresh_token) {
      return { token: this.credentials.access_token };
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: "refresh_token",
      refresh_token: this.credentials.refresh_token
    });
    if (this.clientSecret) {
      body.set("client_secret", this.clientSecret);
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const tokens = mergeCredentials(this.credentials, await parseTokenResponse(response));
    this.setCredentials(tokens);
    return { token: this.credentials.access_token };
  }
}
